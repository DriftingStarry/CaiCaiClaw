# Product Requirements Document: M2 Web 后台管理（apps/admin）

**Version**: 1.0
**Date**: 2026-08-17
**Author**: Sarah (Product Owner)
**Quality Score**: 92/100

---

## Executive Summary

CaiCaiClaw 的 M2 里程碑已经完成了 runtime 侧的全部上下文能力：文件式 Markdown 记忆、`context.compacted` 滚动摘要 checkpoint、quiescent 边界串行 compaction、长工具结果的 `history://` 引用，以及 server 侧的 compact / daydreaming WS 入口。但这些能力目前**只有代码路径没有操作面**：要看 agent 的记忆内容得用编辑器打开 `~/.caicaiclaw/*.md`，要看它做过什么得手动翻 `history.jsonl`，要重启它得回终端 Ctrl+C 再 `pnpm server`。M2 的「Web 后台管理」正是为了补齐这一层。

本 feature 新建 `apps/admin`（Next.js SSR），它同时是**管理界面**和**进程 supervisor**：常驻运行，以子进程方式 spawn / kill `apps/server`，从而真正掌管 agent 进程的生命周期。四个路由分别承担会话（chat）、语义记忆读写（memory）、情景日志只读查询（logs）和进程状态与控制（agent）。现有 `apps/web` 的会话界面迁入 `apps/admin/app/chat` 后删除，仓库只保留单一前端入口。

这件事的价值在于把 agent 从「一个需要开发者用终端伺候的进程」变成「一个有仪表盘的常驻服务」。它也是 M3 `reload` 的前置操作面：当 agent 能自我修改行为时，operator 必须先有地方观察它改了什么。

---

## Problem Statement

**Current Situation**

- **记忆不可见**：`SYSTEM.md` / `Role.md` / `Memory.md` / `tasks/Index.md` 是 agent 人格与长期记忆的唯一真相源，但只能靠外部编辑器打开。`daydreaming()` 已经能让 agent 自己改写 `Role.md`，operator 却没有地方看到「它把自己改成了什么」。
- **历史不可查**：`history.jsonl` 是情景记忆的唯一真相源，包含完整输入输出、工具审计和长工具结果原文。目前没有任何按 turn 浏览的手段，长工具结果只能靠 grep。
- **进程无操作面**：agent 的启停完全依赖终端前台进程。崩溃后没有退出码与 stderr 的留存展示；`compact()` / `daydreaming()` 虽已有 WS 入口，但只有 TUI 能手动触发。
- **前端只有会话**：`apps/web` 只提供聊天，不承载任何管理职责。

**Proposed Solution**

新建 `apps/admin`：Next.js SSR 管理端 + 进程 supervisor 二合一。

```text
apps/admin  （常驻：Next SSR + supervisor）
  ├─ spawn / kill ──▶ apps/server（子进程，持有 AgentRuntime）
  │                     └─ ws://127.0.0.1:8787
  ├─ /chat    → 浏览器直连 agent ws（迁自 apps/web）
  ├─ /memory  → 读写 .caicaiclaw/*.md（乐观锁 + 原子替换）
  ├─ /logs    → 只读 history.jsonl（反向流式扫描分页）
  └─ /agent   → 进程状态 + 启 / 停 / 重启 + compact / daydreaming
```

关键设计取舍：**admin 与 agent 必须是两个进程**。`apps/server` 本身就是 agent 进程（进程内 `new AgentRuntime()` 并持有 WS server），若管理端与其同进程，它无法在停掉 agent 的同时自己存活 —— 停了就没有后台可以点「启动」。因此 supervisor 归 admin，`apps/server` 职责完全不变。

**Business Impact**

- operator 从「翻文件 + 终端」升级为「一个页面」，观察与干预 agent 的成本大幅下降。
- `daydreaming()` 的人格自我修改第一次变得可审计 —— 这是核心不变式（状态 ↔ 行为分离）从设计走向可运维的验证点。
- 为 M3 `reload` 与 M4 多渠道接入提供了统一的 operator 面板落点。

---

## Success Metrics

