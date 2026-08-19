# Session Progress Log

## Current State

**Last Updated:** 2026-08-19
**Active Feature:** feat-015（M3-7 后台队列、adapter 视图与调试入口）**11 个提交单元全部完成**，`./init.sh` 与 admin production build 均通过，行为验收已逐条记录（见「feat-015 实施进度」）。feat-014（M3-6 QQ 开放平台渠道）代码单元全部完成并提交，状态为 **blocked**：唯一未满足的 doneCriteria 是 QQ 沙箱真实往返验收，需要用户提供 AppID / AppSecret 并在开放平台配置群聊 @ 与单聊权限，这是外部依赖而非未完成的实现工作（详见「feat-014 实施进度」的残留阻塞）。feat-015 依赖 feat-013 而不依赖 feat-014，故在 feat-014 解除阻塞前推进，仍满足「一次只推进一个未阻塞 feature」。用户已授权将 `@modelcontextprotocol/sdk` 仅加入 apps/server，agent-core 保持不 import MCP 或渠道 SDK。

### feat-015 提交计划（2026-08-19 立）

现状核查（实施前已确认，避免把「已有」当「缺失」）：`apps/server` 目前**完全没有 HTTP 路由**，是纯 WS；admin 的 REST 路由都在 Next 侧。README 指定的 `lane_snapshot` / `intake_snapshot` / `channel_snapshot` 三种消息在全仓 grep 无命中，属全新协议面，protocol 版本需 6 → 7。`sendToObservers` 已同时覆盖 observer 与 admin 角色，新快照消息可直接复用。`approval_decision` 是 admin 唯一已存在的写入路径（server.ts 已按 admin 角色 gate），可作为调试入口的范式；但 admin 前端尚无任何 admin 角色连接，`buildWsUrl` 也缺 `adminToken` 参数。队列深度、槽位占用、入站速率均未被任何公开 API 暴露；`droppedCount` 目前只有总数、没有按 reason 分类。

拆分为以下提交单元，每个都是可独立 `git revert` 的原子单元：

1. **按 reason 分类的 droppedCount**：`RawHistoryConversationProjection.droppedCount` 现在只是总数，doneCriteria 要求按 reason 分类。改为同时保留总数与分 reason 计数，回放 `input.dropped` 时按 `event.reason` 累加。标题：`feat(agent-core): 按 reason 分类 conversation droppedCount`。验证：`./init.sh` + probe 回放多种 reason 后校验分类计数。
2. **runtime 快照读取 API**：在 `IntakeController` 增加按 conversation 汇总 pending 槽位（区分通用槽与保留槽，复用已有的私有 `isPriority` 判定）与生效策略的公开访问器；在 `AgentRuntime` 增加 lane 状态 / 队列深度 / intake 快照 / channel 快照的公开 getter。只读，不改任何裁决行为。标题：`feat(agent-core): 暴露车道与 intake 快照读取 API`。验证：`./init.sh` + probe 校验快照与实际排队一致。
3. **入站速率与 outbound 计数**：入站速率目前无任何计数器。新增滑动窗口入站速率统计，并从 `outboundEvents` 投影汇总每渠道成败计数与最近错误。标题：`feat(agent-core): 统计入站速率与 outbound 成败`。验证：`./init.sh` + probe 校验窗口滚动与计数。
4. **三种快照协议消息**：protocol 新增 `lane_snapshot` / `intake_snapshot` / `channel_snapshot`，版本 6 → 7；server 在运行时状态迁移时经 `sendToObservers` 推送，并加低频轮询兜底以免断连后面板僵死。标题：`feat(protocol): 新增队列与 adapter 快照消息`。验证：`./init.sh` + probe 校验状态迁移推送与重连后恢复。
5. **admin 角色连接**：`buildWsUrl` 增加 `adminToken` 参数，admin 前端以 admin 角色连接并消费快照与审批消息。标题：`feat(client-core): 支持 admin 角色连接`。验证：`./init.sh` + probe 校验带 adminToken 的握手。
6. **队列视图**：admin 新增车道与 intake 队列视图，呈现每车道状态、排队数、每 conversation 槽位占用、按 reason 分类的 droppedCount 与生效策略。标题：`feat(admin): 增加车道与队列视图`。验证：`./init.sh` + admin production build。
7. **adapter 视图**：呈现连接状态、已注册工具及权限级别、入站速率、outbound 成败计数与最近错误。标题：`feat(admin): 增加 adapter 视图`。验证：同上。
8. **审批视图**：pending 与已决历史，可 approve / deny，显示完整 tool name 与 args。复用已有的 `approval_decision` 写入路径。标题：`feat(admin): 增加 L3 审批视图`。验证：同上。
9. **调试入口：注入入站**：admin 可构造 `ChannelEvent` 投进 intake（可勾 `isSelf` 验回声抑制），server 侧对 admin 角色强制打 `debugOrigin: "admin"`（当前 server 对 admin 角色的 input 既不 stamp origin 也不校验 channel），回执显示 disposition。标题：`feat(server): 增加 admin 入站注入调试入口`。验证：`./init.sh` + probe 校验强制 stamping 与 self_echo 抑制。
10. **调试入口：直调出站 tool（默认 dry-run）**：默认只校验 schema 与路由解析、不真实投递，显式确认才真发，且仍受权限分级与 L3 审批约束。标题：`feat(server): 增加出站工具 dry-run 调试入口`。验证：`./init.sh` + probe 校验 dry-run 不产生平台调用、真实执行仍走 L3 审批。
11. **状态与证据登记**：`feature_list.json` 的 status / evidence 与本文件同步。标题：`chore: 登记 feat-015 状态与证据`。

