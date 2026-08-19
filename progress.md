# Session Progress Log

## Current State

**Last Updated:** 2026-08-19
**Active Feature:** feat-011（M3-3 门口裁决 intake 与双车道）进行中。已完成三个可独立回滚代码单元：`dc079f7` intake 策略/门口裁决、`0c93b91` per-conversation 双 lane 与 fast 限制、`36ea1b2` server 模型/策略配置接入。feat-010 已完成并落为 `33c4fe5`、`c57fa3d`、`70f6101`；下一步做真实 WS 回执、深 lane 长任务期间 fast 响应、维护边界与完整 doneCriteria 验收。

### feat-011 当前实现证据

- `dc079f7`：runtime 执行可加载 intake policy；按 channel/conversation 分区通用槽与保留槽，self echo/容量拒绝落 `input.dropped`，accepted/merged 使用稳定 batchId；协议 ack 与 output mapper 暴露 disposition/reason/batchId。
- `0c93b91`：fast/deep 使用独立队列和 agent，按 conversation 分桶串行；fast 只绑定 `defer_to_deep`，快上下文仅安全前言、Role.md、态势、conversation projection 与当前批次。fake-model probe 通过（两 lane 各调用一次，fast 未注入完整系统记忆，target 正确）。
- `36ea1b2`：server 只透传 `CAICAI_CHANNEL_POLICY_PATH`、`CAICAI_FAST_MODEL`、`CAICAI_BACKGROUND_MODEL`；配置 fallback probe 通过。三个提交均经 `./init.sh`、暂存区 diff check。
- `95d9711`：server 保留 adapter 原始 `author.isSelf`，self_echo admission 可生效；`input.dropped` 回放按 conversation 累计 projection `droppedCount`。
- `7457530`：fast/background 未配置时打印明确 fallback 日志。
- `1f5886a`：fast agent 通过 turn context 回调把 defer 事件重新落 accepted 并投 deep queue。fake-model defer probe 通过：fast calls=2（tool call + follow-up）、deep calls=1、accepted=2、fast/deep turn 均出现。
- `eaa01b5`：run loop 改为 deep/fast 两个独立 lane worker，`executionState` 按 lane 隔离，慢 deep 不再阻塞 fast queue drain。slow deep + 200 个独立 fast conversation 压测通过：deep 约 327ms 完成前，200 个 fast turn 全部完成。注意同一 conversation 的 200 条会按设计合并为一个批次，不以 200 个 done 计数。
- `70c50ae`：真实 WebSocketServer + fake model 验收通过 accepted/merged/dropped ack、`input_dropped`、fast 流式输出；同时修复 merge 优先级（窗口内可合并事件先合并，不因槽位已满误丢），并支持 createServer 注入 fast/background fake model，避免验收构造 OpenRouter API key。
- `7064df0`：修复 fast 并发提交期间 compact 的 checkpoint cutoff：等待 history writes、刷新最新 projection/preserved suffix 后追加 checkpoint；允许 history 回放 fast active checkpoint，仍由 runtime deep-idle 边界保护。有效 checkpoint maintenance probe 通过：fast active 时 compact `2ms` 完成，deep active 时 daydreaming 等待 `306ms`，history sequence `1..23` 连续。
- `6c49c64`：将上述 checkpoint 修复提升为 `RawHistoryStore.withExclusive()` 排它 append transaction；snapshot、background model await、checkpoint append 全部持有 barrier，fast append 在 barrier 后执行。强制 probe 输出 `elapsed:205ms,sequences:17,replaySequence:17,checkpoint:2`，确认 fast 在模型 await 期间被排队、序列连续且重启回放无 corruption。history 明确记录 M3 允许 fast active checkpoint，deep-idle 由 runtime 强制。
- `c26e880`：修复 barrier 建立竞态：同步捕获旧 `writeTail` 后立即设置 exclusive barrier，再等待 captured tail；timing probe 在 exclusive await 期间并发 append，释放后两条记录均完成，重放 sequence=2。
- feat-011 doneCriteria 已全部有证据：真实 WS intake/streaming、200 fast during slow deep、self_echo/dropCount、defer upgrade、fallback logs、maintenance deep-idle 均已验证。

### feat-011 提交计划

1. **intake 契约与策略**：新增 runtime lane/intake 类型、可加载 JSON 策略、优先级裁决、分区槽位和 accepted/merged/dropped 回执；同步协议 ack 与 dropped 事件。预期文件：`packages/agent-core/src/runtime/intake.ts`、`packages/agent-core/src/runtime/types.ts`、`packages/protocol/src/index.ts`。标题：`feat(agent-core): 增加 intake 策略与门口裁决`。验证：`./init.sh` 与临时 runtime admission probe。
2. **双车道执行**：runtime 按 lane 独立排队与串行执行，接入 fast model、fast 安全上下文和仅允许 `defer_to_deep` 的工具集合，deep 保持现有 ReAct。预期文件：`packages/agent-core/src/runtime/agentRuntime.ts`、`packages/agent-core/src/runtime/agentStream.ts`、`packages/agent-core/src/agent.ts`。标题：`feat(agent-core): 实现 fast 与 deep 独立车道`。验证：`./init.sh` 与 fake-model 并发/上下文 probe。
3. **server 配置与回执**：接入 `CAICAI_CHANNEL_POLICY_PATH`、`CAICAI_FAST_MODEL`、`CAICAI_BACKGROUND_MODEL`，server 只透传 runtime admission 结果，WS ack 同步 disposition/reason/batchId。预期文件：`apps/server/src/config.ts`、`apps/server/src/server.ts`、`.env.example`。标题：`feat(server): 接入双车道配置与 intake 回执`。验证：`./init.sh`、admin build 与真实 WS harness。

拆分依据：策略/契约不依赖 server；双 lane 执行依赖第一单元但可单独 revert；server 配置和协议字段与 runtime 回执紧耦合，合并为第三单元。

### feat-010 提交计划

1. **类型层**：`RuntimeOutputEvent` 各分支增加 `lane`，面向渠道的分支增加可选 `target { channel, conversationId, replyTo? }`；runtime 从 `TurnContext` 派生并填充。预期文件：`packages/agent-core/src/runtime/types.ts`、`packages/agent-core/src/runtime/agentRuntime.ts`、`packages/agent-core/src/runtime/agentStream.ts`。标题：`feat(agent-core): 出站事件携带车道与投递目标`。验证：`./init.sh`。
2. **协议层**：`ServerMessage` 同步 `lane` / `target`，新增连接角色声明（`role=observer|adapter` 与 adapter 的 `channel`），`WS_PROTOCOL_VERSION` 4→5。预期文件：`packages/protocol/src/index.ts`。标题：`feat(protocol): 增加连接角色与出站目标字段`。验证：`./init.sh`。
3. **路由层**：server 的 `broadcast` 拆为按角色投递 —— observer 收全量，adapter 只收 `target.channel` 等于自身 channel 的输出；无 target 的输出不投给任何 adapter。预期文件：`apps/server/src/server.ts`、`apps/server/src/runtimeOutputMapper.ts`。标题：`feat(server): 按连接角色定向投递出站事件`。验证：`./init.sh` 与假 adapter/observer 双连接实测。

拆分依据：类型层与协议层各自可独立通过 `./init.sh` 且可单独 revert；路由层是行为改动，单独一提交便于回滚。若协议层与路由层出现「schema 已改而 server 未同步导致运行契约失效」的紧耦合，则按 AGENTS.md 合并为一个提交并在此记录原因。

### feat-010 实现与验收证据

