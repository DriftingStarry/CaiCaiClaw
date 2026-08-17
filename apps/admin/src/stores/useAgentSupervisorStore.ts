"use client";

import { errorMessage } from "@caicaiclaw/utils";
import { useEffect } from "react";
import { create } from "zustand";
import type { AgentSnapshot } from "../lib/supervisor";

export type AgentAction = "start" | "stop" | "restart" | "compact" | "daydreaming";
export type AgentOperationResult = {
    action: AgentAction;
    outcome: "success" | "error";
    message: string;
};

type ActionResponse = {
    snapshot?: AgentSnapshot;
    summary?: string;
    error?: string;
};

export type AgentSupervisorStore = {
    snapshot: AgentSnapshot;
    activeAction?: AgentAction;
    lastOperation?: AgentOperationResult;
    runAction: (action: AgentAction) => Promise<boolean>;
};

const initialSnapshot: AgentSnapshot = { status: "stopped", stderr: [], forcedKill: false };
const POLL_INTERVAL_MS = 1_000;

let polling = false;
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
let pollingAbortController: AbortController | undefined;
let pollingSubscriberCount = 0;

function isAgentStatus(value: unknown): value is AgentSnapshot["status"] {
    return (
        value === "stopped" ||
        value === "starting" ||
        value === "running" ||
        value === "stopping" ||
        value === "crashed"
    );
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        isAgentStatus(record.status) &&
        Array.isArray(record.stderr) &&
        record.stderr.every((line) => typeof line === "string") &&
        typeof record.forcedKill === "boolean"
    );
}

function isActionResponse(value: unknown): value is ActionResponse {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        (record.snapshot === undefined || isAgentSnapshot(record.snapshot)) &&
        (record.summary === undefined || typeof record.summary === "string") &&
        (record.error === undefined || typeof record.error === "string")
    );
}

async function readJson(response: Response): Promise<unknown> {
    return response.json().catch(() => undefined);
}

async function refreshSnapshot(signal: AbortSignal): Promise<void> {
    try {
        const response = await fetch("/api/agent", { cache: "no-store", signal });
        if (!response.ok) return;
        const body = await readJson(response);
        if (isAgentSnapshot(body)) useAgentSupervisorStore.setState({ snapshot: body });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("failed to refresh agent snapshot", errorMessage(error));
    }
}

async function pollSnapshot(): Promise<void> {
    const abortController = pollingAbortController;
    if (!polling || !abortController) return;
    await refreshSnapshot(abortController.signal);
    if (!polling || pollingAbortController !== abortController) return;
    pollingTimer = setTimeout(() => void pollSnapshot(), POLL_INTERVAL_MS);
}

function startPolling(): void {
    if (polling) return;
    polling = true;
    pollingAbortController = new AbortController();
    void pollSnapshot();
}

function stopPolling(): void {
    polling = false;
    if (pollingTimer) clearTimeout(pollingTimer);
    pollingTimer = undefined;
    pollingAbortController?.abort();
    pollingAbortController = undefined;
}

async function runAgentAction(action: AgentAction): Promise<boolean> {
    if (useAgentSupervisorStore.getState().activeAction) return false;
    useAgentSupervisorStore.setState({ activeAction: action, lastOperation: undefined });
    try {
        const response = await fetch("/api/agent/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action }),
        });
        const body = await readJson(response);
        if (!isActionResponse(body)) throw new Error("操作响应格式无效");
        if (!response.ok) throw new Error(body.error ?? "操作失败");
        if (body.snapshot) useAgentSupervisorStore.setState({ snapshot: body.snapshot });
        useAgentSupervisorStore.setState({
            lastOperation: {
                action,
                outcome: "success",
                message: body.summary ? `${action} 完成：${body.summary}` : `${action} 已提交`,
            },
        });
        return true;
    } catch (error) {
        useAgentSupervisorStore.setState({
            lastOperation: { action, outcome: "error", message: errorMessage(error) },
        });
        return false;
    } finally {
        useAgentSupervisorStore.setState((state) => (state.activeAction === action ? { activeAction: undefined } : {}));
    }
}

export const useAgentSupervisorStore = create<AgentSupervisorStore>(() => ({
    snapshot: initialSnapshot,
    runAction: runAgentAction,
}));

export function useAgentSupervisorPolling(): void {
    useEffect(() => {
        pollingSubscriberCount += 1;
        if (pollingSubscriberCount === 1) startPolling();
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            pollingSubscriberCount -= 1;
            if (pollingSubscriberCount === 0) stopPolling();
        };
    }, []);
}
