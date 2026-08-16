import { useEffect } from "react";

export function useMouseTracking(): void {
    useEffect(() => {
        if (!process.stdout.isTTY) return;
        process.stdout.write("\x1b[?1000h\x1b[?1006h");
        return () => {
            process.stdout.write("\x1b[?1006l\x1b[?1000l");
        };
    }, []);
}

export function parseMouseWheel(input: string): "up" | "down" | undefined {
    const match = /^\[<(\d+);(\d+);(\d+)[Mm]$/.exec(input);
    if (!match) return undefined;
    return match[1] === "64" ? "up" : match[1] === "65" ? "down" : undefined;
}