- 类型层：`RuntimeOutputEvent` 所有分支增加 `lane`；`TurnContext` 增加来源 `target`，由首个 `ChannelEvent` 的 `channel` / `conversationId` / `replyTo` 派生；`assistant_delta` 流式增量携带 target，未新增 runtime 实例状态。`toolNode` context 校验同步要求合法 target。
- 协议层：`WS_PROTOCOL_VERSION` 由 4 提升到 5；runtime 对应的 `ServerMessage` 分支增加 `lane`，assistant 增量增加可选 target；新增 `{ type: "role", role: "observer" | "adapter", channel? }`，adapter 缺 channel 与非法 role 均由 schema 拒绝。client-core、TUI、admin control 连接自动声明 observer。
- 路由层：server 连接保存已验证 role；observer 收 runtime 与控制广播全量，adapter 只收带 target 且 `target.channel` 匹配自身 channel 的 runtime 输出；无 target 的输出不投 adapter。adapter 入站事件的 `event.channel` 必须与声明 channel 一致，防止伪造来源导致错投。保留 `verifyClient` token 鉴权逻辑不变，local 行为不变。
- 静态验证实跑通过：`./init.sh` 输出 `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过并输出 `=== Verification complete ===`；`pnpm --filter @caicaiclaw/admin build` 输出 `Compiled successfully`、`Finished TypeScript`、静态页 `10/10`。
- 网络 harness：2026-08-19 在本机真实 WebSocketServer + fake SimpleChatModel 上通过。observer 收到 `hello/input_accepted/agent_turn_start/assistant_message_delta/agent_turn_done` 全量；匹配 `bilibili-live` adapter 收到 ack 与 assistant 流式增量；不匹配 `qq` adapter 仅收到 hello；伪造 `qq` 入站被拒并返回 channel 错误；未声明 role 先 ping 被拒。临时脚本与 history 目录已清理。
- 三个提交单元已分别提交并验证：`33c4fe5`（agent-core 类型/target）、`c57fa3d`（protocol v5/role/schema）、`70f6101`（server 路由及 adapter 入站 channel 边界）。每个提交均审查暂存区并执行 `git diff --cached --check`；最终 `./init.sh` 通过。

### feat-009 提交计划

1. **类型层**：新增 `TurnContext` / `Lane`，扩展 `ToolStartEvent` / `ToolResultEvent`，让 `toolNode` 从 `RunnableConfig.configurable` 读取并向工具回调传递 context。预期文件：`packages/agent-core/src/runtime/types.ts`、`packages/agent-core/src/agent.ts`、必要的导出入口。标题：`feat(agent-core): 透传 turn context 到工具节点`。验证：`./init.sh`。
2. **行为层**：将 runtime 的 `activeTurnId` 改为按 lane 保存的 active turn context，接通 `handleEvents` → `runAgentStream` → LangGraph，并调整工具审计、长结果引用及 deep lane 维护空闲边界。预期文件：`packages/agent-core/src/runtime/agentStream.ts`、`packages/agent-core/src/runtime/agentRuntime.ts`。标题：`feat(agent-core): 按车道维护活动 turn 上下文`。验证：`./init.sh` 与单车道运行时回归验收。

两单元存在类型耦合，但先按计划拆分；若类型层提交无法独立通过 `./init.sh`，将在此处记录原因并合并为一个可独立回滚提交。

两单元最终按计划分别提交，未合并。类型耦合确实存在（行为层引用类型层新增的 `Lane` / `TurnContext`），但方向是单向的：类型层自身可独立通过 `./init.sh`，因此仍满足可独立回滚。

codex 运行沙箱（`--sandbox workspace-write`）无法创建 `.git/index.lock`（`Read-only file system`），故它无法自行划定提交边界；**这是该沙箱模式的限制，不是仓库或本机 `.git` 的属性**。提交拆分、暂存区审查与回归验收均由 Claude 在本机补齐。

### feat-009 实现与验收证据

- 类型层：新增 `Lane` / `TurnContext`，`ToolStartEvent` / `ToolResultEvent` 增加 `turnId` / `lane`，`toolNode` 从 `RunnableConfig.configurable.turnContext` 结构化读取，缺失或非法时抛错。`./init.sh` 实跑通过：`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 均通过。
- 行为层：`handleEvents` → `runAgentStream` → `toolNode` 透传 context；runtime 使用 `Map<Lane, TurnContext>`，工具护栏和长结果引用改用事件自身 turnId，维护边界按 deep lane 判断。最终 `./init.sh` 实跑通过，输出 `=== Verification complete ===`。
- 提交单元 1 `2818ed5` feat(agent-core)：透传 turn context 到工具节点。提交前以 `git stash push --keep-index --include-untracked` 隔离出仅含该单元的工作树，单独跑通 `./init.sh`，确认其不依赖行为层。
- 提交单元 2 `ae1a2e6` feat(agent-core)：按车道维护活动 turn 上下文。`./init.sh` 通过，并在此提交后跑完整回归验收。
- 独立回归验收（Claude 本机实跑，真实 `SimpleChatModel` 子类 + 真实 LangGraph 图 + 真实 tool，非 mock 运行时，脚本已删除）。实际输出：事件序列为 `input.accepted` / `turn.started` / `tool.started` / `tool.completed` / `turn.output_committed`；`turnIdAttributionCorrect: true`；`toolResultFullyStored: true`（9000 字完整落在 `tool.completed`）；`projectionUsesReference: true` 且 `projectionIsBounded: true`（模型可见消息替换为 `history://turn/<turnId>/tool/call-1`）；`historyReadTotalLength: 9000` 且分页读出内容正确；缺 context 时报 `toolNode requires a valid turn context in RunnableConfig.configurable`；deep lane 活跃期间 compact 报 `cannot compact while a deep lane turn is active`；中断后 `interruptedTurnIds: ["t1"]` 且 `interruptedNotCommitted: true`；重启回放与 checkpoint 语义未回归。
- LangGraph 是否真的把 `RunnableConfig` 透传给 `GraphNode` 第二参数，由前置最小 probe 实测确认（`invoke` 与 `stream` 两条路径均读到 `configurable.turnContext`），不依赖文档假设。
- 设计判断：混合 `conversationId` 批次明确取首个输入的 conversation；当前 local server 只有 `local:default`，feat-011 按 conversation 分桶后不再出现混合批次。工具节点读不到 context 直接抛 `toolNode requires a valid turn context in RunnableConfig.configurable`，不回退实例字段。维护操作的业务空闲边界只看 deep lane；`running` 仅用于把操作交给主循环协调全局 history/queue 顺序，当前单车道行为与原实现一致。

2026-08-18 用户决定调整路线图顺序：M3 为「实时响应与外部渠道接入」，M4 为「Pi 式运行时自我修改（reload）」；README 内部交叉引用已同步。

2026-08-18 实现 feat-008 代码范围。共享 history subpath 只依赖 zod，硬切 HISTORY_VERSION=2；agent-core 的 input.accepted 改为嵌套 ChannelEvent，回放构建有界 per-conversation projection；protocol v4、server local 输入归一化、TUI/admin 输入和 admin 日志读取均已同步。HumanMessage 注入 channel/conversation/kind/author/正文，不注入 payload；requestId 保留在 input.accepted 顶层作为传输关联元数据，不放进 ChannelEvent。projection 上限取 30 条消息，与既有深度上下文窗口一致并保持快车道未来读取有界，droppedCount 暂由 feat-011 门口裁决填充。

feat-008 实际落为三个提交，而非计划中的五个。计划里的单元 2（agent-core 切共享契约并硬切 v2）、单元 4（admin logs.ts 改用共享解析）、单元 5（ChannelEvent 接入）经核对属于同一紧耦合意图，无法按文件切分：v2 的嵌套形状决定 `RuntimeInput`，`RuntimeInput` 决定 protocol 的 client input，而写入侧切 v2 却让 admin 继续锁 `version !== 1` 会让面板整片报「invalid event schema」——这正是 README 里「面板全红但 agent 正常」的误诊场景。按「会导致类型检查、构建或运行契约失效的紧耦合改动必须留在同一提交」合并为 b981145。单元 1 与单元 3 确认可独立 revert，分别落为 071311d 与 78fcbac；单元 3 的可分离性经实测确认（移除投影后 `./init.sh` 仍通过，且全仓无消费方）。

- `071311d` feat(utils)：下沉事件日志契约到 `./history` subpath。提交前以 `git stash --keep-index` 隔离出仅含该单元的工作树，单独跑通 `./init.sh`，确认它不依赖后续单元。
- `b981145` feat：入站事件结构化为 `ChannelEvent` 并硬切日志 v2（15 文件，含 protocol v3→v4）。`./init.sh` 与 admin build 均通过。
- `78fcbac` feat(agent-core)：按 conversation 的有界常驻投影（+49 行，纯加法）。

