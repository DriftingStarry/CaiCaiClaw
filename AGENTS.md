# CaiCaiClaw Agent Harness

本文件只保存 agent 每次工作都必须遵守的启动路径、工程不变量和完成门槛。产品愿景、里程碑与领域设计以 `README.md` 为准；不要把路线图复制到这里。

## Startup Workflow

开始修改前：

1. 运行 `pwd` 与 `git status --short --branch`，确认仓库位置和用户已有改动。
2. 完整阅读本文件；按任务需要读取 `README.md` 的相关里程碑和相关源码。
3. 读取 `feature_list.json` 查看 feature 状态，读取 `progress.md` 恢复上次会话的上下文、残留风险与下一步。
4. 运行 `git log --oneline -5` 了解最近改动。
5. 在依赖已安装且任务涉及仓库文件时运行 `./init.sh`，记录基线。若基线已有与本任务无关的失败，记录后继续限定范围，不擅自修复无关问题。
6. 先确认目标、成功标准、影响模块和验证方式，再编辑文件。

基线验证失败时，先修复基线，再叠加新范围。

## Working Rules

- **One feature at a time**：从 `feature_list.json` 中恰好选定一个未完成 feature，把它的 `status` 置为 `in-progress`，完成后再选下一个。不要同时推进多个 feature。
- **Stay in scope**：只修改当前 feature 需要的文件，不夹带无关改动。需要越界时先在 `progress.md` 记录理由。
- **Verification required**：没有真正运行验证命令就不要宣称完成。
- **Update artifacts**：结束会话前同步 `progress.md` 与 `feature_list.json`。
- **Leave clean state**：下次会话必须能立刻运行 `./init.sh`。
- 小型修复、一次性文档修改和只读分析无需制造 feature 记录；跨会话或影响多个模块的工作才进入 `feature_list.json`。
- 不覆盖、回滚或删除用户已有改动。遇到重叠改动时先理解并在其基础上工作。
- 当前需求与 README 冲突时先指出偏差；不要静默改变产品方向。
- TypeScript 使用 4 空格缩进并遵循现有命名、文件结构和导出入口。
- 优先显式类型，避免 `any`；第三方边界确需使用时限制在最小局部。
- 外部协议和持久化边界使用结构化校验；错误必须被记录、转换或返回，不得吞掉，也不得泄露 secret、token 或完整环境变量。
- 优先使用现有依赖和抽象。新增 npm 依赖、改变公共协议或运行方式时，若当前用户请求尚未明确授权，先说明用途、替代方案与影响并取得确认。
- 常规仓库编辑和本地只读/验证命令无需额外确认。删除、覆盖难恢复数据、访问凭据、安装依赖、产生外部网络或服务状态变更时必须先确认。
- 不自动启动长期服务；用户明确要求时例外。
- 在开发大目标时主动按类型拆分细粒度的 git 提交，提交信息使用 Angular Commit Message。

## Required Artifacts

- `feature_list.json` — feature 状态与证据的真相源
- `progress.md` — 会话连续性日志：当前状态、残留风险、决策与下一步
- `init.sh` — 统一启动与验证入口
- `session-handoff.md` — 可选，跨会话的大块工作使用

`feature_list.json` 字段：`id`、`name`、`description`、`status` 必填；`dependencies`、`doneCriteria`、`evidence` 可选。`status` 取值为 `not-started` \| `in-progress` \| `blocked` \| `done`。

## Architecture Invariants

- 使用 `pnpm`、TypeScript、ESM 与 Bundler module resolution；不引入 CommonJS。
- 本地 TypeScript/TSX 相对导入不带扩展名；CSS 等资源导入保留扩展名。
- 根目录只做 workspace 编排，不放业务代码。依赖方向必须保持单向：

```text
packages/utils        <- 无工作区依赖
packages/protocol     <- utils
packages/agent-core   <- utils
packages/client-core  <- protocol, utils
apps/server           <- agent-core, protocol, utils
apps/admin            <- client-core, protocol, utils
apps/tui              <- client-core, protocol, utils
```

该表以各包 `package.json` 中的 `workspace:*` 条目为准。新增或调整 workspace 依赖时同步本表。

- `agent-core` 不依赖 `protocol`；传输层不承载核心业务决策。
- 对外协议变更必须同步类型、Zod schema、解析与序列化；新增 workspace 成员同步根 `tsconfig.json` references。
- 状态与行为保持分离：持久状态进入事件日志，tools、prompts 与上下文构建来自可加载代码或配置。

## Verification Commands

统一入口：

```bash
./init.sh
```

该脚本按顺序执行：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

`init.sh` 只做静态检查：它不安装依赖，也不启动服务。

仓库当前明确不设置 `test` 命令或测试计划，测试覆盖率不是完成门槛。行为变更仍需做与风险相称的手动验收，并在 `progress.md` 或最终说明中记录操作和观察结果；不得把「未报错」写成未经执行的验证证据。

## Definition of Done

只有同时满足以下条件才能宣称工作完成：

- 请求的行为和该 feature 的 `doneCriteria` 已经实现，没有遗留未说明的占位代码或临时方案。
- 改动符合依赖方向、公共协议与状态/行为分离等不变量。
- `./init.sh` 已通过；无法运行或存在基线失败时，已写明命令、失败原因、替代检查和残余风险。
- 需要运行时观察的改动已完成手动验收并记录证据。
- `feature_list.json` 的 `status` 与 `evidence`、`progress.md` 的状态与下一步均已同步。README 只在愿景、里程碑或领域设计发生变化时更新。
- 工作树保持可理解且 restartable，未混入无关改动。

## End of Session

当本次工作修改了代码、文档或重要决策时，结束前：

1. 更新 `progress.md` 的当前状态、验证证据、风险与下一步。
2. 更新 `feature_list.json` 中该 feature 的 `status` 与 `evidence`。
3. 工作未完成或受阻时填写 `session-handoff.md`。
4. 运行 `git status --short`，确认没有无关文件，并说明验证结果和残余风险。
5. 在工作处于安全状态时提交，提交信息可描述改动范围。

## Escalation

- **架构决策**：先查 `README.md` 的领域设计；仍不明确时问用户。
- **需求不清**：先查 `README.md` 与 `feature_list.json` 的 `doneCriteria`；仍不明确时问用户。
- **反复失败**：同一方法失败两次后停止微调，定位根因并换方案；更新 `progress.md` 并标记待人工复核。
- **范围歧义**：重读 `feature_list.json` 中该 feature 的 `description` 与 `doneCriteria`。
