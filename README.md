# CaiCaiClaw

使用 TS + Langchain 构建的 agent, 主要用于学习 agent 范式以及满足自己的一些小灵感， 并计划接入我的个人博客，bilibili 开发者平台, etc... 实现 agent 自行探索，自行发布内容，和长期的记忆。

这个仓库将记录本菜菜实现的完整过程 ~~（如果能坚持下去的话）~~

---

> 标注约定：**[已完成]** 当前阶段目标已落地 / **[已定]** 已确定 / **[进行中]** 已有部分实现 / **[暂定]** 倾向性方案，可能调整 / **[待定]** 尚未决策。

# 目标

## 愿景

打造一个 **「仿人、长期运行」的自主 agent**（对标 Pi / openclaw 的形态）：不是完成单个任务就结束的一次性工具，而是持续存活、有自己的目标与记忆、无人指令时能自主找事情做（探索、创作、发布），有人时也能正常交流。

核心特征：常驻运行 + 自主性 + 仿人（人格、状态、不定时触发）+ 作为服务对外暴露统一接口。

## 能力北极星

远期方向，**无序、不承诺时间**，用来指引而非排期：

- 自主创作与发布内容 · 自主开发 · 长期记忆 · 可自我修改的行为 · 可接入外部渠道
- 配套 **Web 管理端**：观察 / 干预 agent 的状态、目标、记忆与产出

## 当前范围

**chat → 自主创作与发布。** 其余能力全部后置，不在早期里程碑内。

## 核心不变式（贯穿所有里程碑的地基）

> **状态 ↔ 行为 严格分离，永不耦合。**
>
> - **情景 / 运行状态**（消息、做过什么、上下文 checkpoint）存进 append-only **事件日志**，重启可恢复。
> - **语义 / 工作记忆**（人格、事实、任务）以可读写的 **Markdown 文件**为唯一真相；事件日志可以审计其变更，但不负责重建文件内容。
> - **行为**（tools、prompts、上下文构建方式）来自**可加载的文件 / config**。
>
> 每类信息只能有一个真相源：compaction summary 是从事件历史派生的上下文 checkpoint，不是另一份长期记忆；拼装后的 SystemMessage 是运行时投影，不回写为状态。守住这一条，后续里程碑都是**加法**：实时多车道（M3）靠它并存，Pi 式 `reload`（M4）靠它成立。

# 路线图

| 里程碑 | 主题 | 状态 |
| --- | --- | --- |
| M0 | 已有基础：ReAct + 工具注册 + 单 runtime + WS + 事件队列/心跳骨架 | [已完成] 当前基线 |
| M1 | 最小可运行版本（MVP）：单心智 + tui/web 双端 + 极简上下文管理 | [已完成] |
| M2 | 上下文精进（compaction）+ Web 后台管理 | [已定] 记忆与 compaction 模式已确定，待实现 |
| M3 | 实时响应与外部渠道接入 | [已定] 设计已确定，待实现 |
| M4 | Pi 式运行时自我修改（`reload`） | [待定] |

---

## M0 · 已有基础

对照代码的现状，作为 M1 的起点。

- **`packages/utils`** —— 无工作区依赖的共享基础层：纯函数工具 + 跨包共享的结构化契约（`./history` subpath 提供事件日志 schema）。不做 IO，不依赖框架或 SDK（langchain / ws / react）。
- **`packages/protocol`** —— `src/index.ts` 提供 Zod 校验的协议与序列化。
- **`packages/agent-core`**
  - `src/agent.ts` —— LangGraph `StateGraph` 的 ReAct 循环（`llm` ↔ `toolNode`）；纯聊天回复即**单次模型调用后 `END`**，不强制多跳。
  - `src/runtime/` —— `AgentRuntime` 目录模块：主 runtime 编排（`agentRuntime.ts`）、事件队列与等待唤醒（`eventQueue.ts`）、LangGraph stream 消费（`agentStream.ts`）、message content 提取（`messageContent.ts`）、公共类型（`types.ts`）。
  - `src/modelProvider.ts` —— 模型接入层。系统 prompt 从上层指定的 Markdown 路径加载。 `src/tools/` —— `exec` / `fileRead` / `fileEdit` / `fileWrite` + 注册入口（`toolsByName`）。
