import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MEMORY_BUDGETS = {
    system: 12_000,
    role: 8_000,
    memory: 16_000,
    tasksIndex: 8_000,
} as const;
export type MemoryBudgets = { [Key in keyof typeof DEFAULT_MEMORY_BUDGETS]?: number };

export type MemorySnapshot = {
    system: string;
    role: string;
    memory: string;
    tasksIndex: string;
};

export type MemorySnapshotOptions = {
    directory: string;
    systemPath?: string;
    budgets?: MemoryBudgets;
    allowMissing?: boolean;
};

export function readMemorySnapshot(options: MemorySnapshotOptions): MemorySnapshot {
    const budgets = resolveMemoryBudgets(options.budgets);
    const systemPath = options.systemPath ?? join(options.directory, "SYSTEM.md");
    return {
        system: systemPath === "" ? "" : readMemoryFile(systemPath, budgets.system),
        role: readMemoryFile(join(options.directory, "Role.md"), budgets.role, options.allowMissing),
        memory: readMemoryFile(join(options.directory, "Memory.md"), budgets.memory, options.allowMissing),
        tasksIndex: readMemoryFile(
            join(options.directory, "tasks", "Index.md"),
            budgets.tasksIndex,
            options.allowMissing,
        ),
    };
}

function resolveMemoryBudgets(
    overrides: MemoryBudgets | undefined,
): Record<keyof typeof DEFAULT_MEMORY_BUDGETS, number> {
    const budgets = {
        system: overrides?.system ?? DEFAULT_MEMORY_BUDGETS.system,
        role: overrides?.role ?? DEFAULT_MEMORY_BUDGETS.role,
        memory: overrides?.memory ?? DEFAULT_MEMORY_BUDGETS.memory,
        tasksIndex: overrides?.tasksIndex ?? DEFAULT_MEMORY_BUDGETS.tasksIndex,
    };

    for (const [name, budget] of Object.entries(budgets)) {
        if (!Number.isInteger(budget) || budget < 1) {
            throw new Error(`memory budget ${name} must be a positive integer`);
        }
    }
    return budgets;
}

function readMemoryFile(path: string, budget: number, allowMissing = false): string {
    let content: string;
    try {
        content = readFileSync(path, "utf-8");
    } catch (error) {
        if (allowMissing && isMissingFile(error)) return "";
        throw new Error(
            `memory file ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
            {
                cause: error,
            },
        );
    }

    if (content.length > budget) {
        throw new Error(`memory file ${path} exceeds its budget of ${budget} characters`);
    }
    return content;
}

function isMissingFile(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
