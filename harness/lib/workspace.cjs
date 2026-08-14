"use strict";

const fs = require("node:fs");
const path = require("node:path");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isDirectory = (directoryPath) => {
    try {
        return fs.statSync(directoryPath).isDirectory();
    } catch {
        return false;
    }
};

const parseWorkspacePatterns = (workspacePath) => {
    const workspaceText = fs.readFileSync(workspacePath, "utf8");
    const patterns = [];
    let readingPackages = false;
    for (const line of workspaceText.split(/\r?\n/)) {
        if (/^packages:\s*$/.test(line)) {
            readingPackages = true;
            continue;
        }
        if (readingPackages) {
            const match = line.match(/^\s*-\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
            if (match) {
                patterns.push(match[1] ?? match[2] ?? match[3]);
                continue;
            }
            if (line.trim() !== "") {
                readingPackages = false;
            }
        }
    }
    if (patterns.length === 0) {
        throw new Error(`No workspace package patterns found in ${workspacePath}`);
    }
    return patterns;
};

const expandWorkspacePattern = (repoRoot, pattern) => {
    let directories = [repoRoot];
    for (const segment of pattern.split("/").filter(Boolean)) {
        const nextDirectories = [];
        for (const directory of directories) {
            if (segment.includes("*")) {
                const matcher = new RegExp(`^${segment.split("*").map(escapeRegExp).join(".*")}$`);
                for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
                    if (entry.isDirectory() && matcher.test(entry.name)) {
                        nextDirectories.push(path.join(directory, entry.name));
                    }
                }
            } else {
                const nextDirectory = path.join(directory, segment);
                if (isDirectory(nextDirectory)) {
                    nextDirectories.push(nextDirectory);
                }
            }
        }
        directories = nextDirectories;
    }
    return directories;
};

// 依赖图必须来自各包真实的 package.json，不要在任何地方手工维护第二份依赖表。
const loadWorkspace = (repoRoot) => {
    const workspacePatterns = parseWorkspacePatterns(path.join(repoRoot, "pnpm-workspace.yaml"));
    const packageDirectories = [...new Set(workspacePatterns.flatMap((pattern) => expandWorkspacePattern(repoRoot, pattern)))]
        .filter((directory) => fs.existsSync(path.join(directory, "package.json")));

    const packageByName = new Map();
    const packageByPath = new Map();
    for (const directory of packageDirectories) {
        const manifestPath = path.join(directory, "package.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const packagePath = path.relative(repoRoot, directory).split(path.sep).join("/");
        if (typeof manifest.name !== "string" || manifest.name.length === 0) {
            throw new Error(`Workspace package has no name: ${manifestPath}`);
        }
        if (packageByName.has(manifest.name)) {
            throw new Error(`Duplicate workspace package name: ${manifest.name}`);
        }
        const packageInfo = {manifest, packagePath};
        packageByName.set(manifest.name, packageInfo);
        packageByPath.set(packagePath, packageInfo);
    }

    const dependenciesByPath = new Map();
    for (const {manifest, packagePath} of packageByPath.values()) {
        const dependencies = new Set();
        for (const dependencySection of [manifest.dependencies, manifest.devDependencies]) {
            for (const [dependencyName, version] of Object.entries(dependencySection ?? {})) {
                if (typeof version !== "string" || !version.startsWith("workspace:")) {
                    continue;
                }
                const dependency = packageByName.get(dependencyName);
                if (!dependency) {
                    throw new Error(`Workspace dependency ${dependencyName} from ${packagePath} is not present in the workspace`);
                }
                dependencies.add(dependency.packagePath);
            }
        }
        dependenciesByPath.set(packagePath, dependencies);
    }

    const knownPaths = new Set(packageByPath.keys());

    const groupForPath = (touch) => {
        for (const pattern of workspacePatterns) {
            const patternSegments = pattern.split("/").filter(Boolean);
            const touchSegments = touch.split("/").filter(Boolean);
            if (patternSegments.length !== touchSegments.length) {
                continue;
            }
            let matches = true;
            for (let index = 0; index < patternSegments.length; index += 1) {
                if (!patternSegments[index].includes("*") && patternSegments[index] !== touchSegments[index]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                const wildcardIndex = patternSegments.findIndex((segment) => segment.includes("*"));
                return patternSegments.slice(0, wildcardIndex === -1 ? -1 : wildcardIndex).join("/");
            }
        }
        return null;
    };

    const closureCache = new Map();
    const closureFor = (packagePath) => {
        if (closureCache.has(packagePath)) {
            return closureCache.get(packagePath);
        }
        const closure = new Set();
        const pending = [...(dependenciesByPath.get(packagePath) ?? [])];
        while (pending.length > 0) {
            const dependency = pending.pop();
            if (closure.has(dependency)) {
                continue;
            }
            closure.add(dependency);
            pending.push(...(dependenciesByPath.get(dependency) ?? []));
        }
        closureCache.set(packagePath, closure);
        return closure;
    };

    // 未知路径（尚未创建的包）走保守启发式：跨 workspace 组视为存在依赖序。
    const isDownstream = (upstream, downstream) => {
        if (knownPaths.has(upstream) && knownPaths.has(downstream)) {
            return closureFor(downstream).has(upstream);
        }
        if (knownPaths.has(upstream) && !knownPaths.has(downstream)) {
            const upstreamGroup = groupForPath(upstream);
            const downstreamGroup = groupForPath(downstream);
            return upstreamGroup !== null && downstreamGroup !== null && upstreamGroup !== downstreamGroup;
        }
        return false;
    };

    return {workspacePatterns, packageByPath, dependenciesByPath, knownPaths, groupForPath, closureFor, isDownstream};
};

module.exports = {loadWorkspace};