- **`packages/client-core`** —— 与框架无关的客户端状态归约。
- **`apps/server`** —— `src/server.ts` 提供单 agent 的 `WebSocketServer`。
- **`apps/admin`** —— Next.js Web 管理端与 agent supervisor。
- **关键性质**：`this.agent`（编译出的图）、`rawHistoryState`（可回放的完整历史）与 `executionState`（单轮上下文）已分离——这正是核心不变式的雏形，M4 的 `reload` 因此几乎是加法。

## M1 · 最小可运行版本（MVP）

**目标**：一个能长期运行的单 agent，配 tui + 极简 web 两个前端，**共享同一个 runtime 实例**（经 WS）。先 make it run。

> 当前进度：shared runtime、WS 广播链路、Web observer、client-side activity/message 状态收敛、`buildContext` 抽离、prompt Markdown 文件化、JSONL 事件日志回放恢复已落地；TUI 端仍未完成。

**关键决策**

- **[已定] 一个心智，多个观察**：所有 client（tui / web）不是各自的会话，而是同一个心智的「视窗 + 输入口」（当前 `server.ts` 的单 runtime + 广播已符合）。
- **[已定] MVP 不做语义记忆**：先跑起来。

**第一刀（先打地基，务实优先）**

1. **抽出上下文构建函数** `buildContext(state) -> messages[]`：从完整 raw history 按完整 turn 选择约最近 30 条消息，再拼 system 与当前输入；execution state 只服务于当前 LangGraph 调用。
2. **人格 / prompt 文件化**：以 Markdown 存储、运行时读取，**不 inline** 进代码（人格本质是角色扮演）。
3. **事件日志落 jsonl**：使用 version 1 的 append-only 领域事件记录 input、turn、tool 审计和完整输出消息，启动时严格校验并回放恢复；未完成轮次标记 interrupted，不自动重试。这是「长期运行 agent」与「聊天 demo」的分界线，也是 M2 后台、M4 `reload` 的共同依赖。

**明确不做**：`reload`、语义记忆 / 检索、多子图、概率唤醒、后台管理 UI。tools 保持现有静态 `toolsByName`（已集中，日后改扫目录是局部改动）。

### M1-3 · 事件记录与恢复

`AgentRuntime` 构造时必须由调用方传入准确的 `rawHistoryPath`。runtime 不推导路径、不读取环境变量，也不设置路径默认值；server 等上层负责这些配置语义。指定文件不存在时 runtime 只在该路径初始化空 JSONL，并可创建父目录。

runtime 内部状态分为两层：

- `rawHistoryState` 是 JSONL 回放得到的完整 projection，包含按 turn 分组的 committed messages、未完成 / interrupted inputs、active / failed / interrupted turn 状态、tool 审计和最后应用的 sequence。
- `executionState` 是单轮 LangGraph 调用状态。每轮由 committed turns 按完整 turn 选取约 30 条消息，再拼接 System Prompt 和当前输入；窗口不会截断一个 turn，最新完整 turn 即使超出预算也保留。其类型为 `ExecutionState`。

JSONL 每行是 version 1 event envelope：`input.accepted`、`turn.started`、`tool.started`、`tool.completed`、`turn.output_committed`、`turn.failed`。消息 payload 使用 LangChain `StoredMessage`，只持久化完整 Human / AI / Tool 消息和工具审计；System Prompt、循环警告、`llmCalls`、stream delta、reasoning 不写入历史。

启动回放会校验 JSON、事件 schema、版本、连续 sequence、eventId、消息反序列化和状态转换，并在错误中报告行号。空文件和空行允许；损坏的非空行会阻止启动。回放结束仍未 terminal 的 turn / input 只标记为 interrupted，不进入上下文且不自动重试。所有追加通过同一 Promise chain 串行化；写入失败时不更新 projection，runtime 进入 fatal 状态并拒绝后续输入。

