import { ClientState, selectTimeline } from "@caicaiclaw/client-core";
import { Box, useBoxMetrics } from "ink";
import React, { useEffect, useMemo, useRef } from "react";
import { ScrollViewport } from "../hooks/useScrollViewport";
import { TimelineItemView } from "./TimelineItemView";

export function Transcript({ state, controls }: { state: ClientState; controls: ScrollViewport }): React.ReactElement {
    const viewportRef = useRef<import("ink").DOMElement | null>(null);
    const contentRef = useRef<import("ink").DOMElement | null>(null);
    const metrics = useBoxMetrics(contentRef);
    const viewportMetrics = useBoxMetrics(viewportRef);
    const items = useMemo(() => selectTimeline(state), [state.messages, state.activities]);
    useEffect(
        () => controls.setMetrics(metrics.height, viewportMetrics.height),
        [controls.setMetrics, metrics.height, viewportMetrics.height],
    );
    return (
        <Box ref={viewportRef} flexDirection="column" flexGrow={1} minHeight={0} overflowY="hidden">
            <Box ref={contentRef} flexShrink={0} flexDirection="column" marginTop={-controls.offset}>
                {items.map((item) => (
                    <TimelineItemView key={item.id} item={item} />
                ))}
            </Box>
        </Box>
    );
}