拆分依据：先补数据（1-3 只读/统计，不改裁决行为），再开协议面（4-5），再落三个视图（6-8 纯前端消费），最后加两个带写入语义因而风险最高的调试入口（9-10）。JSONL 对后台严格只读不变：调试注入与审批决策都走 runtime 公开入口。

### feat-015 实施进度（2026-08-19）

已完成并提交：

- `50aa1f8` 单元 1 按 reason 分类 droppedCount。总数语义不变，新增稀疏的 `droppedByReason`（Partial 而非全量 Record，视图才能区分「没发生」与「发生过被清零」）。`DropReason` 从 `RawHistoryEvent` Extract 而非硬编码第二份字面量联合。验证：`./init.sh` 通过；probe 回放 6 条含 4 种 reason 的 `input.dropped`，输出 `droppedCount=6`、分类计数求和等于总数、未发生的 `priority_buffer_full` 不出现。probe 已删除。
- `9920e96` 单元 2 车道与 intake 快照读取 API。`IntakeController.conversationSnapshots / effectivePolicies`，`AgentRuntime.laneSnapshots / intakeSnapshots / effectivePolicies / channelSnapshots`。通用槽与保留槽的划分复用 `admit` 内部同一个私有 `isPriority`，不另写第二份判定。验证：`./init.sh` 通过；probe 用真实 `admit` 跑满槽位，输出 `slotsMatchAdmit=true`（快照的 2 通用 + 1 保留与 admit 的 accepted/accepted/buffer_full/accepted 一致）、`copyIsolated=true`（返回的是拷贝，改不到内部状态）。probe 已删除。
- `a8ce97d` 单元 3 入站速率与 outbound 成败。速率按渠道 60s 滑动窗口，记录点在 `admit` **之前**（被丢弃的也算入站），用本地 `Date.now()` 而非 adapter 的 `receivedAt`（后者可能时钟偏差）。验证：`./init.sh` 通过；probe 输出 `qqCountIncludesDropped=true`（3 条含 1 条自回声丢弃）、`lastErrorIsLatest=true`。probe 已删除。
- `2805d53` 单元 4 三种快照协议消息与推送。协议版本 6 → 7。验证：`./init.sh` 通过；probe 拉起真实 server、以 observer 身份连 WS 并注入一条 ChannelEvent，输出三种快照全部收到、`pushedOnStateTransition=true`、`lanesCoverBothLanes=true`、`policiesIncludeDefaults=true`、`inboundRateRecorded=1`。probe 已删除。

- `b224d5f` 单元 5 admin 角色连接。`buildWsUrl` 的第三个参数改为联合类型（`string | { token?, adminToken? }`）而不是继续加位置参数，避免位置错位。admin 前端从 `/api/agent-auth/connection` 同时取 WS token 与 admin token，以 `{ type: "role", role: "admin" }` 作为 `CaiCaiWsClient` 构造参数握手（而非在 `onOpen` 里手发，否则会双发 role 而被 server 以「role 已声明」拒绝）。验证：`./init.sh` 通过；probe 校验带 adminToken 的 admin 握手被接受、缺 adminToken 被拒。probe 已删除。
- `380ffaf` 单元 5b 审批快照与 client-core 归约。四种快照在 `ClientState` 上的类型由 `Omit<Extract<ServerMessage, { type: "..." }>, "type">` 推导，协议变更自动传导而不需手写第二份结构。归约是全量替换而非增量合并。验证：`./init.sh` 通过。
- `fa2cf1b` 单元 6 车道与队列视图（`/runtime` 页面 + `LaneQueuePanel`）。
- `c6ee1ad` 单元 7 adapter 视图（`AdapterPanel`）。
- `f3d25fb` 单元 8 L3 审批视图（`ApprovalPanel`）。pending 完整展示 toolName 与 args（`JSON.stringify(args, null, 2)`，不截断不折叠），approve / deny 各带二次确认。决策走既有的 `approval_decision` 公开入口，admin 不触碰 `history.jsonl`，未新增任何 REST 路由。
- `c5f8277` + `4360d85` 单元 9 入站注入调试入口。server 按连接角色判定 `debugOrigin`：admin 一律标记 `admin`，非 admin 即使自带也剥掉。验证：`./init.sh` + admin build 通过；probe 拉起真实 server，admin 注入落 JSONL 为 `debugOrigin=admin`、adapter 显式传 `debugOrigin=admin` 落盘为 `undefined`、admin 注入 `isSelf=true` 回执为 `disposition=dropped` / `reason=self_echo`。probe 已删除。
- `83bde45` + `a8cc11b` + `7e296bd` 单元 10 出站工具直调（默认 dry-run）。协议版本 7 → 8。dry-run 只在 `McpToolHost` 解析 adapter 路由并复用既有 `validateJsonSchema` 校验参数，不调用 `client.callTool`；真实执行走新增的 `AgentRuntime.debugInvokeTool`，复用既有权限判定与审批路径。验证：`./init.sh` + admin build 通过；probe 拉起真实 server 并挂一个真实 MCP adapter（两个工具分别声明 L1 / L3），输出三次 dry-run 后真实调用计数为 `0`、真实 L1 调用计数变 `1`、真实 L3 返回 `pending_approval` 且计数不变、经 admin 审批后计数变 `2` 并落 `outbound.delivered`。probe 已删除。

