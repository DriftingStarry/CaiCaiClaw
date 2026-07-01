import path from "node:path";

export function expandPath(filePath: string): string {
    if (filePath === "~") return process.env.HOME ?? filePath;
    if (filePath.startsWith("~/")) {
        return path.join(process.env.HOME ?? "~", filePath.slice(2));
    }
    return path.resolve(filePath);
}

function splitLinesWithEndings(content: string) {
    return content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

export function positionToOffset(content: string, line: number, column: number): number {
    if (line < 1) throw new Error("line must be greater than or equal to 1");
    if (column < 1) throw new Error("column must be greater than or equal to 1");

    const lines = splitLinesWithEndings(content);
    if (line > lines.length + 1) {
        throw new Error(`line ${line} is out of range; file has ${lines.length} lines`);
    }

    let offset = 0;
    for (let index = 0; index < line - 1; index += 1) {
        offset += lines[index]?.length ?? 0;
    }

    const currentLine = lines[line - 1] ?? "";
    const lineWithoutEnding = currentLine.replace(/\r\n|\r|\n$/, "");
    if (column > lineWithoutEnding.length + 1) {
        throw new Error(
            `column ${column} is out of range on line ${line}; line has ${lineWithoutEnding.length} characters`,
        );
    }

    return offset + column - 1;
}

export function addLineNumbers(content: string, startLine: number): string {
    const lines = content.length === 0 ? [""] : content.split(/\r\n|\r|\n/);
    return lines.map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`).join("\n");
}
