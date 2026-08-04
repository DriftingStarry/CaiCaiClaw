export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export function toJsonObject(value: unknown): JsonObject {
    const jsonValue = toJsonValue(value);
    return isJsonObject(jsonValue) ? jsonValue : {};
}

export function toJsonValue(value: unknown): JsonValue {
    if (value === null) return null;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return Number.isFinite(value) || typeof value !== "number" ? value : String(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }

    if (typeof value === "object") {
        const entries = Object.entries(value).map(([key, entryValue]) => [key, toJsonValue(entryValue)]);
        return Object.fromEntries(entries) as JsonObject;
    }

    return String(value);
}

export function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
