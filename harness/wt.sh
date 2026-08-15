#!/usr/bin/env bash
set -euo pipefail

current_worktree_root=$(git rev-parse --show-toplevel)
git_common_dir=$(git -C "$current_worktree_root" rev-parse --git-common-dir)
if [[ "$git_common_dir" == /* ]]; then
    git_common_dir=$(cd "$git_common_dir" && pwd)
else
    git_common_dir=$(cd "$current_worktree_root/$git_common_dir" && pwd)
fi
repo_root=$(dirname "$git_common_dir")
feature_file="$repo_root/feature_list.json"

usage() {
    echo "Usage: $0 new <feature-id> | list | rm <slug> [--force]" >&2
    exit 2
}

worktree_paths() {
    git -C "$repo_root" worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print }'
}

branch_slug() {
    printf '%s' "${1//\//-}"
}

lane_count() {
    mapfile -t state_paths < <("$repo_root/harness/lanes.sh" active-paths)
    printf '%s\n' "${#state_paths[@]}"
}

feature_json() {
    local feature_id=$1
    node - "$feature_file" "$feature_id" <<'NODE'
const fs = require("node:fs");

const featurePath = process.argv[2];
const featureId = process.argv[3];
const data = JSON.parse(fs.readFileSync(featurePath, "utf8"));
const feature = data.features.find((item) => item.id === featureId);
if (!feature) {
    console.error(`Feature not found: ${featureId}`);
    process.exit(1);
}
process.stdout.write(JSON.stringify({
    branch: feature.branch,
    touches: feature.touches,
    maxLanes: data.parallel.maxLanes,
}));
NODE
}

check_candidate() {
    local feature_id=$1
    "$repo_root/harness/lanes.sh" check-candidate "$feature_id"
}

create_state_files() {
    local target_root=$1
    local feature_id=$2
    local branch_name=$3
    local slug=$4
    local today
    today=$(date +%F)
    mkdir -p "$target_root/.harness/$slug"
    node - "$target_root/.harness/$slug/state.json" "$feature_id" "$branch_name" "$today" <<'NODE'
const fs = require("node:fs");

const [statePath, featureId, branch, today] = process.argv.slice(2);
const state = {
    featureId,
    branch,
    status: "in-progress",
    startedAt: today,
    lastUpdated: today,
    verification: {
        command: "./init.sh",
        result: "pending",
        at: today,
    },
    manualAcceptance: "尚未执行。",
    scopeNotes: "",
    evidence: "lane 已建立，待开始执行 feature。",
};
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 4)}\n`);
NODE
    cat > "$target_root/.harness/$slug/progress.md" <<EOF
# Lane: $branch_name ($feature_id)

## Current State
- **Last Updated:** $today
- **Status:** In Progress

## What's Done
- lane 分片已建立，尚未开始 feature 实现。

## What's In Progress
- 执行 feature \`$feature_id\`。

## What's Next
- 根据 \`feature_list.json\` 的 \`touches\` 开始实现并记录验证证据。

## Verification Evidence
| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Static verification | \`./init.sh\` | pending | lane 创建后尚未执行。 |

## Blockers / Risks
- 当前无 blocker。

## Decisions Made
- 本 lane 只写入自己的分片，不修改根级 \`feature_list.json\`、\`README.md\` 或其他 lane。

## Handoff Notes
- 工作未完成，下一次从本 lane 的 \`state.json\` 与本文件继续。
EOF
}

new_lane() {
    local feature_id=$1
    local feature_data
    feature_data=$(feature_json "$feature_id")
    local branch_name
    branch_name=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).branch)' "$feature_data")
    local max_lanes
    max_lanes=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).maxLanes))' "$feature_data")
    local slug
    slug=$(branch_slug "$branch_name")
    local target_root="$repo_root/../CaiCaiClaw-$slug"

    if [[ -z "$branch_name" || "$branch_name" == "undefined" ]]; then
        echo "Feature $feature_id has no branch." >&2
        exit 1
    fi
    if [[ ! "$max_lanes" =~ ^[0-9]+$ ]]; then
        echo "parallel.maxLanes must be a non-negative integer." >&2
        exit 1
    fi
    if (( $(lane_count) >= max_lanes )); then
        echo "Maximum lane count reached: $max_lanes" >&2
        exit 1
    fi
    if [[ -e "$repo_root/.harness/$slug" ]]; then
        echo "Lane slug already exists: $slug" >&2
        exit 1
    fi
    if [[ -e "$target_root" ]]; then
        echo "Worktree path already exists: $target_root" >&2
        exit 1
    fi
    if git show-ref --verify --quiet "refs/heads/$branch_name"; then
        echo "Local branch already exists: $branch_name" >&2
        exit 1
    fi

    check_candidate "$feature_id"
    "$repo_root/harness/lanes.sh" check
    git -C "$repo_root" worktree add "$target_root" -b "$branch_name" origin/main
    pnpm --dir "$target_root" install --frozen-lockfile
    create_state_files "$target_root" "$feature_id" "$branch_name" "$slug"
    echo "Created lane $slug at $target_root"
}

list_lanes() {
    "$repo_root/harness/lanes.sh" list
}

# 按 porcelain 状态行是否落在某个路径前缀内分流。mode=inside 只输出前缀内的行，
# mode=outside 只输出前缀外的行。必须用 --untracked-files=all：默认输出会把未跟踪
# 目录折叠成 ".harness/"，按文件路径前缀就匹配不到。
lane_status_lines() {
    local target_root=$1
    local prefix=$2
    local mode=$3
    local line
    local relative
    while IFS= read -r line; do
        relative=${line:3}
        if [[ "$relative" == "$prefix"* ]]; then
            if [[ "$mode" == "inside" ]]; then
                printf '%s\n' "$line"
            fi
        elif [[ "$mode" == "outside" ]]; then
            printf '%s\n' "$line"
        fi
    done < <(git -C "$target_root" status --porcelain --untracked-files=all)
}

remove_lane() {
    local slug=$1
    local force=${2:-}
    local target_root=""
    local worktree_path
    while IFS= read -r worktree_path; do
        if [[ -f "$worktree_path/.harness/$slug/state.json" ]]; then
            target_root=$worktree_path
            break
        fi
    done < <(worktree_paths)
    if [[ -z "$target_root" ]]; then
        echo "Lane not found: $slug" >&2
        exit 1
    fi
    if [[ "$target_root" == "$repo_root" ]]; then
        echo "Refusing to remove the current main worktree." >&2
        exit 1
    fi
    # 本 lane 自己的分片不计入"未提交改动"：它由 wt.sh new 生成且未跟踪，若计入则
    # 非 --force 的 rm 对任何新建 lane 都必然失败。分片外的改动仍然拦。
    local shard_prefix=".harness/$slug/"
    if [[ "$force" != "--force" ]]; then
        if [[ -n $(lane_status_lines "$target_root" "$shard_prefix" outside) ]]; then
            echo "Worktree has uncommitted changes outside $shard_prefix; use --force after review." >&2
            exit 1
        fi
        if [[ -n $(git -C "$target_root" log --oneline "origin/main..HEAD") ]]; then
            echo "Worktree has unmerged commits; use --force after review." >&2
            exit 1
        fi
    fi
    local pending_shard
    pending_shard=$(lane_status_lines "$target_root" "$shard_prefix" inside)
    if [[ -n "$pending_shard" ]]; then
        echo "Discarding uncommitted lane shard under $shard_prefix:" >&2
        printf '%s\n' "$pending_shard" >&2
    fi
    # 分片按设计是未跟踪文件，git worktree remove 会因此拒绝，所以固定传 --force。
    # 是否允许删除由上面那道 review 门槛决定，它比 git 自己的检查更严：既看分片外的
    # 改动，也看未合并提交。wt.sh 的 --force 跳过的是那道门槛，不是这里。
    git -C "$repo_root" worktree remove --force "$target_root"
    echo "Removed lane $slug at $target_root"
}

[[ $# -ge 1 ]] || usage
case "$1" in
    new)
        [[ $# -eq 2 ]] || usage
        new_lane "$2"
        ;;
    list)
        [[ $# -eq 1 ]] || usage
        list_lanes
        ;;
    rm)
        [[ $# -eq 2 || $# -eq 3 ]] || usage
        if [[ $# -eq 3 && "$3" != "--force" ]]; then
            echo "Invalid rm option: $3; expected --force." >&2
            exit 2
        fi
        remove_lane "$2" "${3:-}"
        ;;
    *)
        usage
        ;;
esac
