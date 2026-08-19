import type { ServerMessage } from "@caicaiclaw/protocol";
import { JsonObject, JsonValue } from "@caicaiclaw/utils";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
    id: string;
    role: ChatRole;
    turnId?: string;
    text: string;
    status: "pending" | "streaming" | "done" | "error";
    createdAt: number;
};

export type ToolActivity = {
    id: string;
    turnId: string;
    name: string;
    args: JsonObject;
    status: "running" | "success" | "error";
    result?: JsonValue;
    createdAt: number;
    completedAt?: number;
};

export type AgentTurnActivity = {
    turnId: string;
    status: "running" | "done" | "error";
    reasoningText: string;
    tools: ToolActivity[];
    startedAt: number;
    completedAt?: number;
};

type LaneSnapshotMessage = Extract<ServerMessage, { type: "lane_snapshot" }>;
type IntakeSnapshotMessage = Extract<ServerMessage, { type: "intake_snapshot" }>;
type ChannelSnapshotMessage = Extract<ServerMessage, { type: "channel_snapshot" }>;
type ApprovalSnapshotMessage = Extract<ServerMessage, { type: "approval_snapshot" }>;

export type ClientState = {
    connectionStatus: ConnectionStatus;
    clientId?: string;
    messages: ChatMessage[];
    activities: AgentTurnActivity[];
    errors: string[];
    laneSnapshot?: Omit<LaneSnapshotMessage, "type">;
    intakeSnapshot?: Omit<IntakeSnapshotMessage, "type">;
    channelSnapshot?: Omit<ChannelSnapshotMessage, "type">;
    approvalSnapshot?: Omit<ApprovalSnapshotMessage, "type">;
};

export type ClientAction =
    | {
          type: "connection_status";
          status: ConnectionStatus;
      }
    | {
          type: "local_input";
          requestId: string;
          text: string;
          createdAt: number;
      }
    | {
          type: "server_message";
          message: ServerMessage;
          receivedAt: number;
      };
