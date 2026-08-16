import { TimelineItem } from "@caicaiclaw/client-core";
import { Box, Text, useAnimation } from "ink";
import React from "react";
import { ToolCallView } from "./ToolCallView";

export const TimelineItemView = React.memo(function TimelineItemView({
    item,
}: {
    item: TimelineItem;
}): React.ReactElement {
    if (item.kind === "user")
        return (
            <Text>
                <Text color="cyan">&gt; </Text>
                {item.message.text}
            </Text>
        );
    if (item.kind === "reasoning")
        return (
            <Box flexDirection="column">
                <Text dimColor>✻ Thinking…</Text>
                <Text dimColor> {item.text}</Text>
            </Box>
        );
    if (item.kind === "tool") return <ToolCallView tool={item.tool} />;
    return <AssistantMessage item={item} />;
});

function AssistantMessage({ item }: { item: Extract<TimelineItem, { kind: "assistant" }> }): React.ReactElement {
    const { frame } = useAnimation({ interval: 120, isActive: item.message.status === "streaming" });
    return (
        <Text>
            {item.message.text}
            {item.message.status === "streaming" ? <Text color="cyan">{frame % 2 === 0 ? "▌" : " "}</Text> : null}
        </Text>
    );
}
