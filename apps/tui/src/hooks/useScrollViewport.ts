import { useCallback, useMemo, useState } from "react";

export type ScrollViewport = {
    offset: number;
    maxOffset: number;
    viewportHeight: number;
    scroll: (delta: number) => void;
    setMetrics: (content: number, viewport: number) => void;
};

export function useScrollViewport(): ScrollViewport {
    const [state, setState] = useState({ offset: 0, maxOffset: 0, viewportHeight: 0, stickBottom: true });
    const scroll = useCallback((delta: number) => {
        setState((current) => {
            const next = Math.max(0, Math.min(current.maxOffset, current.offset + delta));
            return { ...current, offset: next, stickBottom: next >= current.maxOffset };
        });
    }, []);
    const setMetrics = useCallback((content: number, viewport: number) => {
        setState((current) => {
            const maxOffset = Math.max(0, content - viewport);
            const offset = current.stickBottom ? maxOffset : Math.min(maxOffset, current.offset);
            return { offset, maxOffset, viewportHeight: viewport, stickBottom: offset >= maxOffset };
        });
    }, []);
    return useMemo(
        () => ({
            offset: state.offset,
            maxOffset: state.maxOffset,
            viewportHeight: state.viewportHeight,
            scroll,
            setMetrics,
        }),
        [state.offset, state.maxOffset, state.viewportHeight, scroll, setMetrics],
    );
}