实施中的取舍（均已在上述提交内并写了代码注释）：

1. **快照不挂在流式增量上**：`assistant_delta` / `reasoning_delta` 是高频事件，若在其上推送会把快照打成洪水。只在 `input_accepted` / `input_dropped` / `turn_start` / `done` / `error` 这些状态迁移点推，另加 5s 低频轮询兜底。
2. **outbound 汇总按 toolName 而非 channel**：outbound 事件本身不带 channel 字段，渠道信息只在 args 里且格式随工具而异。按 toolName 是唯一无歧义的口径，视图可从 `mcp__<adapter>__` 前缀自行推断归属。
3. **未声明权限的工具在视图里显示 L3**：与 runtime 的默认兜底一致——视图的目的是呈现实际生效级别，而不是「未配置」。
4. **`effectivePolicies` 用 `isDefaults` 布尔而非比较 `"(defaults)"` 字符串**：真实渠道理论上可以叫同名。
5. **`laneSnapshots` 没有 startedAt**：`TurnContext` 当前不含起始时间字段，不编造。
6. **`reply.maxChars` / `rateLimitPerMin` 为 0 在视图里渲染成「不限」**：0 的语义是不限长 / 不限频，直接渲染 `0` 会被读成「禁止回复」，是会导致误判的呈现错误。
7. **admin token 经 JS 可读的路由下发**：server 的 admin 角色握手要求 token 出现在 WS URL query 中，httpOnly cookie 里的值 JS 读不到，除此之外没有可用通路。这会扩大 XSS 影响面（拿到 token 即可冒充 admin 连 WS），因此该路由必须始终受 `requireAuth` 保护且响应不可缓存——已写进路由文件头注释。
8. **`debugOrigin` 由服务端按连接角色判定，不信任客户端自述**：否则 adapter 可以伪造调试来源，让真实平台事件在审计里看起来像人工注入。
9. **调试直调的 dry-run 是默认路径且只走 server 侧**：dry-run 分支根本不调 `runtime.debugInvokeTool`，从代码路径上就不可能产生投递，而不是依赖一个「记得别执行」的运行时判断。
10. **L3 调试直调只创建审批请求，`turnId` 用合成 id**：`approval.requested` 的投影不校验 `turnId` 是否是已知 turn（已核对 `history.ts`），因此合成 `debug-turn-*` 不会破坏回放；这样调试直调与正常轮次共用同一条审批出口。
11. **`debug_tool_result` 不进 `ClientState`**：它是一次性回执而非可回放状态，`client-core` 的归约走 `default` 分支不处理，回执只存在 admin store 的 `debugReceipts` 里（上限 20 条）。

剩余单元：11（状态与证据登记，本次进行中）。

断连恢复验收（doneCriteria「事件推送为主、低频轮询兜底，断连后能恢复」）：probe 拉起真实 server，第一条 admin 连接经一次状态迁移收到四种快照后断开；第二条 admin 连接**不再注入任何事件**，仅靠 5s 低频轮询在 6.5s 内重新收齐四种快照，输出 `recoveredWithoutNewEvents=true`。probe 已删除。

### feat-014 平台选型（2026-08-19，仅文档，未开工）

用户指定首个真实外部渠道改为 **QQ 开放平台机器人（api-v2）**，原定的「个人博客或 bilibili 开放平台」退场。本次只改 `feature_list.json` 的 feat-014、`README.md` 的 M3 章节与本文件，**不含任何实现**。三项由用户当场拍板的决策：

1. **adapter 放仓库内 `apps/adapter-qq`**（而非独立仓库）。依赖方向 `apps/adapter-qq <- protocol, utils`，不依赖 `agent-core`。理由是 `./init.sh` 能覆盖它、契约漂移会被 typecheck 抓到；代价是 QQ SDK 依赖进入本仓库，且落地时必须同步 `AGENTS.md` 依赖表、根 `tsconfig.json` references、`pnpm-workspace.yaml` 与根 `package.json` 脚本。
2. **入站走官方 WebSocket 网关**（intents 位订阅），不走 Webhook —— Webhook 要公网 HTTPS 回调地址（端口限 80/443/8080/8443）加 Ed25519 签名校验，对本机常驻形态是纯负担。
3. **首批只做群聊 @（`GROUP_AT_MESSAGE_CREATE`）与单聊（`C2C_MESSAGE_CREATE`）**，QQ 频道（guild）后置 —— 另一套 ID 体系与权限申请路径。

**本次为什么没改 `AGENTS.md`**：依赖表自己写明「以各包 `package.json` 中的 `workspace:*` 条目为准」，`apps/adapter-qq` 尚不存在，先加行会让表与事实不符。该同步义务已写进 feat-014 的第一条 doneCriteria。同理未动 `.env.example`：现有约定是双向 `grep` 比对示例与源码引用（唯一允许的单向差异是 `OPENROUTER_API_KEY`），现在登记 QQ 变量会凭空制造第二个差异。

**接入前已查证的两处现状缺口**（不是本次新引入的，是 QQ 会第一个踩到的）：

- `dropReasonSchema` 含 `"duplicate"`，但全仓无任何代码产生该 reason —— 即 `(channel, platformMessageId)` 去重尚未实现。QQ 按设计会重复推送相同 `msg_id`，这是首个必须补齐它的渠道。
- README 分流策略里的 `reply.maxChars` / `rateLimitPerMin`（L1 闸门）在代码中不存在（`grep` 无命中）。真实渠道上没有它等于回复侧零限流。

