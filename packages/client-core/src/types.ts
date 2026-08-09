import { ServerMessage } from "@caicaiclaw/protocol";
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

export type ClientState = {
    connectionStatus: ConnectionStatus;
    clientId?: string;
    messages: ChatMessage[];
    activities: AgentTurnActivity[];
    errors: string[];
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
