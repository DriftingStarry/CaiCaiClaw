import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { RawHistoryState } from "./history";
import { getAgent } from "../agent";

const HISTORY_WINDOW_MESSAGES = 30;

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


/**
 * 把传入的内容压缩为一次 message, 并作为 SystemMessage 返回
 * 
 */
export async function compactContext(
    inputMessages: BaseMessage[],
    compactAgent: ReturnType<typeof getAgent>
) {
    // filter SystemMessage
    const toCompactMessages = inputMessages.filter(m => !SystemMessage.isInstance(m))
    // 结合提示词将消息进行压缩
    const compactPrompt = ''
    const compactedMessage = await compactAgent.invoke({
        messages:[compactPrompt, ...toCompactMessages]
    })
    return compactedMessage.messages.at(-1);
}