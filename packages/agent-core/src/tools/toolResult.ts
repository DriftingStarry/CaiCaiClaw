import { errorMessage } from "@caicaiclaw/utils";

export async function wrapToolResult<T>(operationName: string, execute: () => Promise<T>) {
    try {
        return await execute();
    } catch (error) {
        return {
            error: `${operationName} failed`,
            detail: errorMessage(error),
        };
    }
}
