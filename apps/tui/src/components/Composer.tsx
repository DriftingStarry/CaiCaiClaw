import { Box, Text } from "ink";
import React from "react";
import { TextBuffer } from "../hooks/useTextBuffer";

export function Composer({ buffer, connected }: { buffer: TextBuffer; connected: boolean }): React.ReactElement {
    const graphemes = Array.from(buffer.value);
    const before = graphemes.slice(0, buffer.cursor).join("");
    const cursorChar = graphemes[buffer.cursor] ?? " ";
    const after = graphemes.slice(buffer.cursor + 1).join("");
    const lines = `${before}${cursorChar}${after}`.split("\n");
    const cursorLine = before.split("\n").length - 1;
    const cursorColumn = Array.from(before.split("\n").at(-1) ?? "").length;
    const firstLine = Math.max(0, Math.min(cursorLine, lines.length - 5));
    return (
        <Box
            flexDirection="column"
            flexShrink={0}
            borderStyle="single"
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
        >
            <Text>
                {lines.slice(firstLine, firstLine + 5).map((line, index) => (
                    <React.Fragment key={`${firstLine + index}-${line}`}>
                        {index > 0 ? "\n" : null}
                        {firstLine + index === cursorLine ? (
                            <>
                                <Text color="cyan">› </Text>
                                {Array.from(line).slice(0, cursorColumn).join("")}
                                <Text inverse>{cursorChar}</Text>
                                {Array.from(line)
                                    .slice(cursorColumn + 1)
                                    .join("")}
                            </>
                        ) : (
                            line
                        )}
                    </React.Fragment>
                ))}
            </Text>
            <Text dimColor>
                {connected ? "enter 发送 · shift+enter 换行（需终端支持 kitty 键盘协议）" : "等待连接后才能发送"}
            </Text>
        </Box>
    );
}
