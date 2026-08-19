import { BaseMessage } from "@langchain/core/messages";
import { JsonObject, JsonValue } from "@caicaiclaw/utils";
import type { ChannelEvent } from "@caicaiclaw/utils/history";
import type { MaybePromise } from "@caicaiclaw/utils";
import type { DropReason } from "./intake";

export type { MaybePromise } from "@caicaiclaw/utils";

export type Lane = "fast" | "deep";

export type TurnContext = {
    turnId: string;
    lane: Lane;
    conversationId: string;
    target: OutputTarget;
};

export type OutputTarget = {
    channel: string;
    conversationId: string;
    replyTo?: string;
};

export type RuntimeInput = ChannelEvent & {
    inputId?: string;
    requestId?: string;
};

export type ExecutionState = { messages: BaseMessage[]; llmCalls: number };

export type MessageStreamChunk = readonly [message: BaseMessage, metadata: Record<string, unknown>];

export type RuntimeOutputEvent =
    | {
          readonly type: "input_dropped";
          readonly inputId: string;
          readonly event: ChannelEvent;
          readonly reason: DropReason;
          readonly requestId?: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "input_accepted";
          readonly turnId: string;
          readonly lane: Lane;
          readonly event: ChannelEvent;
          readonly requestId?: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "turn_start";
          readonly turnId: string;
          readonly lane: Lane;
          readonly createdAt: number;
      }
    | {
          readonly type: "assistant_delta";
          readonly turnId: string;
          readonly lane: Lane;
          readonly text: string;
          readonly metadata: JsonObject;
          readonly target?: OutputTarget;
      }
    | {
          readonly type: "reasoning_delta";
          readonly turnId: string;
          readonly lane: Lane;
          readonly text: string;
          readonly metadata: JsonObject;
      }
    | {
          readonly type: "tool_call_start";
          readonly turnId: string;
          readonly lane: Lane;
          readonly toolCallId: string;
          readonly name: string;
          readonly args: JsonObject;
          readonly createdAt: number;
      }
    | {
          readonly type: "tool_call_result";
          readonly turnId: string;
          readonly lane: Lane;
          readonly toolCallId: string;
          readonly name: string;
          readonly status: "success" | "error";
          readonly result: JsonValue;
          readonly createdAt: number;
      }
    | {
          readonly type: "done";
          readonly turnId: string;
          readonly lane: Lane;
      }
    | {
          readonly type: "error";
          readonly lane: Lane;
          readonly turnId?: string;
          readonly error: unknown;
      };

export type AgentRuntimeOptions = {
    rawHistoryPath: string;
    systemPromptPath: string;
    memoryDir?: string;
    allowMissingMemoryFiles?: boolean;
    compactionModelName?: string;
    compactionPrompt?: string;
    compactionPromptVersion?: string;
    compactionSummaryBudget?: number;
    toolResultProjectionThreshold?: number;
    memoryBudgets?: {
        system?: number;
        role?: number;
        memory?: number;
        tasksIndex?: number;
    };
    heartbeatMs?: number;
    fastModel?: AgentConfigModel;
    intakePolicyPath?: string;
    intakePolicy?: import("./intake").IntakePolicy;
    onOutput?: (event: RuntimeOutputEvent) => MaybePromise<void>;
};

export type AgentConfigModel = import("@langchain/core/language_models/chat_models").BaseChatModel & {
    bindTools: NonNullable<import("@langchain/core/language_models/chat_models").BaseChatModel["bindTools"]>;
};

export type CompactOptions = {
    trigger?: "manual" | "scheduled";
    preservedTurns?: number;
};

export type ToolResultPage = {
    turnId: string;
    toolCallId: string;
    status: "success" | "error";
    totalLength: number;
    offset: number;
    limit: number;
    content: string;
    hasMore: boolean;
};

export type RuntimeOutputEmitter = (event: RuntimeOutputEvent) => MaybePromise<void>;