本项目是单人自用工具，KPI 以**可验证的运维能力**而非用户量衡量。

**Primary KPIs**

- **进程控制闭环成立**：从浏览器完成「启动 → 观察 running → 停止 → 观察 stopped → 重启 → running」全流程，无需触碰终端。测量方式：手动验收，记录每步的 UI 状态与 `ps` 观察结果。
- **记忆写入零静默覆盖**：`/memory` 保存在磁盘已被外部（编辑器或 `daydreaming()`）修改的情况下，100% 拒绝保存并提示刷新，绝不覆盖。测量方式：构造并发修改场景验收。
- **JSONL 严格只读**：admin 全生命周期内 `history.jsonl` 的字节数只增不减，且增量全部来自 runtime。测量方式：admin 侧代码不含对该文件的写句柄；验收前后比对文件大小与 `git diff --check` 之外的哈希。
- **大日志可用**：`history.jsonl` 达到 10 MB 量级时，`/logs` 首屏与翻页响应仍在可接受范围（目标 < 1 s），且 admin 进程内存不随日志线性增长。测量方式：生成大日志后实测。

**Validation**

四项均在实现完成时以手动验收执行，证据按 `AGENTS.md` 要求写入 `progress.md` 的 Evidence 表与 `feature_list.json` 的 `evidence`。仓库明确不设 `test` 命令，测试覆盖率不是完成门槛。

---

## User Personas

### Primary: Operator（本仓库作者，唯一用户）

- **Role**: agent 的开发者兼运维者，本机单人使用。
- **Goals**: 快速看到 agent 当前在想什么、记住了什么、做过什么；需要时能立刻改它的人格与记忆、重启它、手动触发一次 compact。
- **Pain Points**: 现在这些动作分散在编辑器、终端和 grep 里，没有统一入口；agent 自己改了 `Role.md` 之后不知道改了什么。
- **Technical Level**: Advanced —— 熟悉本仓库全部代码，能读 JSON、能接受技术性的错误信息，不需要引导式 UI 或防呆封装。

无二级 persona。本 feature 不考虑多用户、多角色或权限分级。

---

## User Stories & Acceptance Criteria

### Story 1: 控制 agent 进程生命周期

**As an** operator
**I want to** 在 `/agent` 页面看到 agent 进程的真实状态，并用按钮启动、停止、重启它
**So that** 我不需要为了重启 agent 回到终端，也不会因为忘了它在哪个终端里而找不到它

**Acceptance Criteria:**

- [ ] `/agent` 展示进程状态机的当前值：`stopped` | `starting` | `running` | `stopping` | `crashed`，并展示 pid、启动时间与运行时长。
- [ ] `running` 的判定依据是 admin 的 control 连接收到了子进程的 `hello` 消息，而非「进程还在」。仅进程存活但 WS 未就绪时状态为 `starting`。
- [ ] 「启动」在 `stopped` / `crashed` 下可用，spawn `apps/server` 子进程；成功进入 `running` 后按钮变为不可用。
- [ ] 「停止」发送 `SIGTERM`，走 `apps/server` 已有的 graceful shutdown（关闭 WS、`runtime.stop()`、排空 JSONL 写入）。超过可配置的宽限期（默认 10 s）仍未退出则发送 `SIGKILL`，并在 UI 明示这次是强杀。
- [ ] 「重启」= 停止并等待进程真正退出后再启动，不允许两个 agent 子进程同时存在（避免撞端口 8787 与共写 `history.jsonl`）。
- [ ] 并发点击（如连点两次启动、或在 `stopping` 中点启动）被状态机拒绝并给出明确原因，不产生第二个子进程。
- [ ] admin 自身退出（`SIGINT` / `SIGTERM`）时先停止 agent 子进程，不留孤儿进程。

### Story 2: 崩溃后知道发生了什么

**As an** operator
**I want to** agent 异常退出时保留退出码、信号与最后若干行 stderr
**So that** 我能直接判断是配置问题（如 `OPENROUTER_MODEL` 未设置）还是运行时故障，而不是面对一个空白的 stopped 状态

**Acceptance Criteria:**