feat-008 验证证据（均为本机实跑，非沙箱推断）：三个提交各自通过 `./init.sh`；`pnpm --filter @caicaiclaw/admin build` 通过。runtime 隔离验收输出 `A_emptyInit: true`、`B_versions: [2]`、`B_noFlatTextOrSource: true`、`B_humanText: "[local/local:default chat tester] hello one"`、`C_committedTurns: 2`、`D_boundedRecent: 30`、`E_corrupt: "raw history line 7 is not valid JSON"`、`F_v1Rejected` 报 `expected 2 → at version`、`G_payloadInPrompt: false` 且 `G_payloadInLog: true`。投影验收：两 conversation 各自成桶（各 2 条，含输入与回复），单桶灌 80 条后稳定 30 条并保留最新 `danmaku 79`，另一桶不受影响。admin 验收：v2 事件按 turn 分组、行号 1..5 保留、长 tool result 截断且 `readToolResult` 报 `totalLength: 1200`，损坏行报 `line 6`、v1 行报 `line 1` 且都不影响其余渲染。真实 local WS 端到端（注入 FakeModel 起真实 `WebSocketServer` 于 127.0.0.1:8899）：`hello` 与客户端 `WS_PROTOCOL_VERSION` 均为 4，依次收到 `hello/ack/input_accepted/agent_turn_start/assistant_message_delta/agent_turn_done`，`input_accepted` 携带嵌套 `event`，缺字段的非法 `ChannelEvent` 被拒，落盘 `input.accepted/turn.started/turn.output_committed` 且 `version` 全为 2。所有临时脚本已删除。

codex（`gpt-5.6-luna`）完成了 feat-008 的代码实现，但其沙箱拒绝创建 `.git/index.lock`（`Read-only file system`），因此五个单元全部堆在同一个工作树、无提交边界；它如实标注了未伪造 hash，也如实标注真实 WS 闭环受 `listen EPERM` 阻断未执行。**这两条都是该沙箱的限制，不是仓库或本机的属性**——提交边界与真实 WS 验收均由 Claude 在本机补齐，WS 结论以实跑输出为准，不以 protocol probe 代替。

收尾同时补齐 `.env.example` 的五个 M3 变量（`CAICAI_FAST_MODEL`、`CAICAI_BACKGROUND_MODEL`、`CAICAI_APPROVAL_TTL_MS`、`CAICAI_CHANNEL_POLICY_PATH`、`CAICAI_DIGEST_EVERY_HEARTBEATS`）并加注约束；这些变量的读取逻辑由后续 feature 落地，本次只登记契约。README 的三模型表原先误写 `CAICAI_OPENROUTER_MODEL`，已改回实际存在的 `OPENROUTER_MODEL`（见 `apps/server/src/config.ts`）。

2026-08-18 更新 harness 的 Git 提交纪律：feature 不再等同一个 commit；中大型工作须先在本文件写提交计划，再按可独立 revert 的完整意图逐个暂存、审查、验证和提交。协议/类型与其紧耦合实现可以同提交以维持构建完整性；禁止按会话收尾或用 `git add .` 汇总提交。每个提交的 hash、意图和验证结果须进入 evidence。基线 `./init.sh` 已通过；本次仅修改 harness，不创建 feature 记录。

feat-006 的完整需求与验收标准保存在 `feature_list.json` 的 doneCriteria 中。实现交由 codex（model `gpt-5.6-luna`）执行。

**关键拓扑决策**：用户原计划「在 `apps/server` 基础上做管理端」与「完全控制 agent 进程启停」不能同时成立 —— `apps/server` 本身就是 agent 进程（进程内 `new AgentRuntime()` 并持有 WS server），同进程的管理端在停掉 agent 后自己也不复存在，就没有后台可以点「启动」。故定为 **新增 `apps/admin`（Next.js SSR + supervisor，常驻）+ `apps/server` 作为被 spawn 的子进程**，`apps/server` 职责与代码不变。这同时避免了新增 `apps/server <- client-core` 破坏 Architecture Invariants 的依赖表。

feat-004 已补齐 server compact / daydreaming 入口与 scheduled compact 调度并通过独立复核。feat-005 的鼠标消费器代码已完成，纯函数、真实 Ink 集成与真实终端三项交互验收（备用屏、真实鼠标滚轮、双端共享 runtime）均已通过。

feat-005 于 2026-08-17 由用户决策置为 `done`：Shift+Enter 在其 Windows Terminal + tmux 3.4 环境实测失败，已定位为终端不支持 kitty 键盘协议（Enter 与 Shift+Enter 发出相同字节，属环境能力缺失而非代码缺陷，三组实测详见 Blockers / Risks）。用户选择换用支持 kitty 协议的终端而不改代码。**留痕：换行功能在支持 kitty 协议的终端上的实际按键确认尚未执行过**，代码路径的正确性目前只由喂入 kitty 编码的探针验证，见 Evidence 表。

feat-006 的 apps/admin 已实现并于 2026-08-17 **完成人工验收、置为 `done`**，apps/web 已在最后的独立删除范围中移除。start / hello→running / compact / stop / restart / 崩溃语义由 Claude 在本机隔离端口实测通过（见 Evidence 表）；10MB 日志下 `/logs` 性能、JSONL 字节只读与崩溃 stderr 的 UI 呈现由用户人工验收通过。收尾时补全了 `.env.example` 的五个缺失变量并加注约束。
实现由 codex（`gpt-5.6-luna`）执行，其沙箱内 `git commit` 与 127.0.0.1 `listen` 均被拒绝，故它把改动留在工作树并如实标注了未执行的验收项。**这两条都是该沙箱的限制，不是仓库或本机的属性** —— 本机 `.git` 可写，提交由 Claude 在核对硬约束后完成。

2026-08-17 本次修复 feat-006 三件事：

1. **auth 死路径删除（Claude 手动执行）**。`readToken()` 原先支持 `Authorization: Bearer` 与 `x-caicai-admin-token`，但 `middleware.ts` 的 matcher 覆盖 `/api/*` 且只校验 cookie，纯 header 请求在进入路由前即被 401 —— 那两条分支对所有走 `requireAuth` 的路由都不可达。末尾手工解析 `cookie` 头的分支同样不可达（`requireAuth` 传入的永远是 `NextRequest`，会在上一行返回）。`readToken` 整个删除，`isAuthorized` 收窄为只接 `NextRequest` 且只读 cookie，新增 `verifyToken(token)` 供 `/api/auth` 直接校验（原先它为复用 `isAuthorized` 而伪造一个带 `authorization` 头的 `Request`，是绕路）。**结果是认证来源唯一化**：middleware 与路由层看同一个 cookie，不会再出现 middleware 拒绝而路由放行的分歧路径。
2. **restart 误报修复**。根因是两条互相竞争的重启路径：`restart()` 置 `restartAfterExit = true` → `await requestStop()` → 自己再 `start()`，而 `handleExit()` 先 resolve stopWaiters、紧接着**同步**判断 `restartAfterExit` 也调了一次 `start()`。`resolvePromise()` 只把 await 续体排进微任务队列，`handleExit` 的同步尾部先跑完 → 状态变 `starting` → 续体那次 `start()` 撞上守卫抛 `cannot start agent while status is starting`。进程实际是被 `handleExit` 那次启起来的，所以「报错但重启成功」。修法：删除 `restartAfterExit` 字段与 `handleExit` 的自动重启分支，只留 `restart()` 一条路径。守卫能过是因为 `handleExit` 在 resolve waiters **之前**已 `this.child = undefined` 并把 status 置为 `stopped`；「等旧进程真正退出再 spawn」仍由 `stopWaiters` 保证，未被简化。
3. **前端 agent 状态跨路由共享**。新增 `src/stores/useAgentSupervisorStore.ts`（zustand，无新增依赖）持有 snapshot、`activeAction`、`lastOperation`，action 的 promise 由 store 持有故不随组件卸载丢失；轮询由 `useAgentSupervisorPolling()` 以 `useEffect` 引用计数驱动，两页共用单一循环、全部卸载即停。`agent/page.tsx` 与 `chat/page.tsx` 改为消费该 store，Alert 类型改用结构化 `outcome`（原先靠 `message.includes("失败")` 猜）。**未引入 localStorage** —— 快照真相源是服务端 supervisor，客户端缓存旧快照只会造成显示与实际不一致。

本次无产品、信息架构或协议语义变化。

2026-08-17 修复 feat-006 compact 缺陷：Next 16.2.10 webpack 曾将 `ws` 的 `Sender` / `buffer-util` 打进 server bundle，破坏 `buffer-util` 的延迟导出改写，最终在 compact 发送时抛出 `b.mask is not a function` 并被错误映射为 400。`serverExternalPackages: ["ws"]` 已生效；action API 现在只把明确的 supervisor 状态冲突映射为 409，其余内部异常为 500，输入校验仍为 400。

