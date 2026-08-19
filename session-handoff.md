# Session Handoff

## Current Objective

- Goal: 把 harness 从多 worktree lane 变式改回 harness-creator 原本的单 lane 模式，并保留既有状态。
- Current status: 完成。三个已完成 feature 的状态与证据已合并进 `feature_list.json` 与 `progress.md`，lane 机制已移除。
- Branch / commit: `main`，基线 `f681863`。

## Completed This Session

- [x] `feature_list.json` 迁移到 canonical schema（`id` / `name` / `description` / `status` / `dependencies` / `doneCriteria` / `evidence`），去掉 `schemaVersion`、`parallel.maxLanes`、`touches`、`branch`。
- [x] 三个 lane 分片的 progress 与 state 合并进根级 `progress.md`，保留全部 blockers、risks、decisions 与验证证据。
- [x] 两项已知残留（TUI 鼠标序列消费、server compact 入口）登记为 feat-005 / feat-004，不再只存在于 lane 笔记里。
- [x] `AGENTS.md` 去掉 Parallel Work、lane 分片路由和自定义字段校验表，加入 one-feature-at-a-time 与 Escalation。
- [x] `init.sh` 去掉 lane 检测与 `harness/lanes.sh validate`，只保留 pnpm 静态检查三连。
- [x] 删除 `harness/lanes.sh`、`harness/wt.sh`、`harness/lib/workspace.cjs` 与 `.harness/` 分片目录。
- [x] `eslint.config.mjs` 移除已失效的 `harness/**/*.cjs` CJS override。

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Harness structure | `node scripts/validate-harness.mjs --target .` | 100/100 | 五个子系统全部 5/5，无 bottleneck。迁移前为 76/100（bottleneck: state）。 |
| Static verification | `./init.sh` | pass | `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过。 |
| Diff hygiene | `git diff --check` | pass | 无空白错误。 |

## Files Changed

- `AGENTS.md` — 重写为 canonical 单 lane 模式
- `feature_list.json` — 迁移 schema，新增 feat-004 / feat-005
- `progress.md` — 新建，合并三个 lane 的状态
- `session-handoff.md` — 新建
- `init.sh` — 简化为静态检查入口
- `eslint.config.mjs` — 删除 harness CJS override
- 删除：`harness/lanes.sh`、`harness/wt.sh`、`harness/lib/workspace.cjs`、`.harness/**`

## Decisions Made

- 保留 `AGENTS.md` 中项目特有的依赖方向表与协议/状态不变量：这些是真实工程约束，不属于 lane 机制。
- 不保留 lane 的 `touches` 字段。范围边界改由 `progress.md` 的散文记录承担，避免再维护一套自定义校验。
- `.harness/` 与 `harness/` 均由 git 跟踪，删除可通过 `git revert` 或 `git checkout f681863 -- harness .harness` 恢复。

## Blockers / Risks

- 无迁移相关 blocker。项目自身的残留风险见 `progress.md` 的 Blockers / Risks（TUI 鼠标序列消费、真实终端验收未执行、字素簇切分、reasoning 交错、compact 无服务端入口）。

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- 选定 feat-004（server compact / memory 调度入口）或 feat-005（TUI 鼠标修复与真实终端验收），先补全其 `doneCriteria`，再开工。

## feat-010 Handoff

- feat-010 已完成，`feature_list.json` 状态为 `done`。
- 三个可独立回滚提交：`33c4fe5`（agent-core lane/target）、`c57fa3d`（protocol v5 与连接角色）、`70f6101`（server 定向路由及 adapter 入站 channel 校验）。
- `./init.sh` 与真实 WebSocketServer harness 均通过；harness 覆盖 observer 全量、匹配/错配 adapter、未声明 role 先 ping、伪造入站 channel，临时文件已清理。
