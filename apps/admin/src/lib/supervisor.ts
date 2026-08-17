import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
    parseServerMessage,
    serializeClientMessage,
    WS_PROTOCOL_VERSION,
    type ServerMessage,
} from "@caicaiclaw/protocol";
import { getAdminConfig, type AdminConfig } from "./adminConfig";
import { safeErrorMessage } from "./error";

export type AgentStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type MaintenanceAction = "compact" | "daydreaming";

export type AgentSnapshot = {
    status: AgentStatus;
    pid?: number;
    startedAt?: string;
    uptimeMs?: number;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    exitedAt?: string;
    stderr: string[];
    error?: string;
    forcedKill: boolean;
    protocolVersion?: number;
};

type PendingRequest = {
    action: MaintenanceAction;
    resolve: (summary: string) => void;
    reject: (error: Error) => void;
};

type StopReason = "operator" | "startup" | undefined;

const MAX_STDERR_LINES = 200;

class AgentSupervisor {
    private readonly config: AdminConfig;
    private child: ChildProcess | undefined;
    private pendingExit: { child: ChildProcess; code: number | null; signal: NodeJS.Signals | null } | undefined;
    private control: WebSocket | undefined;
    private controlConnecting = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private startupTimer: ReturnType<typeof setTimeout> | undefined;
    private stopTimer: ReturnType<typeof setTimeout> | undefined;
    private stopReason: StopReason;
    private stopWaiters: Array<() => void> = [];
    private readonly pendingRequests = new Map<string, PendingRequest>();
    private stderrLines: string[] = [];
    private stderrRemainder = "";
    private snapshot: AgentSnapshot = {
        status: "stopped",
        stderr: [],
        forcedKill: false,
    };

    public constructor(config = getAdminConfig()) {
        this.config = config;
    }

    public getSnapshot(): AgentSnapshot {
        const snapshot: AgentSnapshot = {
            ...this.snapshot,
            stderr: [...this.snapshot.stderr],
        };
        if (
            snapshot.startedAt &&
            (snapshot.status === "starting" || snapshot.status === "running" || snapshot.status === "stopping")
        ) {
            snapshot.uptimeMs = Math.max(0, Date.now() - Date.parse(snapshot.startedAt));
        }
        return snapshot;
    }

    public start(): AgentSnapshot {
        if (this.child || ["starting", "running", "stopping"].includes(this.snapshot.status)) {
            throw new Error(`cannot start agent while status is ${this.snapshot.status}`);
        }

        this.clearTimers();
        this.stderrLines = [];
        this.stderrRemainder = "";
        this.stopReason = undefined;
        this.snapshot = { status: "starting", stderr: [], forcedKill: false, startedAt: new Date().toISOString() };

        const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
        const serverEntry = resolve(repositoryRoot, "apps/server/src/server.ts");

        try {
            const child = spawn(process.execPath, ["--import", "tsx/esm", serverEntry], {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    CAICAI_WS_HOST: this.config.agentHost,
                    CAICAI_WS_PORT: String(this.config.agentPort),
                },
                stdio: ["ignore", "ignore", "pipe"],
            });
            this.child = child;
            this.snapshot.pid = child.pid;
            child.stderr?.on("data", (data: Buffer | string) => this.captureStderr(data.toString()));
            child.once("error", (error) => {
                this.captureStderr(safeErrorMessage(error));
                this.snapshot = { ...this.snapshot, error: safeErrorMessage(error) };
            });
            child.once("exit", (code, signal) => {
                this.pendingExit = { child, code, signal };
            });
            child.once("close", () => {
                const exit = this.pendingExit?.child === child ? this.pendingExit : undefined;
                this.handleExit(child, exit?.code ?? null, exit?.signal ?? null);
            });
            this.scheduleControlConnection(child, 0);
            this.startupTimer = setTimeout(() => this.failStartup(child), this.config.startupTimeoutMs);
        } catch (error) {
            this.child = undefined;
            const message = safeErrorMessage(error);
            this.captureStderr(message);
            this.snapshot = {
                status: "crashed",
                stderr: [...this.stderrLines],
                forcedKill: false,
                error: message,
                exitedAt: new Date().toISOString(),
            };
        }

