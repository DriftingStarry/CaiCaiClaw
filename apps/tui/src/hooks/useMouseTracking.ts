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