手动验收重点：首次启动创建指定 history 文件；重启后延续对话；超过 30 条消息仍保留完整旧日志；工具调用 turn 重启后结构完整；快速输入能按 drain 批次共享 turn；ACK 只在 `input.accepted` 成功追加后返回；中止进程后的未完成 turn 不会自动重试；任意非空损坏行会报告行号并阻止启动；更换 `rawHistoryPath` 后 runtime 严格使用新路径。

## M2 · 上下文精进 + Web 后台管理

**目标**：上下文管理从滑动窗口进化到**滚动摘要（compaction）**；Web 后台可查看 agent 的记忆、行为日志与当前状态。

### 记忆分层

M2 明确区分三类内容，避免把有损摘要当作长期记忆：

- **情景记忆**：完整经历、输入输出和工具审计，继续以 `history.jsonl` 为唯一真相源；Web 后台按需从日志读取，不要求 runtime 常驻完整历史。
- **语义 / 工作记忆**：以 `.caicaiclaw` 下的 Markdown 为唯一真相源。`SYSTEM.md` 保存 operator 控制的基础行为，`Role.md` 保存 agent 可自我维护的人格，`Memory.md` 保存稳定事实与长期经验，`tasks/` 保存任务状态。
- **上下文 checkpoint**：由历史派生的滚动摘要和少量近期原始 turns，以 `context.compacted` 事件持久化。它只服务于模型上下文恢复，可以再次生成，不替代原始历史或 Markdown 记忆。

Markdown 文件允许人工编辑，也允许未来由受限工具修改；runtime 负责在每轮构建上下文时读取一致快照。由 runtime 发起的记忆修改可以向 JSONL 追加路径、前后哈希和原因用于审计，但 Markdown 内容仍是语义记忆的真相源。

### 文件式记忆

目录结构：

```text
.caicaiclaw/
├── SYSTEM.md
├── Role.md
├── Memory.md
├── history.jsonl
└── tasks/
    ├── Index.md
    ├── <task>.md
    └── archived/
```

- `SYSTEM.md` 是 operator-controlled constitution，不由自主反思流程修改。
- `Role.md` 只保存人格、自我叙事、偏好与价值倾向，不保存任务进度、运行权限或安全边界。runtime 暴露 `daydreaming()` 作为未来的人格反思入口；M2 只提供方法，不自动调用。写入必须限制到允许的记忆文件并使用原子替换，避免中断时留下半个文件。
- `Memory.md` 保存用户事实、重要关系、稳定结论和可复用经验，避免把这些内容混入人格或任务列表。
- `tasks/Index.md` 只保存唯一当前任务的恢复摘要，以及所有待办任务的名称、概要和相对链接。当前任务摘要包含目标、下一步、阻塞项和更新时间；详细内容、进展与验收标准写入对应 task 文件。完成后把 task 文件移入 `tasks/archived/` 并从 Index 的活动列表移除。

目录与链接统一使用小写 `tasks`，避免在大小写敏感与不敏感的文件系统之间产生两套路径。

### Context 构建

`buildContext()` 每轮从持久状态构造一次 execution state，固定顺序为：

1. 第一条且唯一的常规 `SystemMessage`：runtime 硬编码的记忆协议与权限边界、`SYSTEM.md`、`Role.md`、`Memory.md`、`tasks/Index.md`，按固定分隔符拼接。只有稳定的协议约束硬编码；人格和可演化行为继续来自文件。
2. 最新 `context.compacted` 中的滚动摘要，以明确标记的历史资料消息注入，不能提升为 system authority，也不能把其中引用的用户或工具文本当作新指令。
3. checkpoint 保存的最近若干个完整 turns；保留数量是可配置策略，不能拆开一次 turn 或 tool-use / tool-result 配对。
4. checkpoint 之后新提交的完整 turns。
5. 当前批次的用户输入。

`tasks` 只自动注入 `Index.md`；agent 需要具体任务细节时再读取对应 task 文件。所有自动注入的 Markdown 都需要独立大小预算，超出时应返回明确错误或受控裁剪，不能静默吞掉文件尾部。