        return this.getSnapshot();
    }

    public async stop(): Promise<AgentSnapshot> {
        if (!this.child) {
            throw new Error(`cannot stop agent while status is ${this.snapshot.status}`);
        }
        if (this.snapshot.status === "stopping") throw new Error("agent is already stopping");
        if (this.snapshot.status !== "starting" && this.snapshot.status !== "running") {
            throw new Error(`cannot stop agent while status is ${this.snapshot.status}`);
        }

        const waitForExit = this.requestStop("operator");
        await waitForExit;
        return this.getSnapshot();
    }

    public async restart(): Promise<AgentSnapshot> {
        if (this.snapshot.status === "stopping") throw new Error("agent is already stopping");
        if (this.child) {
            await this.requestStop("operator");
            return this.start();
        }
        return this.start();
    }

    public async sendMaintenance(action: MaintenanceAction): Promise<string> {
        if (this.snapshot.status !== "running" || !this.control || this.control.readyState !== WebSocket.OPEN) {
            throw new Error("agent control connection is not ready");
        }

        const requestId = randomUUID();
        return new Promise<string>((resolvePromise, rejectPromise) => {
            this.pendingRequests.set(requestId, {
                action,
                resolve: resolvePromise,
                reject: rejectPromise,
            });
            try {
                this.control?.send(serializeClientMessage({ type: action, requestId }));
            } catch (error) {
                this.pendingRequests.delete(requestId);
                rejectPromise(new Error(safeErrorMessage(error)));
            }
        });
    }

    public async shutdown(): Promise<void> {
        this.clearTimers();
        if (this.child) {
            await this.requestStop("operator");
        }
    }

    private requestStop(reason: Exclude<StopReason, undefined>): Promise<void> {
        const child = this.child;
        if (!child) return Promise.resolve();

        this.stopReason = reason;
        if (reason === "operator") this.snapshot = { ...this.snapshot, status: "stopping" };
        this.closeControl();
        this.stopTimer = setTimeout(() => {
            if (this.child === child) {
                this.snapshot = {
                    ...this.snapshot,
                    forcedKill: true,
                    error: "agent exceeded stop grace period; sent SIGKILL",
                };
                child.kill("SIGKILL");
            }
        }, this.config.stopGraceMs);

        const waitForExit = new Promise<void>((resolvePromise) => this.stopWaiters.push(resolvePromise));
        child.kill("SIGTERM");
        return waitForExit;
    }

    private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
        if (this.child !== child) return;
        this.clearTimers();
        this.child = undefined;
        this.pendingExit = undefined;
        this.closeControl();
        if (this.stderrRemainder) this.captureStderr(`${this.stderrRemainder}\n`);

        const intentional = this.stopReason === "operator";
        const startupFailure = this.stopReason === "startup";
        const nextStatus: AgentStatus = intentional ? "stopped" : "crashed";
        const error =
            this.snapshot.error ?? (startupFailure ? "agent control WebSocket did not become ready" : undefined);
        this.snapshot = {
            status: nextStatus,
            stderr: [...this.stderrLines],
            exitCode: code,
            signal,
            exitedAt: new Date().toISOString(),
            forcedKill: this.snapshot.forcedKill,
            error,
        };
        this.stopReason = undefined;
        const waiters = this.stopWaiters.splice(0);
        for (const resolvePromise of waiters) resolvePromise();
    }

    private failStartup(child: ChildProcess): void {
        if (this.child !== child || this.snapshot.status !== "starting") return;
        this.snapshot = {
            ...this.snapshot,
            error: "agent did not complete the control WebSocket handshake before the startup timeout",
        };
        this.stopReason = "startup";
        this.closeControl();
        child.kill("SIGTERM");
    }

    private scheduleControlConnection(child: ChildProcess, delayMs: number): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.child !== child || this.snapshot.status === "stopping") return;
            this.connectControl(child);
        }, delayMs);
    }

    private connectControl(child: ChildProcess): void {
        if (this.control || this.controlConnecting || this.child !== child) return;
        this.controlConnecting = true;
        const socket = new WebSocket(`ws://${this.config.agentHost}:${this.config.agentPort}`);
        let closed = false;
        socket.on("message", (data: WebSocket.RawData) => this.handleControlMessage(socket, data.toString()));
        socket.on("open", () => {
            this.controlConnecting = false;
            if (this.child !== child || this.snapshot.status === "stopping") {
                socket.close();
                return;
            }
            this.control = socket;
        });
        socket.on("error", () => {});
        socket.on("close", () => {
            if (closed) return;
            closed = true;
            this.controlConnecting = false;
            if (this.control === socket) this.control = undefined;
            this.rejectPending(new Error("agent control connection closed"));
            if (this.child === child && this.snapshot.status !== "stopping") {
                if (this.snapshot.status === "running")
                    this.snapshot = { ...this.snapshot, status: "starting", error: "agent control connection lost" };
                this.scheduleControlConnection(child, 500);
            }
        });
    }

    private handleControlMessage(socket: WebSocket, raw: string): void {
        let message: ServerMessage | undefined;
        try {
            message = parseServerMessage(raw);
        } catch (error) {
            this.snapshot = { ...this.snapshot, error: safeErrorMessage(error) };
            return;
        }
        if (!message) return;
        if (message.type === "hello") {
            if (message.protocolVersion !== WS_PROTOCOL_VERSION) {
                this.snapshot = {
                    ...this.snapshot,
                    error: `protocol version mismatch: agent ${message.protocolVersion}, admin ${WS_PROTOCOL_VERSION}`,
                };
                socket.close();
                return;
            }
            if (this.control === socket && this.child && this.snapshot.status === "starting") {
                this.snapshot = {
                    ...this.snapshot,
                    status: "running",
                    protocolVersion: message.protocolVersion,
                    error: undefined,
                };
            }
            return;
        }
        if (message.type === "compact_result" || message.type === "daydreaming_result") {
            const requestId = message.requestId;
            if (!requestId) return;
            const pending = this.pendingRequests.get(requestId);
            if (!pending) return;
            this.pendingRequests.delete(requestId);
            pending.resolve(message.summary);
            return;
        }
        if (message.type === "error" && message.requestId) {
            const pending = this.pendingRequests.get(message.requestId);
            if (!pending) return;
            this.pendingRequests.delete(message.requestId);
            pending.reject(new Error(safeErrorMessage(message.message)));
        }
    }

    private closeControl(): void {
        const socket = this.control;
        this.control = undefined;
        this.controlConnecting = false;
        if (socket) socket.close();
        this.rejectPending(new Error("agent control connection closed"));
    }

    private rejectPending(error: Error): void {
        for (const [requestId, pending] of this.pendingRequests) {
            this.pendingRequests.delete(requestId);
            pending.reject(error);
        }
    }

    private captureStderr(text: string): void {
        this.stderrRemainder += text.replace(/\r/g, "");
        const lines = this.stderrRemainder.split("\n");
        this.stderrRemainder = lines.pop() ?? "";
        for (const line of lines) {
            const sanitized = safeErrorMessage(line);
            if (!sanitized) continue;
            this.stderrLines.push(sanitized);
            if (this.stderrLines.length > MAX_STDERR_LINES) this.stderrLines.shift();
        }
        this.snapshot = { ...this.snapshot, stderr: [...this.stderrLines] };
    }

    private clearTimers(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.startupTimer) clearTimeout(this.startupTimer);
        if (this.stopTimer) clearTimeout(this.stopTimer);
        this.reconnectTimer = undefined;
        this.startupTimer = undefined;
        this.stopTimer = undefined;
    }
}

let singleton: AgentSupervisor | undefined;

export function getSupervisor(): AgentSupervisor {
    singleton ??= new AgentSupervisor();
    return singleton;
}
