# CaiCaiClaw Agent Harness

本文件只保存 agent 每次工作都必须遵守的启动路径、工程不变量和完成门槛。产品愿景、里程碑与领域设计以 `README.md` 为准；不要把路线图复制到这里。

## Startup Workflow

开始修改前：

1. 运行 `pwd` 与 `git status --short --branch`，确认仓库位置和用户已有改动。
2. 完整阅读本文件；按任务需要读取 `README.md` 的相关里程碑和相关源码。
3. 读取 `feature_list.json` 与 `progress.md`。仅当 `session-handoff.md` 标记了未完成交接时再读取其细节。
4. 在依赖已安装且任务涉及仓库文件时运行 `./init.sh`，记录基线。若基线已有与本任务无关的失败，记录后继续限定范围，不擅自修复无关问题。
5. 先确认目标、成功标准、影响模块和验证方式，再编辑文件。

## State And Scope

- **One feature at a time**：`feature_list.json` 最多有一个 `in-progress` 项；它是当前执行状态的唯一来源，README 仍是长期规划来源。
- **Stay in scope**：只修改当前请求与活动项需要的文件，不顺手重构或格式化无关内容。
- 小型修复、一次性文档修改和只读分析无需制造 feature 记录；跨会话或影响多个模块的工作才进入 `feature_list.json`。
- 不覆盖、回滚或删除用户已有改动。遇到重叠改动时先理解并在其基础上工作。
- 当前需求与 README 冲突时先指出偏差；不要静默改变产品方向。

## Architecture Invariants

- 使用 `pnpm`、TypeScript、ESM 与 Bundler module resolution；不引入 CommonJS。
- 本地 TypeScript/TSX 相对导入不带扩展名；CSS 等资源导入保留扩展名。
- 根目录只做 workspace 编排，不放业务代码。依赖方向必须保持单向：

```text
utils        <- 无工作区依赖
protocol     <- utils
agent-core   <- utils
client-core  <- protocol
server       <- agent-core, protocol, utils
web          <- client-core, protocol, utils
```

- `agent-core` 不依赖 `protocol`；传输层不承载核心业务决策。
- 对外协议变更必须同步类型、Zod schema、解析与序列化；新增 workspace 成员同步根 `tsconfig.json` references。
- 状态与行为保持分离：持久状态进入事件日志，tools、prompts 与上下文构建来自可加载代码或配置。

## Working Rules

- 默认使用中文交流，必要时保留英文技术术语。
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
- 对活动 feature 的状态、evidence 和 `progress.md` 已同步；README 只在愿景、里程碑或领域设计发生变化时更新。
- 工作树保持可理解且 `restartable`，未混入无关改动，也未擅自提交。

## End of Session

当本次工作修改了代码、文档或重要决策时，结束前：

1. 更新 `progress.md` 的当前状态、验证证据、风险和下一步。
2. 若活动 feature 的状态变化，同步 `feature_list.json`；只有满足 Definition of Done 才标记 `done`。
3. 仅在工作未完成、存在 blocker 或需要较多上下文才能续接时填写 `session-handoff.md`；正常完成后保持其“无活动交接”状态。
4. 运行 `git status --short`，确认没有无关文件，并向用户说明验证结果和残余风险。
