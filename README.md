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
> 每类信息只能有一个真相源：compaction summary 是从事件历史派生的上下文 checkpoint，不是另一份长期记忆；拼装后的 SystemMessage 是运行时投影，不回写为状态。守住这一条，后续里程碑都是**加法**：Pi 式 `reload`（M3）靠它成立，实时多车道（M4）靠它并存。

# 路线图

| 里程碑 | 主题 | 状态 |
| --- | --- | --- |
| M0 | 已有基础：ReAct + 工具注册 + 单 runtime + WS + 事件队列/心跳骨架 | [已完成] 当前基线 |
| M1 | 最小可运行版本（MVP）：单心智 + tui/web 双端 + 极简上下文管理 | [已完成] |
| M2 | 上下文精进（compaction）+ Web 后台管理 | [已定] 记忆与 compaction 模式已确定，待实现 |
| M3 | Pi 式运行时自我修改（`reload`） | [待定] |
| M4 | 实时响应与外部渠道接入 | [待定] |

---

## M0 · 已有基础

对照代码的现状，作为 M1 的起点。

- **`packages/utils`** —— 通用工具函数，纯函数且不做 IO。
- **`packages/protocol`** —— `src/index.ts` 提供 Zod 校验的协议与序列化。
- **`packages/agent-core`**
  - `src/agent.ts` —— LangGraph `StateGraph` 的 ReAct 循环（`llm` ↔ `toolNode`）；纯聊天回复即**单次模型调用后 `END`**，不强制多跳。
  - `src/runtime/` —— `AgentRuntime` 目录模块：主 runtime 编排（`agentRuntime.ts`）、事件队列与等待唤醒（`eventQueue.ts`）、LangGraph stream 消费（`agentStream.ts`）、message content 提取（`messageContent.ts`）、公共类型（`types.ts`）。
  - `src/modelProvider.ts` —— 模型接入层。系统 prompt 从上层指定的 Markdown 路径加载。 `src/tools/` —— `exec` / `fileRead` / `fileEdit` / `fileWrite` + 注册入口（`toolsByName`）。
- **`packages/client-core`** —— 与框架无关的客户端状态归约。
- **`apps/server`** —— `src/server.ts` 提供单 agent 的 `WebSocketServer`。
- **`apps/web`** —— Next.js Web 前端。
- **关键性质**：`this.agent`（编译出的图）、`rawHistoryState`（可回放的完整历史）与 `executionState`（单轮上下文）已分离——这正是核心不变式的雏形，M3 的 `reload` 因此几乎是加法。

## M1 · 最小可运行版本（MVP）

**目标**：一个能长期运行的单 agent，配 tui + 极简 web 两个前端，**共享同一个 runtime 实例**（经 WS）。先 make it run。

> 当前进度：shared runtime、WS 广播链路、Web observer、client-side activity/message 状态收敛、`buildContext` 抽离、prompt Markdown 文件化、JSONL 事件日志回放恢复已落地；TUI 端仍未完成。

**关键决策**

- **[已定] 一个心智，多个观察**：所有 client（tui / web）不是各自的会话，而是同一个心智的「视窗 + 输入口」（当前 `server.ts` 的单 runtime + 广播已符合）。
- **[已定] MVP 不做语义记忆**：先跑起来。

**第一刀（先打地基，务实优先）**

1. **抽出上下文构建函数** `buildContext(state) -> messages[]`：从完整 raw history 按完整 turn 选择约最近 30 条消息，再拼 system 与当前输入；execution state 只服务于当前 LangGraph 调用。
2. **人格 / prompt 文件化**：以 Markdown 存储、运行时读取，**不 inline** 进代码（人格本质是角色扮演）。
3. **事件日志落 jsonl**：使用 version 1 的 append-only 领域事件记录 input、turn、tool 审计和完整输出消息，启动时严格校验并回放恢复；未完成轮次标记 interrupted，不自动重试。这是「长期运行 agent」与「聊天 demo」的分界线，也是 M2 后台、M3 `reload` 的共同依赖。

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

## M3 · Pi 式运行时自我修改

**目标**：借鉴 [Pi](https://github.com/earendil-works/pi) 的 `reload` 机制，让 agent **改自己后不重启进程即生效**。

**机制**

- tools / prompts 改为从**可写目录**加载；
- 新增 `runtime.reload()`：用磁盘上的新 config **重建图、保留 `state`**；
- 给 agent 一个编辑该目录的工具 + 一个触发 `reload` 的入口。

因状态↔图早已分离、`buildContext` 早已是缝，此步为**加法**，不推翻既有结构。

**自我修改分级**（原则：尽量停在数据 / 配置层）

- L0 改人格 / 记忆（md） · L1 改提示词 · L2 用现有原语组合新工具 · L3 不重编译改核心运行时代码。
- **L3 最后做、默认收敛**；L0–L2 已覆盖绝大部分可观测收益。

## M4 · 实时响应与外部渠道接入

**目标**：以统一模式接入外部渠道，并支撑实时交互场景。

**统一模式**：每个渠道 = 一个 **adapter**（外部事件 → inbound event，动作 → tool）。**核心永不 import 渠道 SDK。**

**实时响应（独立延迟等级，单独设计）**

- 判断：实时响应**不是靠把主循环改快**，而是靠**快模型 + 反射车道**；纯聊天当前已是「单次调用 + 流式」，贴着模型延迟下限。真正的瓶颈是模型本身延迟与**队头阻塞**（单串行循环让新输入堵在长任务后面）。
- 解法 = 复用 **inner / outer 双车道**：
  - **outer**：接**快模型**的反射车道，秒回互动（单次调用 + 流式）；
  - **inner**：慢速深思车道，后台并发跑任务；
  - 二者仍是**一个心智**，共享同一份事件日志 / 记忆（核心不变式在支撑）；
  - 高频输入流需可**丢弃 / 批量 / 摘要**积压，而非老实排队；
  - 语音 / 形象化场景由 **TTS 按句流水线**主导延迟。
- 这条路在当前结构下**未被堵死**：到时是新增一条读同一 `state` 的车道，而非改造现有循环。
