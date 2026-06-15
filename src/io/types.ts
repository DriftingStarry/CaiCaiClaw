import type { BaseMessage } from "@langchain/core/messages";

export type MaybePromise<T> = T | Promise<T>;

export type MessageStreamChunk = readonly [
    message: BaseMessage,
    metadata: Record<string, unknown>,
];

export type AgentIOEvent =
    | {
          readonly type: "message";
          readonly chunk: MessageStreamChunk;
      }
    | {
          readonly type: "done";
      }
    | {
          readonly type: "error";
          readonly error: unknown;
      };

export interface AgentIO {
    readUserInput(prompt: string): Promise<string>;
    emit(event: AgentIOEvent): MaybePromise<void>;
}
