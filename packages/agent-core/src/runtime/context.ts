import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { HISTORY_WINDOW_MESSAGES, RawHistoryState } from "./history.js";

export function buildContext(
    systemPrompt: string,
    rawHistoryState: RawHistoryState,
    inputMessages: BaseMessage[],
): BaseMessage[] {
    const selectedTurns: BaseMessage[][] = [];
    let selectedMessageCount = 0;

    for (let index = rawHistoryState.committedTurns.length - 1; index >= 0; index -= 1) {
        const messages = rawHistoryState.committedTurns[index]?.messages ?? [];
        if (selectedTurns.length > 0 && selectedMessageCount + messages.length > HISTORY_WINDOW_MESSAGES) {
            break;
        }

        selectedTurns.unshift(messages);
        selectedMessageCount += messages.length;
    }

    return [new SystemMessage(systemPrompt), ...selectedTurns.flat(), ...inputMessages];
}
