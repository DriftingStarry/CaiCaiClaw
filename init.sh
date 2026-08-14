#!/usr/bin/env bash
set -euo pipefail

echo "=== CaiCaiClaw verification ==="

if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Install the repository's declared pnpm version before continuing." >&2
    exit 1
fi

if [[ ! -d node_modules ]]; then
    echo "node_modules is missing. Dependency installation is intentionally not automatic." >&2
    echo "Run pnpm install only after obtaining any required approval." >&2
    exit 1
fi

echo "=== pnpm typecheck ==="
pnpm typecheck

echo "=== pnpm lint ==="
pnpm lint

echo "=== pnpm format:check ==="
pnpm format:check

echo "=== Verification complete ==="
echo "Next steps: read feature_list.json and progress.md, then work on only the active item."