两条都已进入 feat-014 的 doneCriteria，不另立 feature。

平台约束速查（供实现时对照官方文档核实，勿凭此处转述下结论）：`access_token` 有效期 7200s 且不随请求刷新，需过期前续期；被动回复须带 `msg_id`，群聊 5 分钟 / 单聊 60 分钟内有效，同一 `msg_id` 靠递增 `msg_seq` 多次回复；主动消息（不带 `msg_id`）是另一个权限级别且有平台额度。

### feat-014 提交计划（2026-08-19 立）

QQ 开放平台 adapter 作为首个真实外部渠道接入。按 doneCriteria 与现状缺口拆分为以下提交单元：

1. **workspace 与项目脚手架**：新增 `apps/adapter-qq` 作为独立 package，配置 tsconfig/package.json（依赖 `protocol`、`utils`），同步根 `tsconfig.json` references、`pnpm-workspace.yaml`、根 `package.json` 的 adapter-qq 脚本、`AGENTS.md` 依赖表与 `.env.example` 的 QQ 环境变量，确保 `./init.sh` 能覆盖。标题：`chore(workspace): 新增 apps/adapter-qq 并同步依赖表`。验证：`./init.sh`，`pnpm -F @caicaiclaw/adapter-qq typecheck`。

2. **access_token 管理与自动续期**：实现 QQ access_token 获取（POST `/app/getAppAccessToken`）与 7200s 过期前的自动续期逻辑；凭据仅从环境变量读取，token 不进入日志或错误信息。标题：`feat(adapter-qq): 实现 access_token 自动续期`。验证：`./init.sh`，临时 probe 验证续期调度与错误处理（不真实请求，用 fake timer）。

3. **WebSocket 网关连接与心跳**：实现官方 WS 网关连接（wss://api.bot.qq.com/websocket/），按 intents 位订阅 `GROUP_AND_C2C_EVENT (1<<25)`，处理 OpCode 10 Hello、OpCode 2 Identify、OpCode 1 Heartbeat、OpCode 11 Heartbeat ACK、OpCode 0 Dispatch (READY)，落 `channel.connected` 事件（channel="qq"）。标题：`feat(adapter-qq): 接入 WS 网关与心跳维护`。验证：`./init.sh`，临时 probe 验证心跳调度与 READY 解析（mock WS 服务端）。

4. **断线重连与 Resume**：实现 OpCode 6 Resume 逻辑，记录 session_id 与最新 seq，断线后自动重连并补发遗漏事件，收到 RESUMED 后恢复正常；连接失败或不可恢复错误时落 `channel.disconnected` 并明确原因。标题：`feat(adapter-qq): 实现断线重连与 session resume`。验证：`./init.sh`，临时 probe 模拟断线与 resume 流程。

5. **入站事件归一化**：将 `GROUP_AT_MESSAGE_CREATE` 与 `C2C_MESSAGE_CREATE` 归一化为 `ChannelEvent`：channel="qq"，conversationId 为 `qq:group/<group_openid>` 或 `qq:c2c/<user_openid>`，kind 为 "mention" 或 "dm"，platformMessageId 取 msg_id，replyTo 取 msg_id（被动回复凭据），author.isSelf 按自身 openid 判定（从 READY event 的 user.id 获取），payload 保留平台原始结构。标题：`feat(adapter-qq): 归一化 QQ 入站事件为 ChannelEvent`。验证：`./init.sh`，临时 probe 验证两种事件的转换正确性。

6. **去重门口**：在 server 的 intake 路径实现 `(channel, platformMessageId)` 去重逻辑，重复投递落 `input.dropped` 且 reason="duplicate"（补齐现有枚举但无生产路径的缺口）。标题：`feat(server): 实现入站消息去重门口`。验证：`./init.sh`，临时 probe 验证同一 msg_id 的第二次投递被 drop。

7. **出站 MCP 工具：群聊被动回复**：adapter 注册 MCP tool `qq_send_group_message`，接受 group_openid / content / msg_id / msg_seq，调用 `POST /v2/groups/{group_openid}/messages`，超出 5 分钟窗口或平台拒绝时明确失败并记录（不静默退化为主动消息），成功时返回平台 message_id。标题：`feat(adapter-qq): 实现群聊被动回复 MCP 工具`。验证：`./init.sh`，临时 probe 验证工具注册、参数校验与超窗口错误。

8. **出站 MCP 工具：单聊被动回复**：adapter 注册 MCP tool `qq_send_c2c_message`，接受 user_openid / content / msg_id / msg_seq，调用 `POST /v2/users/{user_openid}/messages`，超出 60 分钟窗口时明确失败。标题：`feat(adapter-qq): 实现单聊被动回复 MCP 工具`。验证：`./init.sh`，临时 probe 验证工具注册与参数。

9. **L1 闸门：reply.maxChars 与 rateLimitPerMin**：在 server 输出路由侧实现 README 已定但代码尚未实现的 L1 闸门，按 channel 配置裁剪超长消息、拒绝超频请求并记录（不静默丢弃），落 `outbound.failed` 事件。标题：`feat(server): 实现 L1 出站闸门`。验证：`./init.sh`，临时 probe 验证裁剪与限流逻辑。