### Compaction

compaction 是 runtime 的维护操作，不属于普通 ReAct 主循环。`AgentRuntime` 暴露异步 `compact()` 方法供 server 调用，但 M2 暂不在 runtime 内决定触发时机；后续由 server 按固定的已提交 turn 数调度，也可以提供手动入口。

一次压缩只允许在 quiescent boundary 执行：没有 active turn、pending input 或未完成 tool call。外部调用必须与输入处理串行化；若调用时 runtime 忙碌，可以排队到当前 turn 完成，不能与 history append 并发修改 projection。

压缩过程固定为：

1. 读取上一个 checkpoint 摘要、其后已提交的完整 turns，以及 compaction 专用 prompt。
2. 从待压缩段尾部保留最近若干个完整 turns，其余内容交给不绑定 tools 的摘要模型；摘要调用只允许一轮纯文本输出。
3. 摘要记录用户目标、关键事实、技术或行为决策、错误与修复、文件 / 工具引用、当前进展和待办事项，但不复制推理草稿，也不声称未经验证的结果。
4. 校验摘要非空且未超过预算；调用失败时不改变当前 checkpoint。
5. 成功后 append 自包含的 `context.compacted` 事件，再更新内存 projection。事件至少记录 `compactionId`、覆盖到的 sequence、summary、preserved turns、prompt version、model 和 `manual | scheduled` trigger。
6. 下一次 compaction 只合并旧摘要和 checkpoint 后的新 turns，不重新摘要完整 JSONL。

checkpoint 是追加事件，不重写、不截断旧日志。启动恢复时，active context projection 从最新 checkpoint 开始，只保留 checkpoint 及其后的历史；完整日志继续留在磁盘供后台、审计和精确查询。初始实现可以流式扫描日志定位最新 checkpoint，扫描时不累计更早的消息；若启动 I/O 后续成为瓶颈，再增加可重建的 byte-offset sidecar index，而不是改变 JSONL 的真相源地位。

### 长 Tool Result

长工具结果必须先完整写入 `tool.completed`，再把模型可见的 `ToolMessage` 投影为状态、长度、头尾预览和稳定引用：

```text
history://turn/<turnId>/tool/<toolCallId>
```

配套只读工具按 `turnId + toolCallId` 查询原始结果，并支持 offset / limit 分页；引用不能使用 JSONL 行号，因为行号是存储实现细节。该投影既用于后续 `buildContext()`，也用于同一 ReAct turn 内工具执行后的下一次模型调用，否则只处理 buildContext 无法避免单轮长结果撑爆上下文。

`tool.completed.result` 是工具原始结果的唯一载体；`turn.output_committed` 中的 ToolMessage 只保存投影，避免把同一份长结果在 JSONL 中重复持久化。读取工具必须返回清晰的缺失、损坏和越界错误，不得把任意文件读取能力伪装成 history 查询。

### Web 后台边界

后台可以自由读取和编辑 `.caicaiclaw` 管理的 Markdown 文件，包括 `SYSTEM.md`、`Role.md`、`Memory.md` 和 `tasks/`；保存后由后续 `buildContext()` 读取新内容。JSONL 及其 history / checkpoint projection 对后台严格只读，历史详情、长工具结果和旧 turns 通过分页查询从磁盘加载，后台不得直接改写、截断或补写事件日志。后台同时提供显式 `compact()` 与 `daydreaming()` 操作，它们必须调用 runtime 公开方法并遵守各自的串行化、空闲边界和文件写入约束，不能通过直接修改持久化文件模拟执行。runtime 不为后台常驻完整历史。

**明确不做**：向量检索（除非文件式记忆证明不足）；自动触发 `daydreaming()`；按 token 阈值或 413 自动 compact；重写 / 截断原始 JSONL；message 引用 GC、摘要分支与多级 checkpoint 等优化项后置。

## M3 · 实时响应与外部渠道接入

**目标**：以统一模式接入外部渠道（bilibili、QQ、个人博客等），并支撑实时交互场景。

