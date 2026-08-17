import { Box, Key, Text, useApp, useInput, usePaste, useWindowSize } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { getTuiWsUrl } from "../config";
import { createMouseSequenceConsumer } from "../hooks/mouseSequence";
import { useMouseTracking } from "../hooks/useMouseTracking";
import { TextBuffer, useTextBuffer } from "../hooks/useTextBuffer";
import { useScrollViewport } from "../hooks/useScrollViewport";
import { useAgentClient } from "../state/useAgentClient";
import { Composer } from "./Composer";
import { HeaderBar } from "./HeaderBar";
import { SettingsModal } from "./SettingsModal";
import { Transcript } from "./Transcript";

export function App(): React.ReactElement {
    const { exit } = useApp();
    const { rows } = useWindowSize();
    const [url, setUrl] = useState(getTuiWsUrl());
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [confirmExit, setConfirmExit] = useState(false);
    const client = useAgentClient(url);
    const input = useTextBuffer();
    const settings = useTextBuffer(url);
    const controls = useScrollViewport();
    const mouseSequence = useRef(createMouseSequenceConsumer()).current;
    useMouseTracking();
    useEffect(() => {
        if (!confirmExit) return;
        const timer = setTimeout(() => setConfirmExit(false), 3000);
        return () => clearTimeout(timer);
    }, [confirmExit]);
    const submit = () => {
        const text = input.value.trim();
        if (text && client.connectionStatus === "connected") {
            client.sendInput(text);
            input.clear();
        }
    };
    const handleInput = (rawValue: string, key: Key) => {
        const mouseResult = mouseSequence.consume(rawValue);
        // 组装中：整块吞掉，等后续 chunk 补全，不能落入任何输入缓冲。
        if (mouseResult.status === "pending") return;

        let value = rawValue;
        if (mouseResult.status === "consumed") {
            if (mouseResult.wheel) controls.scroll(mouseResult.wheel === "up" ? -3 : 3);
            if (!mouseResult.remainder) return;
            value = mouseResult.remainder;
        } else if (mouseResult.value !== rawValue) {
            // 组装被证伪后回吐的缓冲跨越了多个 chunk，当前 key 只描述最后一个 chunk。
            // 直接按文本插入，避免用错位的 key 走进 editBuffer 的特殊键分支而丢掉这段文本。
            (settingsOpen ? settings : input).insert(mouseResult.value);
            return;
        }
        if (settingsOpen) {
            if (key.escape || key.tab) {
                setSettingsOpen(false);
                return;
            }
            if (key.return) {
                const nextUrl = settings.value || getTuiWsUrl();
                try {
                    const parsed = new URL(nextUrl);
                    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
                        throw new Error("ws_url 必须使用 ws: 或 wss: 协议");
                    setUrl(nextUrl);
                } catch (error) {
                    client.reportError(error instanceof Error ? error.message : "ws_url 无效");
                }
                setSettingsOpen(false);
                return;
            }
            editBuffer(settings, value, key);
            return;
        }
        if (key.ctrl && value === "d") {
            if (confirmExit) exit();
            else setConfirmExit(true);
            return;
        }
        if (key.tab) {
            settings.set(url);
            setSettingsOpen(true);
            return;
        }
        if (key.pageUp) {
            controls.scroll(-Math.max(1, controls.viewportHeight - 1));
            return;
        }
        if (key.pageDown) {
            controls.scroll(Math.max(1, controls.viewportHeight - 1));
            return;
        }
        editBuffer(input, value, key, submit);
    };
    useInput(handleInput);
    usePaste((text) => {
        if (settingsOpen) settings.insert(text.replaceAll("\n", ""));
        else input.insert(text);
    });
    return (
        <Box flexDirection="column" height={rows}>
            <HeaderBar status={client.connectionStatus} />
            <Box flexGrow={1} minHeight={0} overflowY="hidden">
                {settingsOpen ? (
                    <SettingsModal buffer={settings} status={client.connectionStatus} clientId={client.clientId} />
                ) : (
                    <Transcript state={client} controls={controls} />
                )}
            </Box>
            {client.errors.at(-1) ? <Text color="red">error: {client.errors.at(-1)}</Text> : null}
            <Composer buffer={input} connected={client.connectionStatus === "connected"} />
            {confirmExit ? <Text color="yellow">再按一次 Ctrl+D 退出</Text> : null}
        </Box>
    );
}

function editBuffer(buffer: TextBuffer, value: string, key: Key, submit?: () => void): void {
    if (key.return) {
        if (key.shift) buffer.insert("\n");
        else submit?.();
        return;
    }
    if (key.backspace) {
        buffer.backspace();
        return;
    }
    if (key.delete) {
        buffer.remove();
        return;
    }
    if (key.leftArrow) {
        buffer.moveLeft();
        return;
    }
    if (key.rightArrow) {
        buffer.moveRight();
        return;
    }
    if (key.home) {
        buffer.home();
        return;
    }
    if (key.end) {
        buffer.end();
        return;
    }
    if (value && !key.ctrl && !key.meta) buffer.insert(value);
}
