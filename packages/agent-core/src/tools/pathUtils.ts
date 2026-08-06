import { homedir } from "node:os";
import path from "node:path";

export function expandPath(filePath: string): string {
    if (filePath === "~") return homedir();
    if (filePath.startsWith("~/")) {
        return path.join(homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
}