codex 曾额外加上 `experimental.esmExternals: false`（理由是让产物呈现 CommonJS 外部引用），**该开关经实测确认不必要，已移除**：去掉后 ws 仍是外部引用，只是形式从 `require("ws")` 变为 `import("ws")`，`Sender` / `buffer-util` / `WS_NO_BUFFER_UTIL` 内联均为 0，且真实运行时 compact 不再抛 mask 错误。真正起作用的只有 `serverExternalPackages`。保留该实验开关会引入 Next 的“不推荐修改”警告和一处无收益的配置面。

## Status

### What's Done

- [x] **feat-001 M1 TUI 共享运行时客户端** — `packages/client-core` 提供跨运行时 WebSocket transport、URL 构建和 timeline selector；`apps/tui` 提供 Ink 7 三栏界面、共享状态归约、输入/设置/滚动/鼠标清理。根 workspace 已同步 TUI package、TypeScript reference、启动脚本、依赖方向和环境变量。已合并（PR #37, merge 997dfce）。
- [x] **feat-002 Web 迁移到 client-core 传输层** — 删除 `apps/web` 自带 WebSocket adapter，store 改用 `@caicaiclaw/client-core` transport 并注入浏览器原生 WebSocket 工厂；保留 `NEXT_PUBLIC_CAICAI_WS_URL` 配置与 `clientIdentity` 持久化；更新 `apps/web/README.md`。已合并（commit be131bb, merge e12992f）。
- [x] **feat-003 M2 上下文精进** — Markdown memory snapshot（独立预算 / 明确错误）、固定顺序 `buildContext`、append-only `context.compacted` checkpoint 与严格回放、quiescent 串行 compaction、二次 compaction 合并、受限 `history_read` 工具供模型按稳定引用分页读取原始长工具结果。`apps/server` 仅传入真实 `openrouterModel` 作为 checkpoint 审计字段。已合并（merge 4704266）。
- [x] **feat-004 Server compact 与 memory 调度入口** — server 配置 `memoryDir` 与 `CAICAI_COMPACT_EVERY_TURNS`，WS compact / daydreaming 单连接入口，按 `done` 事件计数的 scheduled compact，AgentRuntime 共享维护队列与 Role.md 原子反思写入。已完成，证据见下表与 `feature_list.json`。
- [x] **feat-005 TUI 鼠标序列消费与真实终端验收** — 新增 `apps/tui/src/hooks/mouseSequence.ts` 独立状态机消费器，`App.tsx` 只做分发，删除 `parseMouseWheel`。X10 降级与 SGR 跨 chunk 分片两条泄漏路径已封死；组装被证伪或超长时回吐缓冲，不吞后续按键。commit f89ac99。真实终端验收三项通过（备用屏、真实鼠标滚轮、双端共享 runtime）；Shift+Enter 一项在用户环境失败，根因为终端不支持 kitty 协议，用户决策换终端、代码不动，据此置为 `done`。
- [x] **Harness 迁移** — 从多 worktree lane 变式回到 harness-creator 原本的单 lane 模式：删除 `harness/lanes.sh`、`harness/wt.sh`、`harness/lib/workspace.cjs` 与 `.harness/<slug>/` 分片，状态合并进根级 `feature_list.json` 与本文件。
- [x] **feat-006 M2 Web 后台管理（apps/admin）** — 新增 `apps/admin`（Next.js SSR + supervisor，常驻）spawn `apps/server` 作为子进程，提供 chat / memory / logs / agent 四个路由与进程生命周期控制；`apps/web` 已迁入并删除。含 ws 外置（compact mask 修复）、错误映射（400/409/500）、auth 死路径删除、restart 单一路径、跨路由 supervisor store。2026-08-17 人工验收通过后置为 `done`，收尾补全 `.env.example`。

  **维护 admin 时必须守住的约束**（改这块代码前先读）：
  - 依赖方向只有 `apps/admin <- client-core, protocol, utils`；**不得**新增 `apps/server <- client-core`。调整时同步 `AGENTS.md` 依赖表与根 `tsconfig.json` references。
  - `running` 判定用 control 连接收到 `hello`，不是「进程还在」—— 否则进程起来但 WS 未就绪也会被误报为 running。
  - 重启必须等前一子进程真正 `exit` 后再 spawn，否则会撞端口 8787 并共写 `history.jsonl`（对应 Blockers / Risks 里「运行环境未隔离」那条）。当前由 `stopWaiters` 保证，且**只允许存在一条重启路径** —— 曾因 `restart()` 与 `handleExit()` 各调一次 `start()` 而误报状态冲突。
  - `CAICAI_ADMIN_TOKEN` 缺失时 admin 拒绝启动，不留无认证降级路径。这是个高权限面板：可写 agent 人格、可启停进程，而 agent 自身持有 `exec` 工具。凭据只从 httpOnly cookie 读取，middleware 与路由层必须看同一来源。
  - memory 写入复刻 runtime `daydreaming()` 的同目录临时文件 + `rename` 原子替换；乐观锁冲突即拒绝保存，不做自动合并。路径需先解析符号链接再校验是否落在 `memoryDir` 内，且只允许 `.md`。
  - `history.jsonl` 对 admin 严格只读，admin 侧不得存在写/截断/补写路径。
  - `ws` 必须留在 `serverExternalPackages` 里。一旦被 webpack 内联，`buffer-util` 的事后 `mask` 改写会丢失并在 compact 时抛 `b.mask is not a function`；改 `next.config.ts` 后要检查产物而非只看 build 成功。

### What's Next

1. 按依赖顺序实现 M3：feat-008 ✅ → **009（下一个）** → 010 → 011 → 012 → 013 →（014 / 015 可并行，均依赖 013）。一次只推进一个。feat-009 已有前置实测结论可直接采信，不必重跑：LangGraph 的 `GraphNode` 第二参数确实透传 `RunnableConfig`，`configurable` 在 `invoke` 与 `stream`（`streamMode: "messages"`）下都读得到——探针输出 `{"probe":"invoke","seen":{"turnId":"turn-1","lane":"fast","conversationId":"local:default"}}` 及同形状的 `stream` 结果。因此 `activeTurnId` → `activeTurns: Map<lane, TurnContext>` 的改造路径成立。
2. 用户换到支持 kitty 协议的终端后，顺手确认一次 Shift+Enter 真能插入换行 —— 这是 feat-005 唯一未经真实按键确认的行为，代码路径已由探针验证但未在真机按过。若那时发现不工作，先读 Blockers / Risks 里的实测结论，特别是「不要打开 tmux `extended-keys`」这条反向警告。
3. 改鼠标相关代码前先读 Blockers / Risks 里消费器的现有行为约定。
4. 若要让 admin 面板可被同网段访问，先解决 Blockers / Risks 里「agent WS 无认证」那条 —— 当前安全边界只有「仅监听 127.0.0.1」。

## M3 提交计划（2026-08-18 立，实施中若调整须在此记录原因）

设计已写入 `README.md` 的 M3 章节，切片写入 `feature_list.json` 的 feat-008 ~ feat-015。实现交由 codex（model `gpt-5.6-luna`）执行，Claude 负责设计、审查、验收与提交。

**docs 提交（本次先落）**

| 提交 | 意图 | 影响文件 | 验证 |
| --- | --- | --- | --- |
| `docs: 确定 M3 实时响应与外部渠道接入设计` | 只写产品方向与切片，不含实现 | `README.md`、`AGENTS.md`、`feature_list.json`、`progress.md` | `./init.sh`（不涉及 TS 改动，仅确认基线未破）、`git diff --check` |

`AGENTS.md` 的依赖表改动是设计的一部分：`packages/utils` 从「零依赖」变为「无工作区依赖 + 仅 zod」，因为 history event schema 要下沉到 `./history` subpath 供 `apps/admin` 共用（admin 依赖方向不含 agent-core）。用户已授权此依赖边。

**feat-008（M3-0）提交单元**

