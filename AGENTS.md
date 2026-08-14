# CaiCaiClaw Agent Harness

本文件只保存 agent 每次工作都必须遵守的启动路径、工程不变量和完成门槛。产品愿景、里程碑与领域设计以 `README.md` 为准；不要把路线图复制到这里。

## Startup Workflow

开始修改前：

1. 运行 `pwd` 与 `git status --short --branch`，确认仓库位置和用户已有改动。
2. 完整阅读本文件；按任务需要读取 `README.md` 的相关里程碑和相关源码。
3. 读取 `feature_list.json` 与 `progress.md`，并定位当前分支对应的 `.harness/<branch-slug>/state.json` 与 `.harness/<branch-slug>/progress.md`。
4. 在依赖已安装且任务涉及仓库文件时运行 `./init.sh`，记录基线。若基线已有与本任务无关的失败，记录后继续限定范围，不擅自修复无关问题。
5. 先确认目标、成功标准、影响模块和验证方式，再编辑文件。

## State And Scope

- **One feature per worktree**：每个 worktree / 分支同时只有一个 `in-progress` lane。仓库整体允许多个 lane 并行，但当前 agent 只读写自己领取的那一个。
- **Lane 状态真相源**：分支内以 `.harness/<branch-slug>/state.json` 为准。`feature_list.json` 与 `progress.md` 是 main 上的集成视图，在 feature 分支上会 stale，**禁止在分支内修改**。
- **Stay in scope**：只修改当前 lane 的 `touches` 声明覆盖的路径；需要越界时先在 `scopeNotes` 记录理由，合并时同步回任务池。
- 不修改其他 lane 的分片文件，不编辑其他 worktree 的工作树。
- 小型修复、一次性文档修改和只读分析无需制造 feature 记录；跨会话或影响多个模块的工作才进入 `feature_list.json`。
- 不覆盖、回滚或删除用户已有改动。遇到重叠改动时先理解并在其基础上工作。
- 当前需求与 README 冲突时先指出偏差；不要静默改变产品方向。

## Parallel Work

- 并行开发通过 git worktree 进行，一个 worktree 一个 lane，不在同一 worktree 内切换 feature。
- lane 分片目录名由分支名派生：`/` 替换为 `-`（`feature/tui` -> `.harness/feature-tui/`）。
- 开 lane 前：确认目标 feature 在 `feature_list.json` 已登记（含 `touches`），且与所有 `in-progress` lane 通过互斥判据。
- 互斥判据：`touches` 相交 → 禁止并行；涉及对方下游依赖 → 有序并行，等对方合并后 rebase；改动 `packages/protocol` 或 `packages/utils` 的 lane 建议独占。
- 新 feature 只在 main 上登记并合并，不在 feature 分支新增任务池条目。
- 每个 worktree 必须独立 `pnpm install`；禁止共享或软链 `node_modules`（`workspace:*` 会链到错误的源码树）。
- 集成顺序：上游包（`utils`、`protocol`）的 lane 先合并，下游 lane 随后 rebase 再验证。
- 运行环境未做隔离：多个 worktree 同时启动 server 会撞端口 8787 并共写 `~/.caicaiclaw/history.jsonl`。需要并行运行时自行配置 `.env`。

## Harness File Fields

`feature_list.json` 与 `.harness/<slug>/state.json` 的字段由 `harness/lanes.sh validate` 校验，该命令已并入 `./init.sh`，是硬门槛。**不要新增下表以外的字段**：未知字段告警，缺字段、类型错误和枚举越界直接失败。

`feature_list.json`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 整数 | 当前为 `2` |
| `parallel.maxLanes` | 非负整数 | 允许同时存在的活跃 lane 上限 |
| `features[].id` | 非空字符串 | 全表唯一 |
| `features[].name` | 非空字符串 | 简短标题 |
| `features[].description` | 非空字符串 | 执行单元范围 |
| `features[].status` | 枚举 | `planned` \| `claimed` \| `in-progress` \| `blocked` \| `integrating` \| `done` |
| `features[].touches` | 非空字符串数组 | 只写 `packages/<name>` 或 `apps/<name>`，与依赖表同一套路径写法 |
| `features[].branch` | 非空字符串 | lane 分片目录名由它派生 |
| `features[].doneCriteria` | 非空字符串数组 | 可验证的验收条件 |
| `features[].dependencies` | 字符串数组，可选 | 引用其他 feature 的 `id` |
| `features[].evidence` | 字符串，可选 | 当前证据摘要 |

`.harness/<slug>/state.json`，全部必填：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `featureId` | 非空字符串 | 必须能在 `feature_list.json` 中解析到 |
| `branch` | 非空字符串 | 必须与该 feature 的 `branch` 相同，且派生 slug 等于分片目录名 |
| `status` | 枚举 | `claimed` \| `in-progress` \| `blocked` \| `integrating` \| `done`；分片存在即意味着 lane 至少已 claimed，故无 `planned` |
| `startedAt` | 字符串 | `YYYY-MM-DD` |
| `lastUpdated` | 字符串 | `YYYY-MM-DD` |
| `verification.command` | 非空字符串 | 通常是 `./init.sh` |
| `verification.result` | 枚举 | `pending` \| `pass` \| `fail` |
| `verification.at` | 字符串 | `YYYY-MM-DD` |
| `manualAcceptance` | 字符串 | 可为空串，但键必须存在 |
| `scopeNotes` | 字符串 | 越界改动的理由写在这里 |
| `evidence` | 字符串 | 已落地内容与验证证据 |