- [ ] 非 operator 主动停止的退出一律进入 `crashed` 状态，**不自动重启**。
- [ ] `crashed` 状态展示退出码、终止信号（若有）、退出时间，以及子进程最后 N 行（默认 200）stderr。
- [ ] 环形缓冲区保存 stderr，不随子进程长时间运行无界增长。
- [ ] 启动即失败的情况（例如缺少 `OPENROUTER_MODEL` 导致 `loadServerConfig` 抛错）能在 UI 看到该错误文本，而不只是「退出码 1」。
- [ ] operator 主动「停止」导致的退出进入 `stopped`，与 `crashed` 明确区分。
- [ ] 展示的 stderr 与错误信息经过与 `apps/server` 中 `safeErrorMessage` 同级的脱敏处理，不泄露 `Bearer` token、api key 或完整环境变量。

### Story 3: 读写语义记忆而不打翻 agent 自己的修改

**As an** operator
**I want to** 在 `/memory` 浏览并编辑 `.caicaiclaw` 下的 Markdown 记忆文件
**So that** 我能直接校正 agent 的人格与事实记忆，同时不会覆盖掉它通过 `daydreaming()` 写入的内容

**Acceptance Criteria:**

- [ ] 列出并可编辑：`SYSTEM.md`、`Role.md`、`Memory.md`、`tasks/Index.md`、`tasks/*.md`、`tasks/archived/*.md`。
- [ ] 路径解析限制在 `memoryDir` 之内：`..`、绝对路径、符号链接逃逸均被拒绝，且拒绝理由明确。
- [ ] 只允许 `.md` 扩展名。`history.jsonl` 不出现在 memory 路由的可写集合中。
- [ ] 读取时返回内容与并发令牌（`mtime` + 内容哈希）；保存时必须带回该令牌。
- [ ] 令牌与磁盘现状不一致时**拒绝保存**，提示磁盘已变更并提供重新加载；不做自动合并，也不静默覆盖。
- [ ] 写入使用同目录临时文件 + `rename` 原子替换，与 runtime 的 `daydreaming()` 写入方式一致；中断不留半个文件，不留 `.tmp` 残留。
- [ ] 保存成功后无需重启 agent —— 下一次 `buildContext()` 自然读取新内容。此行为在 UI 中说明。
- [ ] 文件不存在时可创建（`allowMissingMemoryFiles: true` 是 server 现行策略）；创建路径同样受目录与扩展名约束。

### Story 4: 按 turn 浏览情景日志

**As an** operator
**I want to** 在 `/logs` 只读地浏览 `history.jsonl`，最新在前，并能展开单个 turn 的工具调用与长结果原文
**So that** 我能追查 agent 具体做了什么，而不必 grep 一个不断增长的 JSONL

**Acceptance Criteria:**

- [ ] 默认按时间倒序展示，以 turn 为单位分组，展示输入、输出消息、工具审计与 turn 终态（committed / failed / interrupted）。
- [ ] 分页从文件尾部反向流式扫描，不把整个文件读入内存；admin 内存占用不随日志大小线性增长。
- [ ] 可展开查看 `tool.completed` 中的工具结果原文，长结果支持 offset / limit 分页，不一次性推送全文到浏览器。
- [ ] `context.compacted` 事件可见，展示 `compactionId`、覆盖 sequence 区间、trigger（manual / scheduled）、model 与摘要正文。
- [ ] 该路由对 JSONL **严格只读**：admin 侧不存在对 `history.jsonl` 的写、截断或补写路径。
- [ ] 文件不存在、为空、或含损坏行时给出明确提示（含行号），而不是白屏或崩溃；单行损坏不阻止其余部分展示。
- [ ] agent 进程处于 `stopped` / `crashed` 时日志仍可浏览（日志读取不依赖子进程存活）。

### Story 5: 在管理端里直接对话

**As an** operator
**I want to** `/chat` 提供与原 `apps/web` 等价的会话界面
**So that** 我在同一个页面里既能观察也能直接跟 agent 说话，且不需要维护两份前端

**Acceptance Criteria:**