| 序 | 意图 | 预期影响 | 验证 |
| --- | --- | --- | --- |
| 1 | `packages/utils` 新增 `./history` subpath 与事件契约（`HISTORY_VERSION=2`、`channelEventSchema`、`rawHistoryEventSchema`、`parseHistoryLine`） | `packages/utils/{package.json,src/history/*}`、根 `tsconfig.json` | typecheck + 一次性 probe 确认 subpath 在 tsc / eslint / Next 三处均可解析 |
| 2 | `RawHistoryStore` 改用共享 schema 并硬切 v2 校验 | `packages/agent-core/src/runtime/{historyEvents,rawHistoryStore,history}.ts` | 非 v2 非空行报行号并阻止启动；空文件正常初始化 |
| 3 | per-conversation 常驻投影（有界环形缓冲） | `packages/agent-core/src/runtime/{history,rawHistoryStore}.ts` | 回放构建投影；内存有界 |
| 4 | `apps/admin` 日志校验改调共享 `parseHistoryLine` | `apps/admin/src/lib/logs.ts` | `/logs` 渲染 v2；admin build |
| 5 | runtime / server 接入 `ChannelEvent`（紧耦合类型契约，**必须整体一个提交**） | `agent-core/runtime/{types,agentRuntime,context}.ts`、`apps/server/*`、`packages/protocol`、`packages/client-core`、`apps/tui`、`apps/admin` | local WS 单渠道端到端；`./init.sh` |

单元 1~4 各自可独立 `git revert`；单元 5 拆开会让 typecheck 断在中间，故不再切分。

**已在设计阶段固定的决策（实施时不要再改）**

- adapter 与 MCP server 同进程两张脸；MCP 不作为渠道抽象边界。
- 回复来源渠道走输出路由，不走 tool call。
- 快车道零 tool call（仅 `defer_to_deep`），近期消息读常驻投影而非查工具。
- 快车道复用 `Role.md`，不新增人格文件。
- 有损 intake 为门口裁决：accepted 即必定进上下文，丢弃只发生在门口。
- L3 审批为提交即返回的状态机，JSONL 是真相源，approve 后由 runtime 执行。
- 事件日志硬切 v2，不做 v1 upcast（旧日志已由用户手动归档）。

**落地前必须先实测、不得凭假设的两点**

1. LangGraph JS 的 `GraphNode` 第二参数是否确实透传 `RunnableConfig`（feat-009 全靠它）。
2. `packages/utils` 的 subpath export 在 tsc references、eslint 与 Next webpack 三处的解析（feat-008 单元 1 就要验掉）。

## 真实终端验收结果（2026-08-17，用户执行）

用户在 Windows Terminal → tmux 3.4 → WSL 环境下执行了验收清单，结果：

| 项目 | 结果 |
| --- | --- |
| 备用屏启动与退出恢复 | pass |
| kitty Shift+Enter 换行 | **fail** —— 该环境不支持 kitty 协议，非代码缺陷；见 Blockers / Risks 与 Decisions Made |
| 真实鼠标滚轮（transcript 与设置面板均不泄漏转义字符） | pass |
| Web 与 TUI 双端共享同一 runtime | pass |

复现命令（若需在其它终端回归）：

```bash
# 终端 A
pnpm server
# 终端 B（真实终端，非 IDE 内嵌伪终端更佳）
pnpm tui
```

四项中三项通过，feat-005 的鼠标序列消费部分至此在真实终端得到确认。唯一失败项 Shift+Enter 已定位为终端能力缺失而非代码缺陷；用户决策换用支持 kitty 协议的终端、代码不动，据此把 feat-005 置为 `done`。

**留痕**：换行在支持 kitty 协议的终端上尚未经过真实按键确认。目前支撑该功能正确性的证据是探针实测（喂入 `CSI 13;2u` 等编码后 ink 派生 `name=return, shift=true` 并走 `insert-newline`），不是真机按键。用户换终端后建议顺手确认一次。

## Blockers / Risks

- [x] **TUI 鼠标序列消费不完整**：已由 feat-005 修复（commit f89ac99）。改为 `apps/tui/src/hooks/mouseSequence.ts` 的跨 chunk 状态机消费器：SGR(1006) 与 X10 各有独立的组装路径，X10 按固定 5 字节长度消费并以 `charCode - 32` 映射滚轮。**行为约定**（改动前先读）：组装被证伪或累积超过 `MAX_MOUSE_SEQUENCE_LENGTH`（64）时，缓冲**原样回吐为普通输入**而非丢弃 —— 那些字符可能是用户真敲的，静默丢弃会造成可见的输入丢失。裸 `[` 不进入组装状态（判别前缀只有 `[<` 与 `[M`），否则 `[a` 会被整体吞掉；这正是消费器初版引入、后被表驱动测试抓到的回归。`App.tsx` 在回吐跨越多 chunk 时直接 `insert` 文本而不复用 `key`，因为此时 `key` 只描述最后一个 chunk。
- [x] **TUI 真实终端交互验收**：已于 2026-08-17 由用户执行。备用屏、真实鼠标滚轮、双端共享 runtime 三项通过；Shift+Enter 换行失败，另立下一条。
- [ ] **Shift+Enter 换行在无 kitty 键盘协议的终端上不可能工作**：不是代码缺陷，是终端能力缺失。用户已决策换用支持该协议的终端、代码保持不动，故 feat-005 不因此项停留在 `blocked`；但只要有人在不支持的终端上跑 TUI，此限制依旧存在，因此保留为开放风险。三组实测（探针脚本跑完已删）：
    1. 喂入 kitty 编码 `CSI 13;2u` / `CSI 13;2:1u` / `CSI 13;2;13u`，复刻 ink `use-input.js` 的 key 派生逻辑后均得到 `name=return, shift=true`，进 `editBuffer` 走 `insert-newline`。**代码路径正确**。
    2. 在真实 pty（detached tmux pane，`stdin.isTTY=true`）里发 ink auto 模式使用的能力查询 `CSI ? u`，回应 **0 字节**。`Ink.initKittyKeyboard` 在 auto 模式下靠该回应决定是否 `enableKittyProtocol`，200ms 超时后静默放弃，`kittyProtocolEnabled` 保持 false。
    3. 对照组：用 tmux passthrough（`DCS tmux; …ST`，ESC 加倍）把查询直送外层终端，同时发 primary DA。DA 正常回 `ESC[?1;2;4c`，kitty 查询仍无回应 —— **回应通道是通的，是外层 Windows Terminal 不支持该协议**。tmux 3.4 亦为 `extended-keys off`。
       没有 kitty 协议时终端对 Enter 与 Shift+Enter 发出完全相同的 `\r`，应用层无法区分，属物理信息缺失。
       **当下可用的替代键：Ctrl+J**（发 `\n`，ink 解析为 `name=enter`；`enter` 不在 `nonAlphanumericKeys` 中，故 `input` 保留 `\n` 并走 `buffer.insert("\n")`，探针实测为 `insert-text:"\n"`）。此路径无需改代码即可用，但尚未在 Composer 提示里告知用户。
       **反向警告：不要打开 tmux 的 `set -s extended-keys on`。** 那会让 Shift+Enter 变成 xterm modifyOtherKeys 的 `CSI 27;2;13~`，而 ink 7 不解析该形式，探针显示整串落回普通文本，会往输入框插入字面量 `[27;2;13~`，比现状更糟。
- [ ] **输入缓冲按码点而非字素簇切分**：`Array.from` 切分导致 ZWJ 组合 emoji（如 `👨‍👩‍👧`）退格只删掉最后一个码点，组合符 `é`（e + U+0301）退格只去掉重音。纯显示问题，无崩溃、无孤立代理对，BMP 与单码点 emoji 场景正确。彻底修需改用 `Intl.Segmenter` 统一封装字素切分供 buffer 与 Composer 共用。
- [ ] **reasoning 交错信息丢失**：client-core 中每轮 reasoning 累加为一个字符串，无法还原 think → tool → think 的真实交错，当前每轮只呈现工具调用前的一个 thinking 块。要还原需扩展 `packages/protocol`。
- [x] **compact 无服务端入口**：已由 feat-004 解决。server 提供单连接 WS compact / daydreaming 请求，`memoryDir` 和 scheduled compact 阈值由配置注入；scheduled 调度只消费 runtime `done` 输出事件。
- [ ] **运行环境未隔离**：多个 server 实例同时启动会撞端口 8787 并共写 `~/.caicaiclaw/history.jsonl`。需要并行运行时自行配置 `.env`。
- [x] **Codex 沙箱无法执行 admin 进程闭环（限制属沙箱，不属本机）**：codex 在其沙箱内的启动命令于 tsx IPC 管道 `/tmp/tsx-1000/16.pipe` 返回 `listen EPERM`，Node/WebSocket 127.0.0.1 listen 同样受限，child_process 的 piped stdout/stderr 也不转发。**本机无此限制** —— Claude 已在本机用隔离端口（admin=39001、ws=39002）与临时数据目录实测通过 start / hello→running / compact / stop，详见 Evidence 表。下次遇到「跑不起来」先分清是沙箱还是本机。
- [x] **feat-006 运行时验收**：已全部完成。start / running / compact / stop / restart / 崩溃语义由 Claude 在本机隔离端口实测；10MB 日志下 `/logs` 性能、JSONL 字节只读与崩溃 stderr 的 UI 呈现由用户于 2026-08-17 人工验收通过。
- [x] **admin 的 header 认证为死代码**：已修。`readToken()` 的 `Authorization: Bearer` / `x-caicai-admin-token` 分支因 middleware 只校验 cookie 且 matcher 覆盖 `/api/*` 而永不可达，已连同不可达的手工 cookie 解析一并删除；`isAuthorized` 收窄为只读 cookie，`/api/auth` 改用新的 `verifyToken`。**认证来源现已唯一化**，middleware 与路由层看同一个 cookie。脚本化调用 admin API 只能用 `Cookie: caicaiclaw_admin_token=<token>`。
- [ ] **agent WS（默认 8787）无认证**：admin 面板本身有 token，但 agent 的 WebSocket 端口没有 —— 任何能访问本机该端口的页面或进程都可以向 agent 发送输入，而 agent 持有 `exec` 工具。当前依赖「只监听 127.0.0.1」作为唯一边界。本次未扩大范围处理，改动 agent 传输层前应先决定是否引入握手认证。