10. **权限分级映射**：明确 QQ 工具的权限级别（被动回复 L1，主动消息 L2，富媒体/广播 L3），并在 adapter 注册时声明；未分级工具默认 L3。标题：`feat(adapter-qq): 声明 QQ 工具权限分级`。验证：`./init.sh`，临时 probe 验证 gate 对 L1/L2/L3 工具的不同处理。

11. **集成验证与真实手动验收**：在 QQ 沙箱环境（需用户提供 AppID/AppSecret）下完成真实往返：群聊 @ 与单聊各至少一次（入站进入正确车道且回复真的抵达 QQ 客户端），重复 msg_id 被去重，超窗口回复的失败表现，L3 动作经 admin 审批后才真正投递。标题：无提交，纯验收。证据：记录到 `progress.md` 与 `feature_list.json` 的 evidence。

拆分依据：workspace 脚手架先行，token 管理与 WS 连接分离，入站与出站分别独立，去重与闸门补齐现状缺口，权限分级最后统一声明。每个提交是可独立回滚的原子单元。

### feat-014 实施进度（2026-08-19）

已完成并提交的单元（计划 3 与 4 合并：resume / 重连与连接状态机在同一个类里紧耦合，按文件或行数切开会让中间提交无法通过类型检查与运行契约；计划 7 与 8 合并，见下）：

- `36947eb` 单元 1 workspace 脚手架。同步根 `tsconfig.json` references、根 `package.json` 脚本、`AGENTS.md` 依赖表与 `.env.example`。验证：`./init.sh` 通过。
- `71e4b33` 单元 2 access_token 自动续期。验证：`./init.sh` 通过；本地假 `/app/getAppAccessToken` probe 输出 `{"reusedWithoutRefetch":true,"credentialsSent":true,"renewedAfterExpiry":true,"errorSurfaced":true,"errorLeaksSecret":false}`，覆盖缓存复用、过期续期、平台 err_code 透出与 secret 不泄露。probe 已删除。
- `98b0253` 单元 3+4 WS 网关、心跳、resume 与重连。验证：`./init.sh` 通过；本地假网关 probe 输出 identify token 格式 / intents / shard 正确、`selfId=BOT-SELF`、心跳携带递增 s、`GROUP_AT_MESSAGE_CREATE` 被转发而 READY / RESUMED 未被转发、4009 断开后发出带 `session_id` 的 Resume（`connections=2`、`resumeSent=true`）。probe 已删除。
- `85347c8` 单元 6 去重门口。验证：`./init.sh` 通过；probe 输出 `{"repeatReason":"duplicate","otherIdAccepted":true,"localBothAccepted":true,"otherChannelAccepted":true,"restartRepeatReason":"duplicate","restartFreshAccepted":true}`，覆盖同键拒收、不同键与不同 channel 放行、无 platformMessageId 不参与去重、回放预热后重启仍识别重复。probe 已删除。
- `86b5ff7` 单元 5 入站归一化。验证：`./init.sh` 通过；probe 用官方文档事件示例，输出两种事件的 conversationId / kind / platformMessageId / replyTo / author openid 与 role / 两条 isSelf 路径 / RFC3339 解析与回落 / 未知字段放行 / 非法输入结构化拒收，且归一化结果通过 `channelEventSchema`。probe 已删除。
- `b09b38b` 消息发送 HTTP 客户端。验证：`./init.sh` 通过；probe 覆盖群聊 / 单聊路径拼接、被动与主动 body 差异、失败分类与 secret 脱敏。probe 已删除。
- `e7e4a2e` 被动回复窗口与 msg_seq 追踪。验证：`./init.sh` 通过；probe（注入时钟）覆盖窗口过期、条数上限、msg_seq 递增、重复 register 不重置已用配额、release 只接受最新 seq。probe 已删除。
- `efcf901` 单元 9 L1 出站闸门。验证：`./init.sh` 通过；probe 覆盖超长裁剪（带 truncatedFrom）与超频拒绝落 `outbound.failed`，闸门按整轮 AI 文本评估而非逐个 delta。probe 已删除。
- `914bcfe` 单元 7+8+10 出站 MCP 工具面（计划 7、8 合并：群聊与单聊只是 scope 不同，同一个工具带 scope 参数比两个近乎重复的工具更不容易漂移）。验证：`./init.sh` 通过；真实 MCP client 经 `InMemoryTransport` probe 输出超窗口回复不产生平台调用且不回退主动消息、L3 富媒体明确 not_implemented 不降级为文本。probe 已删除。
- `3fb0953` 入站 WS 面与重投策略。验证：`./init.sh` 通过；probe 输出 `buffer_full` 重试一次后被接受，而 `duplicate` / `self_echo` 只记录不重投。probe 已删除。
- `ac381dc` channel 生命周期事件契约。验证：`./init.sh` 通过；probe 输出 `{"afterConnect":{"connected":true,"selfId":"BOT-SELF"},"afterDisconnect":{"connected":false,"lastResumable":true},"selfIdSurvivedDisconnect":true,"missingResumedRejected":true}`。probe 已删除。
- `ab1b676` adapter 进程组装（双面入口）。验证：`./init.sh` 通过；probe 拉起真实 adapter 子进程对接假 QQ HTTP / 假网关 / 假 server，输出 `intentsIsGroupAndC2c=true`、role 先于任何 input 声明、群 @ 与单聊都归一化投递、不支持的事件类型只记日志、四个 MCP 工具经 stdout 正常 tools/list、`stdoutOnlyJsonRpc=true`、`secretLeaked=false`、SIGTERM 优雅退出。probe 已删除。
- `16923f3` MCP 工具权限分级真正生效。验证：`./init.sh` 通过；两个 probe 分别输出 `McpToolHost` 把四个工具的 L0/L1/L2/L3 全部解析进 `permissionsByName`，以及 runtime 判定 `{"configuredOverridesAdapter":"L2","adapterDeclared":"L0","ungradedDefaultsL3":"L3","historyStillL0":"L0","staleDeclarationCleared":"L3"}`。probe 已删除。
- `3570e96` + `12803e1` 被动回复经输出路由真正抵达平台。验证：`./init.sh` 通过；端到端 probe（真实 adapter 子进程 + 假平台）输出首次回复真的打到 `/v2/groups/G1/messages` 且带 `msg_id` 与 `msg_seq=1`、同一 msg_id 二次回复 `msg_seq=2`、未登记 msg_id 与缺少 replyTo 都只记失败日志且平台调用数不增加（`noActiveFallback=true`）、`secretLeaked=false`。probe 已删除。

