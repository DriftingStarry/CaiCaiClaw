export type MouseWheelDirection = "up" | "down";

/**
 * 组装缓冲上限。合法的 SGR 上报最长形如 `[<65;9999;9999M`（15 字节），
 * X10 固定 5 字节；取 64 留出宽裕余量，同时保证任何垃圾串都会在有界步数内被放弃，
 * 不会永久吞掉后续按键。
 */
export const MAX_MOUSE_SEQUENCE_LENGTH = 64;

export type MouseSequenceResult =
    | { status: "consumed"; wheel?: MouseWheelDirection; remainder?: string }
    | { status: "pending" }
    | { status: "passthrough"; value: string };

type PendingSequence = {
    kind: "sgr" | "x10";
    value: string;
};

type MouseSequenceConsumer = {
    consume: (chunk: string) => MouseSequenceResult;
};

/**
 * SGR(1006) 的合法前缀：`[<` 之后是 1..3 个分号分隔的十进制字段，末字段可为空（仍在输入中）。
 * 不接受空的前置字段，避免把 `[<;;` 这类文本误判为鼠标序列候选。
 */
const SGR_PREFIX = /^\[<\d+(?:;\d+)*;?$|^\[<\d*$/;
const SGR_SEQUENCE = /^\[<(\d+);(\d+);(\d+)([Mm])/;
/** X10 上报固定为 `[M` 后跟 button / col / row 三个字节。 */
const X10_LENGTH = 5;

export function createMouseSequenceConsumer(): MouseSequenceConsumer {
    let pending: PendingSequence | undefined;

    const consume = (chunk: string): MouseSequenceResult => {
        if (pending) return consumePending(chunk);
        return consumeNew(chunk);
    };

    const consumeNew = (chunk: string): MouseSequenceResult => {
        // 鼠标上报的判别前缀是 `[<`（SGR）或 `[M`（X10）。ink 已剥掉前导 ESC，
        // 所以裸 `[` 之后完全可能是普通文本，不能据此进入组装状态。
        if (!chunk.startsWith("[")) return { status: "passthrough", value: chunk };
        if (chunk.startsWith("[M")) return consumeX10(chunk);

        const sgrMatch = SGR_SEQUENCE.exec(chunk);
        if (sgrMatch) {
            return consumedResult(Number(sgrMatch[1]), chunk.slice(sgrMatch[0].length));
        }
        if (isSgrCandidate(chunk)) {
            if (chunk.length > MAX_MOUSE_SEQUENCE_LENGTH) return { status: "passthrough", value: chunk };
            pending = { kind: "sgr", value: chunk };
            return { status: "pending" };
        }
        return { status: "passthrough", value: chunk };
    };

    const consumePending = (chunk: string): MouseSequenceResult => {
        const buffered = pending?.value ?? "";
        const kind = pending?.kind;
        if (!kind) return { status: "passthrough", value: chunk };

        const candidate = `${buffered}${chunk}`;
        // 超出上限说明这串不是鼠标上报。缓冲内容原样回吐为普通输入：
        // 它是用户真实敲入或粘贴的字符，静默丢弃会造成可见的输入丢失。
        if (candidate.length > MAX_MOUSE_SEQUENCE_LENGTH) {
            pending = undefined;
            return { status: "passthrough", value: candidate };
        }

        if (kind === "x10") return consumeX10(candidate);

        const sgrMatch = SGR_SEQUENCE.exec(candidate);
        if (sgrMatch) {
            pending = undefined;
            return consumedResult(Number(sgrMatch[1]), candidate.slice(sgrMatch[0].length));
        }
        if (isSgrCandidate(candidate)) {
            pending = { kind: "sgr", value: candidate };
            return { status: "pending" };
        }

        // 被证伪：回吐完整缓冲，让普通输入路径处理，避免吞掉用户按键。
        pending = undefined;
        return { status: "passthrough", value: candidate };
    };

    const consumeX10 = (candidate: string): MouseSequenceResult => {
        if (candidate.length < X10_LENGTH) {
            pending = { kind: "x10", value: candidate };
            return { status: "pending" };
        }
        pending = undefined;
        // X10 把每个字节偏移 32 编码；减回后 64/65 与 SGR 的滚轮 button 一致。
        const button = candidate.charCodeAt(2) - 32;
        return consumedResult(button, candidate.slice(X10_LENGTH));
    };

    return { consume };
}

function isSgrCandidate(value: string): boolean {
    return SGR_PREFIX.test(value);
}

function consumedResult(button: number, remainder: string): MouseSequenceResult {
    const wheel = button === 64 ? "up" : button === 65 ? "down" : undefined;
    return remainder ? { status: "consumed", wheel, remainder } : { status: "consumed", wheel };
}