**核心判断**：实时响应**不是靠把主循环改快**，而是靠**快模型 + 独立车道**。纯聊天当前已是「单次调用 + 流式」，贴着模型延迟下限；真正的瓶颈是**队头阻塞** —— 单串行循环让新输入堵在长任务后面。因此并发单元是**车道（lane）**，渠道（channel）只是事件来源。

### 拓扑

一个渠道 = 一个 adapter 进程，两张脸，共用同一条平台连接与凭据：

```text
bilibili 直播 ─┐   QQ ─┐   博客 ─┐
               ▼       ▼         ▼
      adapter-*（每渠道一进程，语言自由）
        · 持有平台 SDK / 长连接 / 凭据
        · 出站面：MCP server ──┐
        · 入站面：WS client ───┼──┐
      ┌─────────────────────────▼──▼──────────┐
      │ apps/server                            │
      │  · WS：鉴权 / 校验 / 归一化 / 去重      │
      │  · MCP client host → 包成 tool 注入     │
      │  · 出站路由：observer vs adapter        │
      └────────────────┬───────────────────────┘
      ┌────────────────▼───────────────────────┐
      │ AgentRuntime                           │
      │  intake（按 conversation 分桶 + 策略）  │
      │   ├─ fast lane（Role.md + 快模型）      │
      │   └─ deep lane（现有 ReAct）            │
      │  共享 history.jsonl + .caicaiclaw       │
      └────────────────────────────────────────┘
```

**[已定] adapter 与 MCP server 是同一进程的两张脸。** 平台连接和凭据只有一份，拆成两个进程就要在进程间再同步一次会话状态。MCP 是 adapter 的**实现方式**，不是核心的抽象边界 —— 否则核心会被 MCP 的能力上限反向绑定。`agent-core` 既不 import 渠道 SDK，也不 import MCP SDK；MCP client host 住在 `apps/server`，把发现到的工具包成 `DynamicStructuredTool` 注入 runtime。

**[已定] 入站与出站是两种不同的抽象。** 出站能力（发弹幕、发博客、点赞）是 request/response，适合 MCP。入站事件流有速率、优先级和取舍策略，MCP 的 `notifications/*` 没有背压也没有投递保证，不承担这个角色 —— 入站走独立的 WS 通道。

### 数据形状

入站统一为 `ChannelEvent`，取代原先的 `InboundEvent`（`text` + `source: string`）：

```ts
export type ChannelEvent = {
    channel: string; // "bilibili-live" | "qq" | "local"
    conversationId: string; // "bilibili-live:room/12345"
    platformMessageId?: string;
    kind: string; // "chat" | "dm" | "mention" | "superchat" | "gift"
    text: string;
    author: { id: string; displayName?: string; isSelf: boolean; role?: string };
    payload?: JsonObject; // 平台原始结构：只进日志，不进 prompt
    occurredAt: number;
    receivedAt: number;
    laneHint?: "fast" | "deep"; // 建议，非权威
    replyTo?: string;
    debugOrigin?: "admin";
};
```

去重键为 `(channel, platformMessageId)`。原先把结构塞进字符串的 `[source] text` 前缀做法退场。

出站在 `RuntimeOutputEvent` 上增加 `lane` 与 `target?: { channel; conversationId; replyTo? }`。路由规则一句话：**observer（tui / admin）收全部，adapter 只收 target 匹配自己的。**

**[已定] 回复来源渠道是输出路由，不是 tool。** 走 tool call 要付「多一轮往返 + 模型得先决定调用 + 无法流式」三项代价。快车道流出的文本自动带来源 target 投递回去，零 tool call、可流式，模型也不需要「知道有 MCP」。MCP tool 只负责别的事：发到另一个房间、私信、发视频、发博客、关注点赞。

**[已定] 回声抑制以 `author.isSelf` 为唯一依据**，adapter 侧按自己的 userid 过滤。当前设计下 agent 的回复走输出路由而非 adapter 入站面，本来就不成环。

### 车道与分流策略

