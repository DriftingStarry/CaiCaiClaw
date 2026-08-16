import { AgentTurnActivity, ChatMessage, ClientState, ToolActivity } from "./types";

export type TimelineItem =
    | { kind: "user"; id: string; message: ChatMessage; at: number }
    | { kind: "assistant"; id: string; message: ChatMessage; at: number }
    | { kind: "reasoning"; id: string; turnId: string; text: string; at: number }
    | { kind: "tool"; id: string; tool: ToolActivity; at: number };

const kindWeight: Record<TimelineItem["kind"], number> = {
    user: 0,
    reasoning: 1,
    tool: 2,
    assistant: 3,
};

export function selectTimeline(state: ClientState): TimelineItem[] {
    const items: TimelineItem[] = [
        ...state.messages.map((message) => ({
            kind: message.role,
            id: message.id,
            message,
            at: message.createdAt,
        })),
        ...state.activities.flatMap((activity) => timelineActivityItems(activity)),
    ];

    return items
        .map((item, index) => ({ item, index }))
        .sort(
            (left, right) =>
                left.item.at - right.item.at ||
                kindWeight[left.item.kind] - kindWeight[right.item.kind] ||
                left.index - right.index,
        )
        .map(({ item }) => item);
}

function timelineActivityItems(activity: AgentTurnActivity): TimelineItem[] {
    const items: TimelineItem[] = [];
    if (activity.reasoningText) {
        items.push({
            kind: "reasoning",
            id: `${activity.turnId}:reasoning`,
            turnId: activity.turnId,
            text: activity.reasoningText,
            at: activity.startedAt,
        });
    }
    items.push(
        ...activity.tools.map((tool) => ({
            kind: "tool" as const,
            id: tool.id,
            tool,
            at: tool.createdAt,
        })),
    );
    return items;
}