- [ ] 会话行为与迁移前等价：连接状态展示、消息列表、活动面板、composer、`clientId` 持久化、重连退避、协议版本不匹配主动断开。
- [ ] 复用 `@caicaiclaw/client-core` 的 transport 与 `reduceClientState`，不在 admin 重新实现协议状态机。
- [ ] agent 子进程未运行时 `/chat` 显示明确的未连接状态并提示前往 `/agent` 启动，不表现为无限重连的静默失败。
- [ ] `apps/web` 在内容迁移完成后删除，且以下四处同步更新：`pnpm-workspace.yaml`（若需）、根 `tsconfig.json` 的 `references`、`AGENTS.md` 的依赖方向表、根 `package.json` 的脚本。
- [ ] 删除 `apps/web` 前须获得 operator 的显式二次确认（不可逆变更）。

### Story 6: 手动触发 compact 与 daydreaming

**As an** operator
**I want to** 在 `/agent` 页面手动触发一次 compact 或 daydreaming 并看到结果
**So that** 我能在观察到上下文变长或人格需要沉淀时立即干预，而不必依赖 TUI 或阈值调度

**Acceptance Criteria:**

- [ ] 两个操作都通过 admin 的 control 连接发送 protocol 已定义的 `compact` / `daydreaming` 客户端消息，路由到 runtime 公开方法，**不直接改写任何持久化文件**。
- [ ] 返回的摘要在 UI 展示；失败时展示脱敏后的错误且 agent 进程保持存活可继续接受输入。
- [ ] agent 进程未运行时两个按钮不可用，并说明原因。
- [ ] runtime 忙碌时请求排队至当前 turn 完成（沿用 runtime 既有串行化语义），UI 呈现「进行中」而非超时报错。

---

## Functional Requirements

### Core Features

**Feature 1: 进程 supervisor**

- Description: admin 进程内的单例 supervisor，负责 spawn / 监听 / 终止唯一一个 `apps/server` 子进程，并维护其状态机。
- User flow: operator 打开 `/agent` → 见到当前状态 → 点击启动 / 停止 / 重启 → 状态实时更新（SSE 或轮询）。
- 状态机: `stopped → starting → running → stopping → stopped`；任意非主动退出 → `crashed`；`crashed → starting`（手动）。
- Edge cases: 连点按钮；`stopping` 中请求启动；宽限期内未退出需 `SIGKILL`；端口 8787 被占用导致子进程起不来；admin 自身退出需先收子进程。
- Error handling: 所有状态转换非法时返回明确原因；子进程 spawn 失败（可执行文件缺失、cwd 错误）与启动后立即退出（配置错误）分别报告。

**Feature 2: Control 连接**

- Description: admin 维持一条到子进程的 WebSocket 连接，用途有二 —— 以收到 `hello` 作为 `running` 的判定信号；转发 `compact` / `daydreaming` 请求并取回结果。
- 为什么不给 `apps/server` 加 HTTP 面: 拓扑决策要求不改变 `apps/server` 的职责，复用既有 WS 协议即可满足需求，新增 HTTP 端点会扩大协议表面。
- Edge cases: 子进程起来但 WS 未就绪（保持 `starting` 并带超时）；连接中途断开而进程仍在（回落到 `starting` 并重连，重连耗尽后标记异常）。
- Error handling: 协议版本不匹配时主动断开并在 UI 明示版本冲突。

**Feature 3: Memory 读写**

- Description: 受目录与扩展名约束的 Markdown 文件浏览与编辑，乐观锁防覆盖，原子替换写入。
- User flow: 列出文件 → 打开 → 编辑 → 保存 → 成功提示（或冲突提示 + 重新加载）。
- Edge cases: 磁盘在编辑期间被 `daydreaming()` 或编辑器改动；文件不存在需创建；`tasks/` 下新增文件；路径穿越尝试；符号链接指向目录外。
- Error handling: 冲突返回专门的冲突响应而非通用 500；路径违规、扩展名违规、写入失败各自返回可读原因；写入失败不留 `.tmp` 残留。

**Feature 4: Logs 只读查询**