策略是可加载配置，由 runtime 执行；**ws server 只做鉴权、校验、归一化、路由，不做分流决策**（传输层不承载核心业务决策）。adapter 给出的 `laneHint` 只是输入而非权威，否则一个 adapter 就能把自己全部提权到快车道。

```jsonc
{
    "channels": {
        "bilibili-live": {
            "lane": { "chat": "fast", "superchat": "fast", "gift": "fast", "join": "drop" },
            "intake": {
                "mode": "lossy",
                "generalSlots": 32,
                "reservedSlots": 8,
                "mergeWindowMs": 800,
                "alwaysKeep": ["mention", "superchat"],
            },
            "reply": { "maxChars": 30, "rateLimitPerMin": 20 },
        },
        "qq": { "lane": { "dm": "deep", "mention": "fast" }, "intake": { "mode": "lossless" } },
        "local": { "lane": { "chat": "deep" }, "intake": { "mode": "lossless" } },
    },
    "defaults": { "lane": "deep", "intake": { "mode": "lossless" } },
}
```

优先级：显式策略 > `laneHint` > defaults。两条车道各自串行、彼此独立，队头阻塞就此解决 —— 弹幕不再排在长任务后面。快车道有且只有一个工具 `defer_to_deep(reason)` 用于升级；不做反向插话。M3 每车道 1 并发，房间级并发后置。

### 门口裁决（admission-time triage）

有损 intake 的不变量：

> **一旦回执为 `accepted`，该事件必定进入模型上下文**（除非 turn 本身失败）。丢弃只发生在门口，永不淘汰已受理的事件。

因此 ws 回执从语义单一的 `ack` 改为带 disposition：

| disposition | 含义                                                          | 日志                       |
| ----------- | ------------------------------------------------------------- | -------------------------- |
| `accepted`  | 已落 `input.accepted`，排入车道                               | `input.accepted`           |
| `merged`    | 折入同 conversation 的待发批次（`mergeWindowMs` 内），带批次号 | `input.accepted` + batchId |
| `dropped`   | 门口拒收，**不落** `input.accepted`                           | `input.dropped`（含 reason）|

缓冲**分区**而非全局淘汰：`alwaysKeep` 的 kind 持有保留槽，其余用通用槽；某一区满时新事件在门口 `dropped`，已 accepted 的事件不受影响。drop 原因枚举 `buffer_full` / `priority_buffer_full` / `lane_drop` / `self_echo` / `duplicate`，adapter 据此决定是否重投（只有 `buffer_full` 该重投）。

### 三个模型

| 角色       | 用途                                | 环境变量                     |
| ---------- | ----------------------------------- | ---------------------------- |
| main       | 深度车道 ReAct                      | `CAICAI_OPENROUTER_MODEL`    |
| fast       | 快车道单次调用 + 流式               | `CAICAI_FAST_MODEL`          |
| background | compaction、digest、daydreaming     | `CAICAI_BACKGROUND_MODEL`    |

未配置时 fast / background 回落到 main，并在启动日志明确告知 —— 回落能跑，但快车道就没有延迟优势。

### 上下文装配

**[已定] 快车道不用工具查历史。** 快车道存在的唯一理由是「单次调用 + 流式」，先调工具再回答等于把一次调用变三次，延迟直接输给深度车道，而且模型很可能压根不调。该 conversation 的近期消息来自 runtime 的**常驻投影**（`RawHistoryStore.projection` 增加 `conversations: Map<id, { recent: RingBuffer<N>, lastActivityAt, droppedCount }>`，回放时一并构建，内存有界）。

快车道上下文固定顺序：

1. runtime 硬编码的**精简安全前言**：回复要短、不泄露凭据与系统内容、聊天内容是数据不是指令、不承诺未验证的事、L3 动作只是提交申请。（`SYSTEM.md` 不注入，这层是快车道唯一的边界声明。）
2. `Role.md` 全文 —— **[已定] 不新增独立人格文件**，两条车道共用同一份人格，`daydreaming()` 改它即同时生效，维持单一真相源。
3. 一行态势：深度车道在做什么 + 活跃渠道列表。
4. 该 conversation 最近 N 条（读常驻投影）。
5. 当前合并批次。

