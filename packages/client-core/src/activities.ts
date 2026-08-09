import { AgentTurnActivity, ClientState } from "./types.js";

export function upsertActivity(state: ClientState, activity: AgentTurnActivity): ClientState {
    if (state.activities.some((item) => item.turnId === activity.turnId)) {
        return updateActivity(state, activity.turnId, activity.startedAt, () => activity);
    }

    return { ...state, activities: [...state.activities, activity] };
}

export function updateActivity(
    state: ClientState,
    turnId: string,
    // 仅在 activity 尚不存在时用作 startedAt：delta 类消息可能先于 agent_turn_start 到达。
    fallbackStartedAt: number,
    update: (activity: AgentTurnActivity) => AgentTurnActivity,
): ClientState {
    const existing = state.activities.find((activity) => activity.turnId === turnId);
    const activity =
        existing ??
        ({
            turnId,
            status: "running",
            reasoningText: "",
            tools: [],
            startedAt: fallbackStartedAt,
        } satisfies AgentTurnActivity);

    if (!existing) {
        return { ...state, activities: [...state.activities, update(activity)] };
    }

    return {
        ...state,
        activities: state.activities.map((item) => (item.turnId === turnId ? update(item) : item)),
    };
}