- Description: 反向流式扫描 `history.jsonl` 的分页只读视图，按 turn 分组，支持展开长工具结果。
- User flow: 打开 `/logs` → 见最新 turns → 展开某 turn → 展开某工具结果 → 按需翻页加载更多原文。
- Edge cases: 文件不存在 / 为空；单行损坏；单个工具结果达 MB 量级；日志在浏览期间被 runtime 追加。
- Error handling: 损坏行报告行号并跳过，不阻断其余展示；offset 越界返回明确错误。

**Feature 5: Chat 路由**

- Description: 迁自 `apps/web` 的会话界面，浏览器直连 `ws://127.0.0.1:8787`，不经 admin 代理。
- 为什么不代理: 代理会让 admin 在停止子进程时额外承担代理连接的生命周期管理，且对本机单人场景无收益。
- Edge cases: agent 未运行；重连；协议版本不匹配。
- Error handling: 未连接状态显式提示并引导至 `/agent`。

**Feature 6: 认证与暴露约束**

- Description: admin 只监听 `127.0.0.1`，所有路由与写操作需校验来自 `CAICAI_ADMIN_TOKEN` 的单一 token。
- Edge cases: token 未配置 → admin **拒绝启动**，不提供无认证降级路径；token 错误 → 401 且不泄露预期值。
- Error handling: 认证失败的响应不包含 token 相关细节。

### Out of Scope

- 多用户、角色权限分级、审计登录。
- 局域网 / 公网暴露，HTTPS，CSRF 完整方案。
- agent 子进程自动重启（已明确决策为不做）。
- 通过后台直接编辑 `history.jsonl`、重写或截断事件日志。
- `.caicaiclaw` 之外任意文件的读写（memory 路由不得退化为通用文件浏览器）。
- memory 编辑的版本历史与回滚、diff 视图。
- 多 agent 实例管理、端口/数据目录隔离（现有「多实例撞端口」风险不在本 feature 解决）。
- 向量检索、自动 daydreaming、按 token 阈值自动 compact（README 已明确不做）。
- 日志的全文搜索与结构化过滤（仅提供按 turn 的倒序分页浏览）。
- 移动端适配。

---

## Technical Constraints

### Performance

- `/logs` 首屏与翻页在 10 MB 量级日志下目标 < 1 s；admin 内存不随日志大小线性增长（反向流式扫描，不常驻完整历史）。
- 长工具结果按 offset / limit 分页推送，单次响应有界。
- `/agent` 状态更新采用 SSE 或轮询，延迟在秒级即可；不要求毫秒级。
- 子进程 stderr 用固定容量环形缓冲，不无界增长。

### Security

- **仅监听 `127.0.0.1`**，不得绑定 `0.0.0.0`。这条是硬约束，需在代码与文档中同时明示。
- 单一 token（`CAICAI_ADMIN_TOKEN`）校验所有路由；token 缺失时 admin 拒绝启动。
- 这是一个高权限面板：可写 agent 人格、可启停进程，而 agent 自身持有 `exec` 工具。因此不做无认证降级。
- 错误信息与 stderr 展示前脱敏（`Bearer`、api key、authorization、password、secret、token），复用 `apps/server` 中 `safeErrorMessage` 同级的规则。
- memory 路径解析必须解析符号链接后再校验是否位于 `memoryDir` 内。
- **已知残余风险**：agent 的 WS（8787）本身仍无认证，本机任意页面都能连上并向 agent 发送输入。这是本 feature 之前既存的状态，不在此扩大范围，但须记入 `progress.md` 的开放风险。

### Integration

- **apps/server**: 作为子进程被 spawn，职责与代码不变（仅在必要时接受启动参数/环境变量注入）。admin 通过既有 WS 协议与之通信。
- **packages/protocol**: 复用现有 `compact` / `daydreaming` 客户端消息与结果消息（`WS_PROTOCOL_VERSION` 当前为 3）。若本 feature 无新协议需求则不改动；一旦改动须同步类型、Zod schema、parse、serialize 并递增版本。
- **packages/client-core**: `/chat` 复用 transport 与 `reduceClientState`。
- **AgentRuntime**: admin 不直接引用 `agent-core`，也不绕过 runtime 改写持久化文件。