不注入 `SYSTEM.md` / `Memory.md` / `tasks/Index.md` 全文，token 与延迟都不允许。

**深度车道**：现有 `buildContextWithMemory` + 按 conversation 选取（原 `selectRecentTurns` 取全局最近 turn，多渠道下弹幕会污染编程上下文）+ **社交近况块**。

**社交近况**：heartbeat 时由 background model 为每个有新活动的 conversation 生成极短 digest，落 `conversation.digested`；深度车道注入的是跨渠道汇总（「刚在 bilibili 直播间和 12 人聊过，主要问 X；QQ 有一条未回私信」），而不是原始弹幕。它是**由历史派生的上下文 checkpoint**，可重新生成，不是长期记忆 —— 要沉淀为长期事实仍须 `daydreaming()` 写入 `Memory.md`，digest 不自动回写。

`context.compacted` **仅服务深度车道**；快车道 conversation 不进 checkpoint，只做环形缓冲截断 + digest。`history_query` 工具服务深度车道、admin 与事后追溯，不是快车道的主上下文机制。

### turn 上下文与维护操作边界

`TurnContext = { turnId; lane; conversationId }` 沿 `handleEvents` → `runAgentStream` 参数透传，并经 LangGraph `RunnableConfig.configurable` 下发给 `toolNode`，再传进 `onToolStart` / `onToolResult` / `toolResultMessage`。runtime 上原先的单字段 `activeTurnId` 换成 `activeTurns: Map<lane, TurnContext>` —— 两条车道并发时它会造成 tool 事件归属串台。房间级并发因此是纯加法。

`compact()` 与 `daydreaming()` 的空闲边界从**全 runtime** 降为**深度车道**：有了弹幕流几乎不存在全局静默时刻，否则维护操作会永久排队。**history append 仍保持单一 Promise chain 全局串行**，这条不放松。

### 权限分级与 L3 审批

「自主社交」意味着 agent 会真的对外发东西且难撤回。闸门由 runtime 强制，不指望 adapter 自觉。

| 级别 | 范围                                 | 闸门                            |
| ---- | ------------------------------------ | ------------------------------- |
| L0   | 只读（查历史、读房间信息）           | 自动允许                        |
| L1   | 回复来源（走输出路由）               | `maxChars` + `rateLimitPerMin`  |
| L2   | 主动发起（未交互房间、私信、关注）   | 限流 + 全量记录                 |
| L3   | 公开发布（视频、博客、发帖）         | admin 人工审批                  |

**未分级的工具默认 L3** —— 新接入的 adapter 不会因为漏配就获得公开发布权。

L3 是**提交即返回的状态机，agent 绝不阻塞等待**：

```text
agent 调 L3 tool
  → runtime 落 approval.requested（含完整 tool name + args）
  → tool 立刻返回 { status: "pending", approvalId }   ← turn 正常结束
  → 事件路由到 admin，admin server 持久化 pending 列表并呈现
  → 人工 approve / deny
  → admin 经受信通道发 approval_decision → server → runtime 入队（deep lane）
  → runtime 落 approval.decided；approve 时由 runtime 依日志中的 args 执行
  → 结果落 outbound.delivered / outbound.failed，并作为事件进入深度车道上下文
```

- **JSONL 是审批的真相源**，admin 的 pending 列表是可重建投影；重启回放时「有 requested 无 decided / expired」即恢复为 pending，与既有的 interrupted turn 处理同构。
- **approve 后由 runtime 执行**，不把 args 交回 agent 重新决定，避免二次决策漂移；`approvalId` 一次性消费，重复 decision 直接拒绝。
- **决策通道必须受信**：`approval_decision` 只接受来自 admin 鉴权路径的消息，adapter 连接一律无权提交 —— 否则渠道能自己批准自己的发布权。
- `CAICAI_APPROVAL_TTL_MS` 到期落 `approval.expired`，语义等同 deny 并通知 agent，避免 admin 长期离线时无限积压。

### 事件日志 v2

