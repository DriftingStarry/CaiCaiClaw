import { useCallback, useState } from "react";

export type TextBuffer = {
    value: string;
    cursor: number;
    insert: (text: string) => void;
    backspace: () => void;
    remove: () => void;
    moveLeft: () => void;
    moveRight: () => void;
    home: () => void;
    end: () => void;
    set: (value: string) => void;
    clear: () => void;
};

export function useTextBuffer(initialValue = ""): TextBuffer {
    const [buffer, setBuffer] = useState(() => ({ value: initialValue, cursor: Array.from(initialValue).length }));
    const insert = useCallback((text: string) => {
        setBuffer((current) => {
            const graphemes = Array.from(current.value);
            const inserted = Array.from(text);
            graphemes.splice(current.cursor, 0, ...inserted);
            return { value: graphemes.join(""), cursor: current.cursor + inserted.length };
        });
    }, []);
    return {
        value: buffer.value,
        cursor: buffer.cursor,
        insert,
        backspace: () => {
            setBuffer((current) => {
                if (current.cursor === 0) return current;
                const graphemes = Array.from(current.value);
                graphemes.splice(current.cursor - 1, 1);
                return { value: graphemes.join(""), cursor: current.cursor - 1 };
            });
        },
        remove: () =>
            setBuffer((current) => {
                const graphemes = Array.from(current.value);
                if (current.cursor >= graphemes.length) return current;
                graphemes.splice(current.cursor, 1);
                return { value: graphemes.join(""), cursor: current.cursor };
            }),
        moveLeft: () => setBuffer((current) => ({ ...current, cursor: Math.max(0, current.cursor - 1) })),
        moveRight: () =>
            setBuffer((current) => ({
                ...current,
                cursor: Math.min(Array.from(current.value).length, current.cursor + 1),
            })),
        home: () => setBuffer((current) => ({ ...current, cursor: 0 })),
        end: () => setBuffer((current) => ({ ...current, cursor: Array.from(current.value).length })),
        set: (value: string) => setBuffer({ value, cursor: Array.from(value).length }),
        clear: () => setBuffer({ value: "", cursor: 0 }),
    };
}
