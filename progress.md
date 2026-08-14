# Session Progress Log (Integration View)

## Current State

- **Last Updated:** 2026-08-14
- **Status:** main 集成视图，当前已有 M1 基础能力
- **Product Source:** `README.md` 的产品愿景、里程碑与领域设计

## What's Done

- M1 的 shared runtime、Web observer、client-core 状态归约、上下文构建、prompt 文件化和 JSONL 事件恢复已在 README 标记为完成。
- 已建立 harness：任务池、lane 分片、并行互斥检查和统一验证入口。
- harness 字段约束已成文（AGENTS.md 的 Harness File Fields）并由 `harness/lanes.sh validate` 强制，已并入 `./init.sh`。
- 验证门槛与当前 CI 对齐，并明确不引入测试计划。

## What's Next

1. 为 `feat-001` 开 lane（`harness/wt.sh new feat-001`），补齐 TUI 客户端并完成双端共享 runtime 的手动验收。
2. lane 合并回 main 后更新本集成日志和任务池状态。

## Blockers / Risks

- 当前无 blocker。
- 仓库没有自动化测试计划；运行时回归依赖静态检查和有记录的手动验收。

## Decisions Made

- README 保持产品愿景、架构意图与长期路线图的唯一来源；`feature_list.json` 只追踪当前可执行单元。
- harness 不安装依赖、不启动服务，也不新增测试命令；`init.sh` 仅执行现有 CI 对应的静态检查。
- 并行开发使用 git worktree；高频状态写入按分支 slug 分片到 `.harness/<branch-slug>/`，根级文件仅保留 main 集成视图。
- 不再以 `validate-harness.mjs` 为完成门槛，避免为通过结构校验器而妥协 harness 语义。
- harness 字段以 `harness/lanes.sh validate` 为硬门槛：缺字段、类型错误、枚举越界、branch/slug 不一致会失败；未知字段与 `touches` 指向尚未创建的包只告警。`status` 枚举写错的失效方向是 fail-open，因此必须强制。
- 删除 `feature_list.json` 的 `activeFeatureIds`：活跃 lane 的真相源只有各 worktree 的 `state.json`，保留第二份活跃列表必然 drift。
- 依赖图与未知路径启发式抽到 `harness/lib/workspace.cjs` 共享，避免出现第二份依赖表（这正是先前依赖判定漏报的成因）。`harness/` 下的 node 工具脚本使用 CJS，属于 ESM 不变量的显式例外。

## Evidence of Completion

- Static verification: `./init.sh` 通过；`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 均无错误。
- Lane verification: `harness/lanes.sh list`、`harness/lanes.sh check`、`harness/lanes.sh validate` 与 `harness/wt.sh list` 均成功；当前 0 个活跃 lane。
- Harness regression: 依赖判定 12 个用例（含传递闭包、无关包、未知路径、重叠）与 `validate` 8 个用例（枚举越界、缺字段、未知字段、slug 不符、branch 不一致、JSON 损坏、废弃字段）实测符合预期。
- `feat-001` 为 `planned`，尚未开 lane，因此 `.harness/` 下暂无分片；TUI 尚无双端共享 runtime 的手动验收证据。
- Worktree 清理已执行：移除停在 `6df2cf2` 的 `CaiCaiClaw-tui`、prune 掉 gitdir 失效的 `cc-ci` 注册，并删除已并入 main 的 `feature/tui` 分支（`wt.sh new` 在同名分支已存在时会拒绝开 lane）。
- 未执行依赖安装，也未执行 `wt.sh new/rm`；这两者的实际生命周期验收留待后续授权。