实施中发现并处理的偏差（均已在上述提交内）：

1. **去重需要跨重启**：`IntakeController` 是进程内状态，仅在内存去重会让重启后的第一条平台重复投递被放行。已在回放状态里新增 `seenPlatformMessages`，回放 `input.accepted` / `input.dropped` 时重建，并在 runtime 启动时预热 intake。去重键由 `platformDedupeKey` 单点生成，回放侧与门口侧共用。
2. **adapter-qq 需要 zod**：归一化要在协议边界做结构化校验（AGENTS.md 要求）。zod 是仓库既有依赖、`protocol` 与 `utils` 已用同一版本 `^4.4.3`，故只在 `apps/adapter-qq/package.json` 登记，未引入新依赖。
3. **`author.id` 不是必填**：按官方 autogen 事件文档，群聊身份在 `member_openid`、单聊在 `user_openid`，`id` 并非必然下发。此前 normalize 要求 `author.id` 必填，会让真实群 @ 与单聊事件全部被判为非法负载（probe 实测三条事件全被拒）。已改为三者皆可选、按场景取到 openid 后再校验非空。
4. **权限分级此前没有生效路径**：`apps/server` 从不填充 runtime 的 `toolPermissions`，`permissionForTool` 对所有 MCP 工具一律返回默认 L3。已改为 adapter 在 `tools/list` 时用 `_meta` 的 `com.caicaiclaw/permission` 自报级别，`McpToolHost` 校验后随 snapshot 输出，server 交给 `replaceDeepTools`。优先级为 history 工具固定 L0 → 运维显式配置 → MCP 自报 → 默认 L3，运维配置压过自报以防 adapter 用元数据自行提权。
5. **闸门后的回复没有出口**：L1 闸门只落 `outbound.delivered`，成品文本无处可去，且闸门在流式结束后才评估——adapter 若自行拼接 `assistant_delta` 会发出未裁剪原文。已新增 `outbound_reply` 服务端消息承载闸门后的成品文本，由 adapter 消费并带 `msg_id` / `msg_seq` 投递。同时修正 `applyReplyGate` 的早退：渠道未配置 `maxChars` / `rateLimitPerMin` 时原本直接 return，等于未配策略的渠道永远收不到回复；未配置只应表示不裁剪不限流。
6. **stdout 被 MCP 协议占用**：adapter 用 `StdioServerTransport`，任何写 stdout 的日志都会破坏协议帧。`token-manager` 原本用 `console.log`，已统一改为 `console.error`；probe 断言 stdout 只出现 JSON-RPC 帧。

**残留阻塞（feat-014 唯一未满足的 doneCriteria）**：最后一条要求 QQ 沙箱真实手动验收——群聊 @ 与单聊各至少一次真实往返（入站进入正确车道且回复真的抵达 QQ 客户端）、重复 `msg_id` 被去重、超窗口回复的失败表现、L3 动作经 admin 审批后才真正投递。这需要用户提供 QQ 机器人 AppID / AppSecret 与沙箱环境，并在开放平台配置好群聊 @ 与单聊权限。所有代码路径目前只经过假网关 / 假平台 / 注入时钟验证；平台错误码到失败分类的映射（`QQ_ERROR_CODE_CATEGORIES`）也刻意留空，需真实沙箱调用校准。

**下一步**：拿到沙箱凭据后执行 feat-014 单元 11 验收并把 feat-014 置为 done。（原写的「在此之前不要开工 feat-015」已作废：feat-015 依赖 feat-013 而非 feat-014，feat-014 属外部依赖阻塞而非未完成，故 feat-015 已推进并完成。）

### feat-013 提交计划