### Technology Stack

- Next.js 16 + React 19 + TypeScript 6，ESM，Bundler module resolution，4 空格缩进（沿用 `apps/web` 现状与 `AGENTS.md` 约定）。
- antd 6 + Tailwind 4（沿用 `apps/web` 现有依赖，避免引入新 UI 体系）。
- 子进程管理使用 Node 内置 `child_process`，不引入 pm2 / forever 等外部 supervisor。
- 新增 workspace 依赖边：`apps/admin <- client-core, protocol, utils`。**不得**新增 `apps/server <- client-core`。同步更新 `AGENTS.md` 的依赖方向表与根 `tsconfig.json` 的 `references`。
- 若需要新增 npm 依赖（如 Markdown 编辑器组件），按 `AGENTS.md` 要求先说明用途、替代方案与影响并取得确认。

---

## MVP Scope & Phasing

Operator 已明确要求**不分期，直接交付最终版本**。四个路由与全部核心能力一次性完成。

### 交付内容（全部为完成门槛）

1. `apps/admin` 骨架：Next.js SSR、导航、token 认证中间件、仅监听回环。
2. 进程 supervisor：状态机、启 / 停 / 重启、graceful shutdown + 宽限期强杀、崩溃留痕（退出码 / 信号 / stderr 环形缓冲）、admin 退出时收子进程。
3. Control 连接：`hello` 作为 running 判定、compact / daydreaming 转发。
4. `/agent`：状态展示、三个进程按钮、两个维护操作按钮、崩溃详情。
5. `/memory`：文件列表、编辑、乐观锁冲突拒绝、原子替换写入、路径与扩展名约束。
6. `/logs`：反向流式分页、turn 分组、工具结果分页展开、`context.compacted` 可见、损坏行按行号提示。
7. `/chat`：迁自 `apps/web` 的等价会话界面。
8. `apps/web` 删除与四处配置同步（需 operator 二次确认）。
9. 根 `package.json` 新增 admin 启动脚本；`AGENTS.md` 依赖表与 `tsconfig.json` references 同步。

### 优先级排序（仅用于实现顺序，不改变交付范围）

1. supervisor + `/agent`（本 feature 的独有价值所在，也是其它路由的运行前提）
2. `/logs`（只读，风险最低，能立刻验证日志读取策略）
3. `/memory`（涉及写入，需要乐观锁与原子替换）
4. `/chat` 迁移与 `apps/web` 删除（不可逆，放最后）

### Future Considerations

- memory 编辑的版本历史与 diff / 回滚。
- 日志的结构化过滤与全文搜索。
- M3 `reload` 的操作入口（可加载 tools / prompts 的目录浏览与 reload 按钮）。
- 多 agent 实例管理与运行环境隔离（对应现有「多实例撞端口 8787」风险）。
- agent WS 本身的认证。

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| 删除 `apps/web` 是不可逆变更，可能遗漏配置同步 | Med | Med | 实现期向 operator 二次确认；明确列出四处同步点（workspace、tsconfig references、AGENTS.md 依赖表、根 package.json 脚本）；删除后立即跑 `./init.sh` 与 admin build 验证 |
| 依赖方向被破坏（误将 client-core 引入 apps/server） | Med | High | supervisor 归 admin，`apps/server` 不改依赖；完成前用 grep 验证 `apps/server` 未引入 client-core，并同步 `AGENTS.md` 依赖表 |
| 双子进程并存导致撞端口 8787 与共写 `history.jsonl` | Med | High | supervisor 强制单例；重启必须等待前一进程真正退出（监听 `exit` 事件）后再 spawn；状态机拒绝非法并发转换 |
| memory 写入与 `daydreaming()` 并发覆盖 | Med | High | 乐观锁（mtime + 内容哈希）冲突即拒绝保存；同目录临时文件 + rename 原子替换，与 runtime 写法一致 |
| 高权限面板意外暴露（绑定 0.0.0.0 或 token 缺失降级） | Low | High | 硬编码仅监听 127.0.0.1；token 缺失时拒绝启动，不提供无认证路径；错误信息脱敏 |
| 大 JSONL 读取撑爆 admin 内存 | Med | Med | 反向流式扫描 + 分页，不常驻完整历史；工具结果按 offset/limit 分页；用 10 MB 量级日志实测验收 |
| agent WS（8787）无认证，本机任意页面可发输入 | High | Med | 既存风险，本 feature 不扩大范围；明确记入 `progress.md` 开放风险，后续单独处理 |
| feature 粒度偏大导致跨会话上下文丢失 | High | Med | 按上述优先级顺序分步提交（Angular commit message）；每步同步 `progress.md`；必要时填写 `session-handoff.md` |
| SSR 与浏览器直连 ws 的边界混淆（把 ws 逻辑写进 server component） | Med | Low | chat 的连接逻辑保持在客户端组件内，沿用 `apps/web` 现有的 store 结构 |