- `status` 是唯一被脚本消费的枚举。写成表外取值不会报错，而是让该 lane 静默退出冲突判定与 `maxLanes` 计数，等于放行本应被拦的并行；改它前先确认取值在上表内。
- 活跃 lane 的真相源只有各 worktree 的 `state.json`。不要在 `feature_list.json` 里另设活跃列表字段。
- `touches` 允许写尚未创建的包路径（如新建 `apps/tui`），`validate` 与 `check` 会告警并按保守启发式判定依赖序，但不阻断。
- 根级 `progress.md` 与 lane 分片的 `progress.md` 不做字段校验，按现有章节结构书写即可。

## Architecture Invariants

- 使用 `pnpm`、TypeScript、ESM 与 Bundler module resolution；不引入 CommonJS。唯一例外是 `harness/` 下的 node 工具脚本：它们由 `node -` 直接执行，不经构建也不依赖 `node_modules`，因此使用 CJS（`.cjs`），并在 `eslint.config.mjs` 中单独配置。该例外不适用于 `apps/` 与 `packages/`。
- 本地 TypeScript/TSX 相对导入不带扩展名；CSS 等资源导入保留扩展名。
- 根目录只做 workspace 编排，不放业务代码。依赖方向必须保持单向：

```text
packages/utils        <- 无工作区依赖
packages/protocol     <- utils
packages/agent-core   <- utils
packages/client-core  <- protocol, utils
apps/server           <- agent-core, protocol, utils
apps/web              <- client-core, protocol, utils
```

该表以各包 `package.json` 中的 `workspace:*` 条目为准，与 `touches` 使用同一套路径写法。新增或调整 workspace 依赖时同步本表；`harness/lanes.sh` 不读本表，它在运行时扫描 `pnpm-workspace.yaml` 覆盖的 `package.json` 并计算传递闭包。

- `agent-core` 不依赖 `protocol`；传输层不承载核心业务决策。
- 对外协议变更必须同步类型、Zod schema、解析与序列化；新增 workspace 成员同步根 `tsconfig.json` references。
- 状态与行为保持分离：持久状态进入事件日志，tools、prompts 与上下文构建来自可加载代码或配置。

## Working Rules

- TypeScript 使用 4 空格缩进并遵循现有命名、文件结构和导出入口。
- 优先显式类型，避免 `any`；第三方边界确需使用时限制在最小局部。
- 外部协议和持久化边界使用结构化校验；错误必须被记录、转换或返回，不得吞掉，也不得泄露 secret、token 或完整环境变量。
- 优先使用现有依赖和抽象。新增 npm 依赖、改变公共协议或运行方式时，若当前用户请求尚未明确授权，先说明用途、替代方案与影响并取得确认。
- 常规仓库编辑和本地只读/验证命令无需额外确认。删除、覆盖难恢复数据、访问凭据、安装依赖、产生外部网络或服务状态变更时必须先确认。
- 不自动启动长期服务，不自动创建 commit；用户明确要求时例外。提交信息使用 Angular Commit Message。

## Verification Commands

统一入口：

```bash
./init.sh
```

该脚本按顺序执行：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

仓库当前明确不设置 `test` 命令或测试计划，测试覆盖率不是完成门槛。行为变更仍需做与风险相称的手动验收，并在状态文件或最终说明中记录操作和观察结果；不得把“未报错”写成未经执行的验证证据。

## Definition of Done

只有同时满足以下条件才能宣称工作完成：

- 请求的行为和明确验收条件已经实现，没有遗留未说明的占位代码或临时方案。
- 改动符合依赖方向、公共协议与状态/行为分离等不变量。
- `./init.sh` 已通过；无法运行或存在基线失败时，已写明命令、失败原因、替代检查和残余风险。
- 需要运行时观察的改动已完成手动验收并记录证据。
- 对当前 lane 的 `state.json` 与 `.harness/<slug>/progress.md` 已同步；根级 `progress.md` 与 `feature_list.json` 仅在 main 合并时更新。README 只在愿景、里程碑或领域设计发生变化时更新。
- 工作树保持可理解且 `restartable`，未混入无关改动，也未擅自提交。

## End of Session

当本次工作修改了代码、文档或重要决策时，结束前：

1. 更新 `.harness/<slug>/progress.md` 的状态、验证证据、风险与下一步。
2. 更新 `.harness/<slug>/state.json` 的 `status`、`verification`、`lastUpdated`。
3. 工作未完成或受阻时填写该 lane `progress.md` 的 `Handoff Notes`。
4. 运行 `git status --short`，确认没有无关文件，并说明验证结果和残余风险。
5. **不在分支内**改动 `feature_list.json` 或根级 `progress.md`。