1. **MCP SDK 依赖**：将 `@modelcontextprotocol/sdk` 仅加入 `apps/server`，更新 lockfile，不改 agent-core 依赖方向。标题：`chore(server): 添加 MCP client SDK`。验证：`./init.sh`。
2. **MCP host 与动态工具注册**：server host 管理 adapter 的 MCP client、连接/断开、工具发现和将调用包装成 runtime 可加载工具；断开后明确解绑，图重建保留 runtime state。标题：`feat(server): 接入 MCP adapter 工具 host`。验证：`./init.sh` 与假 MCP adapter connect/disconnect probe。已完成提交 `0366a5f`、`8024e4d`：新增 `McpToolHost`、命名空间工具包装、server connect/disconnect API、runtime deep tool 图重建，并保留/校验 MCP `inputSchema`；`./init.sh` 通过。真实 SDK `Server` + 成对 Transport probe 输出 `{\"discovered\":true,\"validCall\":true,\"invalidRejected\":true,\"calls\":1,\"disconnected\":true}`，验证旧 tool 断开后失败且非法 args 未触发 adapter call；临时 probe 已删除。
3. **审批事件回放契约**：在 utils history schema 与 agent-core projection 中追加 approval requested/decided/expired，确保重启后可重建 pending。标题：`feat(agent-core): 增加审批事件回放契约`。验证：`./init.sh`。已完成提交 `3f20e91`。
4. **权限 gate 与审批执行**：在 deep agent 工具调用前接入默认 L3 gate；L3 立即写 pending，并由 runtime 用日志参数一次性执行 approve。标题：`feat(agent-core): 接入 L3 审批 gate 与执行`。验证：`./init.sh`。已完成提交 `50d4079`；`852d72d` 补齐 L0-L3 可配置 gate、heartbeat TTL 与 outbound result 事件，`e017e91` 将决定/到期注入后续 deep context。
5. **出站审计与受信决策路由**：追加 outbound history 契约，补 runtime TTL/结果落盘，并扩展 protocol/server 的 admin-only approval_decision 路由。标题：`feat(agent-core): 审计审批出站结果`、`feat(protocol): 定义审批决策与出站审计契约`、`feat(server): 接入受信审批决策路由`。验证：`./init.sh` 与假 MCP adapter 的权限/approve/replay/TTL/越权 probe。已完成提交 `8809b6f`：协议升级到 v6，审批决定要求 WS token 与 CAICAI_ADMIN_TOKEN；adapter 和仅持 WS token 的观察者均被拒绝。

SDK 影响说明：MCP client host 需要其 transport、capability negotiation 与 tools/list/call 协议实现；替代方案是自行维护 JSON-RPC/MCP 子集，开发成本高、兼容风险也更大，故采用官方 SDK。依赖只位于 server，不进入共享 runtime。

### feat-013 完成证据

- `649ba6e` / `0366a5f` / `8024e4d` / `28aeb5a`：MCP SDK 仅存在于 `apps/server`；真实 SDK 成对 transport probe 输出 `{"discovered":true,"validCall":true,"invalidRejected":true,"calls":1,"disconnected":true}`，覆盖发现、参数校验、调用与断开解绑。`rg` 确认 `packages/agent-core` 无 MCP SDK import。
- `3f20e91` / `50d4079` / `852d72d` / `e017e91`：JSONL approval projection、默认 L3 gate、日志原参数的一次性 approve、outbound 成败审计、TTL 到期及后续 deep context 通知。临时 fake runtime probe 输出 approval executed / failed、`calls:2`、`duplicateRejected:true`、`expired:1`，并验证 replay pending；TTL context probe 输出 `{"expiredVisible":true,"pendingAfterExpiry":0}`。两份 probe 均已删除。
- `8809b6f`：`approval_decision` 经协议 v6 的 admin 角色路由；真实短生命周期 WS probe 输出 `{"adapterRejected":true,"sharedTokenRejected":true,"adminReachedRuntime":true}`，验证 adapter 与仅持 WS token 的连接无法批准，双 token admin 才抵达 runtime；临时 probe 已删除。
- `./init.sh` 通过（typecheck、lint、format）；worktree 仅留本次 feature 状态记录。

### feat-012 提交计划

1. **历史查询契约与只读工具**：定义结构化筛选、分页与明确越界错误；在 agent-core 以限定 history projection/JSONL 事件读取实现，禁止任意路径读取。标题：`feat(agent-core): 增加受限历史查询工具`。验证：`./init.sh` 与临时筛选/分页 probe。
2. **Digest 事件与回放投影**：扩展共享 history schema 与 projection，记录 `conversation.digested`，按 conversation 管理未摘要活动。标题：`feat(utils): 增加 conversation digest 事件契约`。验证：`./init.sh`、回放 probe。
3. **Heartbeat digest 与深上下文**：background model 为活动 conversation 生成有界 digest，深 lane 注入跨渠道社交近况且不写 Memory.md；快车道不进 checkpoint。标题：`feat(agent-core): 注入社交近况并调度 digest`。验证：`./init.sh` 与 fake-model heartbeat/deep-context probe。

拆分依据：受限查询工具独立于 digest；事件 schema 先于调度行为；最终行为单元在契约稳定后接入。

### feat-012 完成证据

- `2659a78`：history_query 结构化过滤、分页与限定 JSONL 读取。
- `cd1e094`：`conversation.digested` schema、projection 与严格回放。
- `21eee0f`：background heartbeat digest、每 conversation 活动 sequence 校验、锁外模型生成/锁内 cutoff recheck、deep-only 社交近况注入与 digestSummaryBudget。
- `./init.sh` 通过；package-scope fake-model probe 输出 `{"digests":3,"deepCalls":6,"fastCalls":0}`，验证两 conversation 摘要、后续活动再次摘要、Memory.md 不变与 deep context 注入；临时 probe 已删除。`fastCalls:0` 来自默认 deep intake policy，未伪造 fast lane 调用证据。

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