---

## Dependencies & Blockers

**Dependencies**

- **feat-003 / feat-004（均已 done）**: runtime 的 compact / daydreaming / memoryDir 能力与 server WS 入口，是 `/agent` 维护操作的前提。
- **packages/client-core（已 done）**: `/chat` 的 transport 与状态归约来源。
- **packages/protocol v3（已 done）**: compact / daydreaming 消息定义。
- **apps/web 现有会话组件**: `/chat` 的迁移来源（`ChatShell`、`ChatMessageList`、`ChatComposer`、`AgentActivityPanel`、`ConnectionBadge`、`useAgentClientStore`、`clientIdentity`）。
- **operator 的二次确认**: 删除 `apps/web` 之前必须取得。

**Known Blockers**

无阻塞项。所有依赖均已 `done`，可立即登记为 feature 并开始实现。

**实现前需登记**

本工作跨会话且影响多个模块，按 `AGENTS.md` 必须先在 `feature_list.json` 登记新 feature（建议 `feat-006`，`status: in-progress`），并同步 `progress.md` 的 Active Feature。

---

## Appendix

### Glossary

- **admin**: 本 feature 新建的 `apps/admin`，Next.js SSR 管理端兼进程 supervisor，常驻运行。
- **agent 进程**: 被 admin spawn 的 `apps/server` 子进程，进程内持有 `AgentRuntime` 与 WS server。
- **supervisor**: admin 进程内负责 spawn / 监听 / 终止 agent 子进程的单例组件。
- **control 连接**: admin 到 agent 子进程的 WebSocket 连接，用于判定 running 与转发维护请求。
- **语义 / 工作记忆**: `.caicaiclaw` 下的 Markdown（`SYSTEM.md` / `Role.md` / `Memory.md` / `tasks/`），后台可读写。
- **情景记忆**: `history.jsonl` 事件日志，后台严格只读。
- **上下文 checkpoint**: `context.compacted` 事件承载的滚动摘要，由历史派生，可重新生成，不是长期记忆。
- **乐观锁**: 读取时下发 mtime + 内容哈希，保存时校验；不一致即拒绝保存。
- **quiescent boundary**: 无 active turn、pending input 或未完成 tool call 的时刻，compaction 只允许在此执行。

### References

- `README.md` § M2 · 上下文精进 + Web 后台管理 —— 特别是「Web 后台边界」一节，本 PRD 的读写权限划分以其为准。
- `README.md` § 核心不变式 —— 状态 ↔ 行为分离，本 feature 不得引入第二个真相源。
- `AGENTS.md` § Architecture Invariants —— 依赖方向表与协议变更要求。
- `AGENTS.md` § Definition of Done —— 完成门槛与 artifacts 同步要求。
- `progress.md` § Blockers / Risks —— 既存开放风险（含运行环境未隔离、多实例撞端口 8787）。
- `apps/server/src/server.ts` —— graceful shutdown 流程与 `safeErrorMessage` 脱敏规则的参照实现。
- `apps/server/src/config.ts` —— `memoryDir` 推导逻辑（`dirname(systemPromptPath || rawHistoryPath)`）。

---

*本 PRD 通过交互式需求收集与质量评分生成，覆盖业务、功能、UX 与技术四个维度。*
