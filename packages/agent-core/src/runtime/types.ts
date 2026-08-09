import { BaseMessage } from "@langchain/core/messages";
import { JsonObject, JsonValue } from "@caicaiclaw/utils";
import type { MaybePromise } from "@caicaiclaw/utils";

export type { MaybePromise } from "@caicaiclaw/utils";

export type InboundEvent = {
    text: string;
    source?: string;
    createdAt?: number;
    inputId?: string;
    requestId?: string;
};

export type ExecutionState = { messages: BaseMessage[]; llmCalls: number };

export type MessageStreamChunk = readonly [
    message: BaseMessage,
    metadata: Record<string, unknown>,
];

export type RuntimeOutputEvent =
    | {
          readonly type: "input_accepted";
          readonly turnId: string;
          readonly text: string;
          readonly source?: string;
          readonly requestId?: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "turn_start";
          readonly turnId: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "assistant_delta";
          readonly turnId: string;
          readonly text: string;
          readonly metadata: JsonObject;
      }
    | {
          readonly type: "reasoning_delta";
          readonly turnId: string;
          readonly text: string;
          readonly metadata: JsonObject;
      }
    | {
          readonly type: "tool_call_start";
          readonly turnId: string;
          readonly toolCallId: string;
          readonly name: string;
          readonly args: JsonObject;
          readonly createdAt: number;
      }
    | {
          readonly type: "tool_call_result";
          readonly turnId: string;
          readonly toolCallId: string;
          readonly name: string;
          readonly status: "success" | "error";
          readonly result: JsonValue;
          readonly createdAt: number;
      }
    | {
          readonly type: "done";
          readonly turnId: string;
      }
    | {
          readonly type: "error";
          readonly turnId?: string;
          readonly error: unknown;
      };

export type AgentRuntimeOptions = {
    rawHistoryPath: string;
    systemPromptPath: string;
    heartbeatMs?: number;
    onOutput?: (event: RuntimeOutputEvent) => MaybePromise<void>;
};

export type RuntimeOutputEmitter = (event: RuntimeOutputEvent) => MaybePromise<void>;