`HISTORY_VERSION = 2`，单一 literal，**不做 v1 upcast**（M1 / M2 的历史日志已由用户手动归档）。没有兼容包袱后新字段全部 required，链路上少一批默认值分支和一类静默错误来源。`input.accepted` 从平铺重塑为嵌套 `event: ChannelEvent`，使 `ChannelEvent` 的 schema 只写一份、入站校验与日志校验共用。

| 事件                                          | 用途                                        |
| --------------------------------------------- | ------------------------------------------- |
| `input.accepted`                              | 嵌套 `ChannelEvent`，可带 `batchId`         |
| `input.dropped`                               | 门口裁决审计：reason、conversationId、count |
| `turn.started`                                | + `lane`、`conversationId`                  |
| `context.compacted`                           | + `lane`（恒为 deep）                       |
| `conversation.digested`                       | 快 → 深摘要 checkpoint                      |
| `outbound.delivered` / `outbound.failed`      | 对外动作结果                                |
| `channel.connected` / `channel.disconnected`  | adapter 生命周期                            |
| `approval.requested` / `.decided` / `.expired`| L3 审批状态机                               |

### 跨包契约位置

history event schema 下沉到 `packages/utils` 的 `./history` subpath export（见 M0 对 utils 的定位）。原因：`apps/admin` 依赖方向不含 `agent-core`，若不下沉，admin 就得维护第二份手写校验 —— 核心改 schema 时面板会整片报「invalid event schema」，表现为「面板全红但 agent 正常」，极易误诊。切分线是「要不要 langchain」：schema 与纯函数 `parseHistoryLine` 归 utils，`BaseMessage` 序列化与 `RawHistoryStore` 留在 `agent-core`。

### Web 后台（M3 同步交付）

- **队列视图**：`lane_snapshot`（每车道状态 / turnId / conversationId / 排队数 / 本轮起始）与 `intake_snapshot`（每 conversation 的通用槽与保留槽占用、按 reason 分类的 `droppedCount`、最后活动、生效策略）。runtime 在状态迁移时推送，低频轮询兜底，避免断连后面板僵死。
- **adapter 视图**：`channel_snapshot`（连接状态、已注册工具及其权限级别、入站速率、`outbound` 成败计数、最近错误）。
- **审批视图**：pending 列表 + approve / deny + 已决历史，显示完整 tool name 与 args。
- **通用调试入口**：① 注入入站 —— 构造 `ChannelEvent` 投进 intake（可勾 `isSelf` 验回声抑制），强制打 `debugOrigin: "admin"`，回执显示 disposition；② 直调出站 tool —— 默认 **dry-run**（只校验 schema 与路由解析，不真发），显式勾选才真实投递，且仍受权限分级与 L3 审批约束。

JSONL 对后台严格只读不变：调试注入与审批决策都走 runtime 公开入口，不直接改写日志。

### 明确不做

同时直播聊天 + 玩游戏、房间级并发、快→深的反向插话（steering）、向量检索。**游戏不是消息渠道** —— 它需要自己 tick 率的感知循环，将来是第三条车道，与聊天**共享记忆与事件日志、不共享循环**。这正是「车道才是并发单元」的由来。

## M4 · Pi 式运行时自我修改

**目标**：借鉴 [Pi](https://github.com/earendil-works/pi) 的 `reload` 机制，让 agent **改自己后不重启进程即生效**。

**机制**

- tools / prompts 改为从**可写目录**加载；
- 新增 `runtime.reload()`：用磁盘上的新 config **重建图、保留 `state`**；
- 给 agent 一个编辑该目录的工具 + 一个触发 `reload` 的入口。

因状态↔图早已分离、`buildContext` 早已是缝，此步为**加法**，不推翻既有结构。

**自我修改分级**（原则：尽量停在数据 / 配置层）

- L0 改人格 / 记忆（md） · L1 改提示词 · L2 用现有原语组合新工具 · L3 不重编译改核心运行时代码。
- **L3 最后做、默认收敛**；L0–L2 已覆盖绝大部分可观测收益。