1. M3 按依赖顺序推进：feat-008 ✅ → 009 ✅ → 010 ✅ → 011 ✅ → 012 ✅ → 013 ✅ → **014 / 015 可并行（均依赖 013），下一个二选一**。一次只推进一个。feat-014 已选定 QQ 开放平台，开工前需用户提供 AppID / AppSecret 与沙箱环境，且第一步应是核对官方文档而非采信本文件的转述。
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
- [ ] **两处「设计已定但代码为空」的机制，首个真实渠道会立刻踩到**：① `dropReasonSchema` 里的 `"duplicate"` 无任何生产路径，`(channel, platformMessageId)` 去重未实现；② README 分流策略里的 `reply.maxChars` / `rateLimitPerMin`（L1 闸门）在代码中不存在。本地 `local` 渠道不会暴露它们（不重复投递、无平台限流），QQ 两条都会踩到。已纳入 feat-014 的 doneCriteria，此处保留以免被误读为「已实现」。
- [ ] **agent WS（默认 8787）无认证**：admin 面板本身有 token，但 agent 的 WebSocket 端口没有 —— 任何能访问本机该端口的页面或进程都可以向 agent 发送输入，而 agent 持有 `exec` 工具。当前依赖「只监听 127.0.0.1」作为唯一边界。本次未扩大范围处理，改动 agent 传输层前应先决定是否引入握手认证。

## Decisions Made

- **Harness 回到单 lane 模式**：多 worktree lane 变式（`.harness/<slug>/state.json` 分片 + `harness/lanes.sh` 校验 + `harness/wt.sh` 生成器）在实际使用中不好用，已移除。状态回归根级 `feature_list.json` + `progress.md`。
  - Context: 分片状态与集成视图必然 drift，且自定义 schema 校验的维护成本高于收益。
  - Alternatives considered: 保留 lane 脚本但简化字段表；结论是并行开发的实际需求不足以支撑这套机制。
- **传输层归属 client-core**：transport 提升到 `packages/client-core`，Web 与 TUI 共用，不在各端重复重连与解析逻辑。
- **TUI 换行只做 Shift+Enter**，需 kitty 键盘协议；`ws_url` 仅进程内生效，不落盘。
  - 2026-08-17 更新：该决策在用户当时的终端（Windows Terminal + tmux 3.4）上不成立，Shift+Enter 无法与 Enter 区分。**用户决策：换用支持 kitty 协议的终端（WezTerm / kitty / Ghostty），代码保持不动。** 被否决的备选是把 Ctrl+J 提升为一等换行键并写进 `Composer` 提示文案 —— 那会让换行在所有终端可用，但引入第二个换行键位和额外的文案维护面。因此本决策原样保留：**换行依赖 kitty 键盘协议是一个明确的、已知的终端要求，不是缺陷**。
- **首个真实外部渠道选定 QQ 开放平台（api-v2）**，取代原定的「个人博客或 bilibili 开放平台」。adapter 落在仓库内 `apps/adapter-qq`、入站走官方 WebSocket 网关、首批只做群聊 @ 与单聊。
  - Context: 用户于 2026-08-19 指定平台并逐项确认了这三个选择。QQ 同时压到鉴权时效、重复投递、被动回复窗口三条约束，适合用来证伪「入站 WS 面 + 出站 MCP 面」这套契约。
  - Alternatives considered: adapter 独立仓库（否决 —— 契约漂移逃出 `./init.sh` 覆盖）；Webhook 入站（否决 —— 需公网 HTTPS 回调与 Ed25519 校验，本机常驻形态得不偿失）；首批带上 QQ 频道（后置 —— 另一套 ID 体系与权限申请路径，会撑大首个渠道的接入面）。
- **仓库不设 `test` 命令**：测试覆盖率不是完成门槛，行为变更靠与风险相称的手动验收，证据记录在本文件。

## Evidence of Completion

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Static verification | `./init.sh` | pass | 2026-08-17：`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过。 |
| Diff hygiene | `git diff --check` | pass | 无空白错误。 |
| Harness structure | `node validate-harness.mjs --target .` | 100/100 | 单 lane 迁移后五个子系统全部 5/5（迁移前 76/100，bottleneck: state）。2026-08-19 复跑仍为 100/100 —— 但该检查只看结构，`session-handoff.md` 当时正文已陈旧仍得满分，勿把它当内容正确性证据。 |
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

- **`session-handoff.md` 现在有读取路径了（2026-08-19）**：此前它只有写入路径——`AGENTS.md` 的 Required Artifacts 和 End of Session 让你写它，但 Startup Workflow 从不让你读它，`init.sh` 的 Next steps 也没列。结果就是它在 `cde5cac` 被删、`e945606` 重写时丢了头部使用规则和 `Status` 哨兵，之后长期陈旧而无人发现（还积压了一个与 `feature_list.json` 重复的 feat-010 附录）。现已补齐：`AGENTS.md` Startup Workflow 新增第 4 步按 `Status` 条件读取，Required Artifacts 写明「活动交接时其 Recommended Next Step 覆盖本文件 What's Next」，End of Session 增加收尾后重置为「无活动交接」的义务，`init.sh` Next steps 同步。**启动路径的唯一权威是 `AGENTS.md`**，`session-handoff.md` 的 Next Session Startup 已改为指向它，不要再在两处各写一份步骤。
- **`validate-harness.mjs` 的 100/100 不能当内容正确性证据**：上述陈旧期间它一直是满分（含「Session handoff template exists」「Session restart markers exist」）。它只检查结构存在性，不读正文是否与事实相符。

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
