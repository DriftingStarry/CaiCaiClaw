#!/usr/bin/env bash
set -euo pipefail

echo "=== CaiCaiClaw verification ==="

branch_name=$(git rev-parse --abbrev-ref HEAD)
repo_root=$(git rev-parse --show-toplevel)
if [[ "$branch_name" == "HEAD" ]]; then
    echo "Detached HEAD detected; check out a named branch before using init.sh so a lane slug can be derived." >&2
    exit 1
fi
branch_slug=${branch_name//\//-}
lane_dir="$repo_root/.harness/$branch_slug"
lane_state="$lane_dir/state.json"

git_common_dir=$(git rev-parse --git-common-dir)
if [[ "$git_common_dir" != /* ]]; then
    git_common_dir="$repo_root/$git_common_dir"
fi
main_root=$(cd "$(dirname "$git_common_dir")" && pwd)

echo "Worktree branch: $branch_name"
echo "Worktree root: $repo_root"

if [[ -f "$lane_state" ]]; then
    node - "$lane_state" <<'NODE'
const fs = require("node:fs");

const statePath = process.argv[2];
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
console.log(`Lane: ${state.featureId} (${state.status})`);
NODE
    next_steps="Next steps: read $lane_dir/state.json and $lane_dir/progress.md, then work only on this lane's declared scope."
else
    echo "Lane: 当前分支尚未建立 lane 分片"
    next_steps="Next steps: read $main_root/progress.md and $main_root/feature_list.json for the integration view; create a lane with harness/wt.sh new <feature-id> before making feature changes."
fi

echo "=== harness validate ==="
"$main_root/harness/lanes.sh" validate

if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Install the repository's declared pnpm version before continuing." >&2
    exit 1
fi

if [[ ! -d node_modules ]]; then
    echo "node_modules is missing. This is expected for a new worktree; dependency installation is intentionally not automatic." >&2
    echo "Run pnpm install --frozen-lockfile in this worktree only after obtaining any required approval." >&2
    exit 1
fi

echo "=== pnpm typecheck ==="
pnpm typecheck

echo "=== pnpm lint ==="
pnpm lint

echo "=== pnpm format:check ==="
pnpm format:check

echo "=== Verification complete ==="
echo "$next_steps"