## Decisions Made

- **Harness 回到单 lane 模式**：多 worktree lane 变式（`.harness/<slug>/state.json` 分片 + `harness/lanes.sh` 校验 + `harness/wt.sh` 生成器）在实际使用中不好用，已移除。状态回归根级 `feature_list.json` + `progress.md`。
  - Context: 分片状态与集成视图必然 drift，且自定义 schema 校验的维护成本高于收益。
  - Alternatives considered: 保留 lane 脚本但简化字段表；结论是并行开发的实际需求不足以支撑这套机制。
- **传输层归属 client-core**：transport 提升到 `packages/client-core`，Web 与 TUI 共用，不在各端重复重连与解析逻辑。
- **TUI 换行只做 Shift+Enter**，需 kitty 键盘协议；`ws_url` 仅进程内生效，不落盘。
  - 2026-08-17 更新：该决策在用户当时的终端（Windows Terminal + tmux 3.4）上不成立，Shift+Enter 无法与 Enter 区分。**用户决策：换用支持 kitty 协议的终端（WezTerm / kitty / Ghostty），代码保持不动。** 被否决的备选是把 Ctrl+J 提升为一等换行键并写进 `Composer` 提示文案 —— 那会让换行在所有终端可用，但引入第二个换行键位和额外的文案维护面。因此本决策原样保留：**换行依赖 kitty 键盘协议是一个明确的、已知的终端要求，不是缺陷**。
- **仓库不设 `test` 命令**：测试覆盖率不是完成门槛，行为变更靠与风险相称的手动验收，证据记录在本文件。

## Evidence of Completion

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Static verification | `./init.sh` | pass | 2026-08-17：`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过。 |
| Diff hygiene | `git diff --check` | pass | 无空白错误。 |
| Web build | `pnpm --filter @caicaiclaw/web build` | pass | Next production build 编译、类型检查与静态页面生成通过。 |
| feat-003 checkpoint flow | 一次性 TypeScript 验收脚本（已删除） | pass | 连续三次 compact 与重启回放；输出 `{"checkpoints":3,"replayCommittedTurns":3,"longResultLength":10000,"historyPage":"xxxxx"}`。 |
| feat-003 并发 / 失败原子性 | 一次性 TypeScript 验收脚本（已删除） | pass | compact 期间 enqueue 串行等待；摘要失败不追加 checkpoint。 |
| feat-003 上下文 / memory | 一次性 TypeScript 验收脚本（已删除） | pass | 固定顺序、唯一 SystemMessage、预算错误与缺失 SYSTEM.md 错误均符合预期。 |
| feat-003 工具结果投影 | 一次性 TypeScript 验收脚本（已删除） | pass | 10,000 字符原文仅存 `tool.completed`；稳定 `history://` 引用、分页与 offset 越界错误符合预期。 |
| feat-002 运行时验收 | 一次性 `tsx` fake browser/socket harness | pass | URL/clientId 恢复、连接、hello/message、input 序列化、重连退避、显式断开、协议版本不匹配主动断开。 |
| feat-002 手动验收 | 用户确认 | pass | 用户于 2026-08-17 确认已完成真实手动验收。 |
| feat-001 运行时 harness | 一次性脚本（写在 `/tmp`，跑完即删，**不可重跑**） | pass | 真实 Ink 7.0.6 渲染 + 真实 `parse-keypress` 输入管道。滚动：`maxOffset > 0` 且恒等于「内容高 − 视口高」，offset 变化时可见行数不变而内容不同（证明是裁剪而非 flex-shrink 抽稀）；独立复核在 rows=24 / 60 条消息下测得 `viewportHeight=16, maxOffset=44`。单 chunk 完整 SGR 鼠标序列不进输入缓冲，64/65 正常滚动。`abcdef` cursor=3 连按三次退格得 `def/cursor=0`。`a😀b` 退格得 `a😀`，无孤立代理对。stickBottom 三态实测成立。 |
| feat-001 真实终端验收 | 用户在真实终端操作 | **未执行** | 见 Blockers / Risks。 |
| feat-004 静态验证 | `./init.sh` | pass | 2026-08-17：实际输出为 `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过，随后输出 `=== Verification complete ===`。 |
| feat-004 server/runtime 验收 | `pnpm exec tsx /tmp/caicaiclaw-feat-004-acceptance.ts` | pass | 实际输出包含 `{"protocolVersionAndSchemas":"passed","unknownServerTypeCompatibility":"passed","invalidThreshold":"passed"}`、`{"serverManualCompact":"passed","queuedCompact":"passed","scheduledCompactCalls":2,"isolatedErrors":"passed","daydreamingAtomicRoleWrite":"passed","systemFileUnchanged":"passed","runtimeContinuedAfterFailure":"passed"}`、`{"scheduledCompactThresholdZero":"passed","compactCalls":0}` 与缺失 memory 通过；脚本断言第 4 个 done 触发 scheduled compact 一次，`scheduledCompactCalls:2` 的第二次调用为排队手动 compact；脚本已删除。 |
| feat-004 diff hygiene | `git diff --check` | pass | 实际无输出且退出码为 0。 |
| feat-004 独立复核（协议 / 配置） | 一次性 `tsx` 脚本（已删除） | pass | 11/11。除版本号 2→3、round-trip、未知 type 前向兼容外，额外覆盖空 summary 被 schema 拒绝、阈值负值被拒、`memoryDir` 在空 `systemPromptPath` 时回落到 history 目录。 |
| feat-004 独立复核（runtime 行为） | 一次性 `tsx` 脚本（已删除） | pass | 23/23。Role.md 原子替换、SYSTEM.md 不变、无 `.tmp` 残留、Memory.md 与 tasks 未被误创建；模型失败 / 空反思 / 超预算三种情况下 Role.md 均保持原样；缺失 memory 文件仍可工作。 |
| feat-004 独立复核（排队 compact） | 一次性 `tsx` 脚本（已删除） | pass | 11/11。4 个 committed turn 下排队 compact 返回摘要；checkpoint 追加在完整 turn 之后且无 turn 跨越 checkpoint；manual 与 scheduled trigger 均正确落盘；原始 `input.accepted` 不被改写。 |
| feat-004 独立复核（真实 ws 端到端） | 一次性 `tsx` 脚本 + 真实 `ws` 双连接（已删除） | pass | 15/15。compact / daydreaming 回执与失败错误只回发起连接，第二连接收不到；失败后 runtime 仍接受输入；scheduled compact 阈值前不触发、达阈值触发一次、阈值 0 六轮输入后仍无 checkpoint。 |
| feat-004 依赖方向 | `grep -rn "@caicaiclaw/protocol" packages/agent-core/src/` | pass | 无匹配，agent-core 未引入 protocol。 |
| feat-005 消费器纯函数 | 一次性表驱动 `tsx` 脚本（已删除） | pass | 27/27。单 chunk SGR 的 button 64/65/0 与小写 `m`；SGR 跨 2 与 3 chunk 分片；X10 单 chunk 与三字节跨 chunk；序列后 remainder 回流；连续两序列不串台。普通文本回归：`a`、`[hello]`、裸 `[`、`[<abc`、`[<12`+`xyz`。不吞键：超长垃圾、累积超限、证伪中断后紧随按键仍生效。 |
| feat-005 真实 Ink 集成 | 一次性 `tsx` 脚本 + 真实 Ink 7 render + 真实 stdin `readable` 管道（已删除） | pass | 8/8。X10 不进输入缓冲且触发滚动；设置面板下 X10 与分片 SGR 均不污染 `ws_url`；分片 SGR 首片不落入缓冲、组装后滚动；普通字符仍可输入。 |
| feat-005 静态验证 | `./init.sh` | pass | 2026-08-17：三项检查全部通过并输出 `=== Verification complete ===`。 |
| feat-005 真实终端验收（备用屏 / 鼠标滚轮 / 双端共享 runtime） | 用户在真实终端操作 | pass | 2026-08-17 用户确认三项通过：备用屏启动与退出恢复；真实滚轮在 transcript 与设置面板均滚动正常且无转义字符泄漏（真实终端确认了消费器的 X10 / 分片修复）；Web 与 TUI 双端观察到同一 runtime。 |
| feat-005 真实终端 Shift+Enter | 用户在真实终端操作（Windows Terminal + tmux 3.4） | **fail（环境不支持）** | 2026-08-17。经三组探针实测定位为终端不支持 kitty 键盘协议（`CSI ? u` 回应 0 字节，而对照 primary DA 正常回 `ESC[?1;2;4c`，证明回应通道通畅），非代码缺陷。用户决策换终端、代码不动，据此不阻塞 feat-005。 |
| feat-005 Shift+Enter 代码路径 | 一次性探针脚本（已删除） | pass | 喂入 kitty 编码 `CSI 13;2u` / `CSI 13;2:1u` / `CSI 13;2;13u`，复刻 ink `use-input.js` 的 key 派生逻辑后均得 `name=return, shift=true`，在 `editBuffer` 走 `insert-newline`；对照普通 `\r` 得 `submit`。**这是喂入编码的探针验证，不是真机按键。** |
| feat-005 支持 kitty 终端上的真实按键换行 | 用户在支持 kitty 协议的终端操作 | **未执行** | 用户决策换终端但尚未在新终端回归此项。功能正确性目前仅由上一行的探针证据支撑。 |
| feat-006 静态验证 | `./init.sh` | pass | 2026-08-17 本次修复后串行执行：`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过，输出 `=== Verification complete ===`。并行跑 build 的一次缺失 `.next/types` 是构建清理竞争，随后串行重跑通过。 |
| feat-006 supervisor store / 页面静态验证 | `./init.sh` | pass | 新增 store 的结构化响应校验、action 去重、hook 驱动的轮询生命周期通过 typecheck / lint / format；两个页面不再各自轮询 `/api/agent`，Alert 改用结构化 `outcome` 而非猜测文案。 |
| feat-006 supervisor store 轮询生命周期 | 一次性探针：Node loader hook 将 `react` 换成立即执行 effect 的桩，`import` **真实** store 模块（跑完已删） | pass | 实际输出 `{"statusAfterPoll":"running","firstPollHappened":true,"pollsWithTwoConsumers":3,"singleLoopOnly":true,"stillPollingAfterOneUnmount":true,"noFetchAfterFullUnmount":true,"remountRestartsPolling":true,"noLeakAfterFinal":true}`。`statusAfterPoll:"running"` 证明轮询真的把服务端 snapshot 写进 store；2.3s 内两个 consumer 共 3 次 fetch 证明只有一个循环。 |
| feat-006 action 跨路由存活 / 并发重入 | 同上探针机制（跑完已删） | pass | 实际输出 `{"activeWhileRunning":"compact","reentryRejected":true,"otherActionRejectedWhileBusy":true,"onlyOnePostSent":true,"actionSurvivedRouteChange":true,"actionResolvedOk":true,"finalOp":{"action":"compact","outcome":"success","message":"compact 完成：compacted 12 turns"},"activeClearedAfterDone":true}`。compact 进行中卸载 `/agent`、挂载 `/chat`，`activeAction` 仍为 `compact`，完成后结果正确落入 `lastOperation` —— 即本次要修的「切路由丢状态」。 |
| feat-006 zustand 猴子补丁失效（已修回归） | 一次性探针（跑完已删） | **抓到并已修** | codex 初版用 `useAgentSupervisorStore.subscribe = ...` 做引用计数驱动轮询。zustand 5.0.14 的 `useStore` 捕获闭包内的 `api.subscribe`，`Object.assign` 只把引用拷到 hook 对象上，替换 hook 属性影响不到 React 实际调用的那个。探针实测 `{"patchedCallsAfterApiSubscribe":0,"patchedCallsAfterHookSubscribe":1}`，且两个页面都只用 selector、无人直调 `.subscribe` —— 轮询永不启动，snapshot 会永久停在 `stopped`。已改为显式的 `useAgentSupervisorPolling()` + `useEffect` 引用计数。**教训：不要为拿订阅生命周期而覆盖库导出的方法。** |
| feat-006 admin build | `pnpm --filter @caicaiclaw/admin build` | pass | 2026-08-17：Next.js `16.2.10 (webpack)` 输出 `Compiled successfully`、`Finished TypeScript`、静态页 `9/9`，路由清单含 `/agent` 与 `/api/agent/action`。（codex 当时的构建含 `experimental.esmExternals: false` 及其“不推荐修改”警告；该开关随后经实测证否并移除，移除后重新 build 仍通过、无该警告。） |
| feat-006 ws 外置 bundle 验证 | `rg` 检查 `apps/admin/.next/server` | pass | 实际输出：`route.js ... a.exports=require("ws")` 两处、`require_ws_count=2`；JS 内 `Sender=0`、`buffer-util=0`、`WS_NO_BUFFER_UTIL=0`。NFT 仅追踪 node_modules 下原始 `ws` 文件，未把实现内联进 JS。 |
| feat-006 memory/logs 边界 | 一次性 Node + `tsx` 临时目录脚本 | pass | 2026-08-17：乐观锁冲突、原子替换无 `.tmp`、符号链接逃逸拒绝、反向日志分页、损坏行号和工具结果 offset/limit 均通过。 |
| feat-006 supervisor 运行时（start / hello→running / compact / stop） | 隔离脚本：`node --import tsx/esm apps/admin/src/server.ts`，admin=39001、ws=39002、数据目录 `/tmp/caicai-fix-verify`（跑完已删） | pass | 2026-08-17 由 Claude 在本机实测（codex 沙箱 `listen EPERM` 跑不了，本机可以）。实际输出：admin 2s 内就绪；`{"action":"start"}` → HTTP 200 且 `status:"starting"`, pid 35257；t=1s `starting` → t=2s **`running`**（证明 control 连接收到 `hello`，非仅进程存活）；`{"action":"compact"}` → **无 mask 错误**，返回 `{"error":"cannot compact without committed turns after the current checkpoint"}`（空历史下的正确 runtime 拒绝，证明请求已成功抵达 runtime）；`{"action":"stop"}` → HTTP 200、`status:"stopped"`、`exitCode:0`、`forcedKill:false`（graceful 退出）。admin.log 全程无 `mask is not a function`。**未覆盖**：restart、崩溃 stderr UI、10MB 日志性能。 |
| feat-006 ws mask 缺陷修复确认 | 上一行同一次实测 + 构建产物检查 | pass | 修复前点 compact 报 `b.mask is not a function` 并被误映射为 400；修复后真实回路不再抛该错。产物侧：`Sender`、`buffer-util`、`WS_NO_BUFFER_UTIL` 内联均为 0（`.nft.json` 里出现 `permessage-deflate` 属 Node File Trace 的部署清单，非内联代码）。 |
| feat-006 `esmExternals: false` 必要性 | 移除该开关后重新 build + 上述运行时实测 | **确认不必要，已移除** | 去掉后构建通过，ws 仍为外部引用（形式由 `require("ws")` 变为 `import("ws")`），内联仍为 0，运行时 compact 正常。起作用的只有 `serverExternalPackages: ["ws"]`。 |
| feat-006 restart 闭环（本次修复） | 隔离脚本：admin=39011、ws=39012、数据目录 `/tmp/caicai-restart-verify`（跑完已删） | pass | 2026-08-17 由 Claude 在本机实测（codex 沙箱 `listen EPERM` 跑不了）。实际输出：start → HTTP 200 `starting` pid 44749，t=2s `running`；**restart → HTTP 200**，返回快照为**新进程** `{"status":"starting","pid":44785}`，t=2s `running`；stop → `stopped`、`exitCode:0`、`forcedKill:false`。旧 pid 44749 ≠ 新 pid 44785，证明确实换了进程且 HTTP 不再误报 `cannot start agent while status is starting`。 |
| feat-006 崩溃语义（stderr 快照数据链路） | 同一次隔离实测：对子进程 `kill -9`（跑完已删） | pass | 实际输出 `{"status":"crashed","exitCode":null,"signal":"SIGKILL","forcedKill":false,"error":"agent control connection lost"}`。区分了外部 SIGKILL（`forcedKill:false`）与 supervisor 自身超时强杀。SIGKILL 不产生 stderr，故 `stderr:[]` 属预期；**未覆盖**：子进程写出 stderr 后异常退出时 UI 的实际渲染。 |
| feat-006 大日志性能 / JSONL 字节只读 / 崩溃 stderr UI | 用户人工验收 | pass | 2026-08-17 用户确认通过：10MB 量级日志下 `/logs` 首屏与翻页可用、admin 全程只读 `history.jsonl`、崩溃时 stderr 在 `/agent` 正常呈现。据此将 feat-006 置为 `done`。 |
| feat-006 `.env.example` 完备性 | 双向 `grep` 比对示例文件与源码引用 | pass | 补全 `CAICAI_MEMORY_DIR`、`CAICAI_COMPACT_EVERY_TURNS`、`CAICAI_ADMIN_PORT`、`CAICAI_ADMIN_STOP_GRACE_MS`、`CAICAI_ADMIN_STARTUP_TIMEOUT_MS` 五项后，「代码用到但示例未记录」为空。反向仅剩 `OPENROUTER_API_KEY` —— 它由 `@langchain/openrouter` 自行读环境（`createOpenrouterModel` 只传 `model`），源码无字面引用属预期。 |

## Notes for Next Session

- **feat-007 已完成（2026-08-17）**：agent WS 在 HTTP Upgrade 阶段以 `verifyClient` + `timingSafeEqual` 校验 `?token=`，错误与缺失 token 均返回 401，未进入 `connection` 或 runtime；空 `CAICAI_WS_TOKEN` 仍保持仅限 127.0.0.1 的兼容行为。TUI Tab 设置页增加 `ws_token`，`client-core` 统一编码 query 参数。admin 新增 `/settings`，其读取接口仅返回是否已配置；浏览器直连需要的 token 仅从独立 cookie 鉴权 + `no-store` 连接接口即时取得，未编入 `NEXT_PUBLIC_*`、未落 Zustand/localStorage。admin 保存密钥使用默认位于 history 同目录的 `agent-ws-token` 原子替换（0600）；supervisor spawn 与 control WS 都动态读取该值，因此更新后在 `/agent` 重启即可生效。验收：真实 server 入口输出 `{\"missing\":\"error\",\"wrong\":\"error\",\"valid\":\"open\"}`；admin 覆盖文件的环境回退、保存覆盖、0600 权限、清空回退均 passed；admin production build 通过。首次并行执行 build 与 `./init.sh` 曾发生 Next 清理 `.next/types` 的既有竞态，随后串行 `./init.sh` 已通过 typecheck/lint/format，`git diff --check` 通过。运行配置已同步 `.env.example`。

- feat-001 的 runtime harness 是一次性脚本、跑完即删，**证据不可重跑**。若要回归验证滚动与输入行为需重新搭建，要点：ink 7 的 stdin 走 `readable` 事件 + `stdin.read()`，用 `data` 事件会导致按键完全不送达而产生假阴性。
- feat-001 经两轮独立 review，14 条发现中 13 条已修且经真实 Ink 渲染复核可复现；鼠标序列消费一条只修了单 chunk 完整 SGR 的部分。用户已在此状态上验收，残留项转为 feat-005。
- `packages/client-core/src/transport.ts` 保留 `onError?: (error: unknown) => void`。若后续新增消费方沿用更窄的 `Event | Error` 回调，需先调整回调参数类型或在注入处适配，避免 strictFunctionTypes 的 TS2322。
- feat-001 ~ feat-005 全部 `done`。feat-005 是在 Shift+Enter 一项验收失败的情况下由用户决策置 `done` 的（根因为终端能力缺失，用户选择换终端而非改代码）。**换行在支持 kitty 协议的终端上从未经真实按键确认过** —— 若日后有人报"换行不工作"，先按 Blockers / Risks 里的三步探针确认终端是否支持该协议，再怀疑代码。
- **不要自行把 Ctrl+J 提升为换行键位。** 该备选已被用户明确否决，理由是不想引入第二个换行键位与额外文案维护面。
- ink 7 的 kitty 支持是 opt-in + auto 探测：`Ink.initKittyKeyboard` 在 `mode: "auto"` 下先写 `CSI ? u` 并只等 200ms，无回应即静默放弃。要判断某终端能否支持 Shift+Enter，直接在真实 pty 里发该查询看有无回应即可，比翻终端文档快。注意必须在真实 pty 中测：普通 tool shell 没有 TTY（`process.stdin.isTTY` 为 `undefined`），可用 `tmux new-session -d` 起一个 detached pane 拿到真实 pty。
- 所有 feat-003 / feat-004 / feat-005 的验收脚本都是一次性的、跑完即删，**证据不可重跑**。要回归验证需重新搭建：protocol / config 相关的脚本必须放在 `apps/server` 下跑（workspace 依赖只在消费方目录内可解析），runtime 行为脚本放在 `packages/agent-core` 下跑且**不能 import protocol**（依赖方向不允许）；假模型要真的继承 `SimpleChatModel`，用 `{invoke, bindTools}` 裸对象会让 turn 直接 `turn.failed`。
- 追加 checkpoint 的验收需要至少 4 个 committed turn：`DEFAULT_PRESERVED_TURNS = 3`，turn 数不足时 compact 不会产生 checkpoint，容易被误读成 bug。
- feat-006 已交付并通过人工验收，`feature_list.json` 中六个 feature 全部 `done`。开始新工作前先与用户确认下一个 feature，不要自行挑选。
- `.env.example` 与源码引用可用双向 `grep` 比对保持同步（提取 `CAICAI_`/`OPENROUTER_`/`NEXT_PUBLIC_CAICAI_` 前缀后 `comm` 两侧）。唯一预期的单向差异是 `OPENROUTER_API_KEY`：它由 `@langchain/openrouter` 自行读环境，源码里没有字面引用，**不要因此把它从示例文件删掉**。
- feat-006 的 ws 缺陷根因：Next webpack 的默认 ESM externals 将 `ws` 错误内联时，`buffer-util` 的 module.exports 事后 mask 改写丢失，`sender` 解构到非函数；修复后必须保留 `ws` 外置产物检查，避免只看 build 成功。
- **不要用覆盖库导出方法的方式去拿订阅生命周期。** zustand 的 `create` 是 `Object.assign(hook, api)`，React 的 `useStore` 用的是闭包里的 `api.subscribe`；替换 `hook.subscribe` 对 React 路径完全无效（实测 `patchedCallsAfterApiSubscribe: 0`），会静默得到一个永不启动的轮询。要引用计数就用显式的 `useEffect` hook，让生命周期由 React 驱动。
- **admin 侧的行为验证不能只跑纯函数探针。** 上述回归之所以漏过，正是因为只验了 store 的纯函数部分和「直调 `.subscribe`」路径 —— 那条路径恰好绕过了 React 实际走的路径，测出来是绿的。仓库无测试框架也无 jsdom；本次可用的办法是用 Node loader hook（`module.register()`，**不是** `--import` 一个导出 `resolve` 的文件，那样不会注册）把 `react` 换成"立即执行 effect 并交出 cleanup"的桩，然后 `import` **真实的** store 模块，这样测的是产品代码本身。
- **在本机跑 admin 隔离验收时，`pkill -f "apps/admin"` 这类宽模式会打到用户自己在跑的实例。** Next dev server 还有「同目录只允许一个实例」的限制，端口隔离不足以避开冲突。用精确 pid、或先 `ps -o args` 确认归属再动；本次因此误停了用户 admin 的 HTTP 监听（agent 子进程与 control 连接未受影响，但面板需重启才能打开）。
