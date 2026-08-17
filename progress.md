# Session Progress Log

## Current State

**Last Updated:** 2026-08-17
**Active Feature:** feat-006 M2 Web 后台管理（apps/admin），实现完成、运行时验收待人工执行，仍为 `in-progress`。feat-001 ~ feat-005 全部 `done`。

feat-006 的完整需求已固化在 `docs/web-admin-prd.md`（PRD，quality score 92/100），`feature_list.json` 的 15 条 doneCriteria 与该文档一一对应。实现交由 codex（model `gpt-5.6-luna`）执行。

**关键拓扑决策**：用户原计划「在 `apps/server` 基础上做管理端」与「完全控制 agent 进程启停」不能同时成立 —— `apps/server` 本身就是 agent 进程（进程内 `new AgentRuntime()` 并持有 WS server），同进程的管理端在停掉 agent 后自己也不复存在，就没有后台可以点「启动」。故定为 **新增 `apps/admin`（Next.js SSR + supervisor，常驻）+ `apps/server` 作为被 spawn 的子进程**，`apps/server` 职责与代码不变。这同时避免了新增 `apps/server <- client-core` 破坏 Architecture Invariants 的依赖表。

feat-004 已补齐 server compact / daydreaming 入口与 scheduled compact 调度并通过独立复核。feat-005 的鼠标消费器代码已完成，纯函数、真实 Ink 集成与真实终端三项交互验收（备用屏、真实鼠标滚轮、双端共享 runtime）均已通过。

feat-005 于 2026-08-17 由用户决策置为 `done`：Shift+Enter 在其 Windows Terminal + tmux 3.4 环境实测失败，已定位为终端不支持 kitty 键盘协议（Enter 与 Shift+Enter 发出相同字节，属环境能力缺失而非代码缺陷，三组实测详见 Blockers / Risks）。用户选择换用支持 kitty 协议的终端而不改代码。**留痕：换行功能在支持 kitty 协议的终端上的实际按键确认尚未执行过**，代码路径的正确性目前只由喂入 kitty 编码的探针验证，见 Evidence 表。

feat-006 的 apps/admin 已实现，apps/web 已在最后的独立删除范围中移除；静态检查与生产构建通过，进程控制闭环和大日志性能因当前沙箱禁止本地 listen 留待人工验收。
实现由 codex（`gpt-5.6-luna`）执行，其沙箱内 `git commit` 与 127.0.0.1 `listen` 均被拒绝，故它把改动留在工作树并如实标注了未执行的验收项。**这两条都是该沙箱的限制，不是仓库或本机的属性** —— 本机 `.git` 可写，提交由 Claude 在核对硬约束后完成。

## Status

### What's Done

- [x] **feat-001 M1 TUI 共享运行时客户端** — `packages/client-core` 提供跨运行时 WebSocket transport、URL 构建和 timeline selector；`apps/tui` 提供 Ink 7 三栏界面、共享状态归约、输入/设置/滚动/鼠标清理。根 workspace 已同步 TUI package、TypeScript reference、启动脚本、依赖方向和环境变量。已合并（PR #37, merge 997dfce）。
- [x] **feat-002 Web 迁移到 client-core 传输层** — 删除 `apps/web` 自带 WebSocket adapter，store 改用 `@caicaiclaw/client-core` transport 并注入浏览器原生 WebSocket 工厂；保留 `NEXT_PUBLIC_CAICAI_WS_URL` 配置与 `clientIdentity` 持久化；更新 `apps/web/README.md`。已合并（commit be131bb, merge e12992f）。
- [x] **feat-003 M2 上下文精进** — Markdown memory snapshot（独立预算 / 明确错误）、固定顺序 `buildContext`、append-only `context.compacted` checkpoint 与严格回放、quiescent 串行 compaction、二次 compaction 合并、受限 `history_read` 工具供模型按稳定引用分页读取原始长工具结果。`apps/server` 仅传入真实 `openrouterModel` 作为 checkpoint 审计字段。已合并（merge 4704266）。
- [x] **feat-004 Server compact 与 memory 调度入口** — server 配置 `memoryDir` 与 `CAICAI_COMPACT_EVERY_TURNS`，WS compact / daydreaming 单连接入口，按 `done` 事件计数的 scheduled compact，AgentRuntime 共享维护队列与 Role.md 原子反思写入。已完成，证据见下表与 `feature_list.json`。
- [x] **feat-005 TUI 鼠标序列消费与真实终端验收** — 新增 `apps/tui/src/hooks/mouseSequence.ts` 独立状态机消费器，`App.tsx` 只做分发，删除 `parseMouseWheel`。X10 降级与 SGR 跨 chunk 分片两条泄漏路径已封死；组装被证伪或超长时回吐缓冲，不吞后续按键。commit f89ac99。真实终端验收三项通过（备用屏、真实鼠标滚轮、双端共享 runtime）；Shift+Enter 一项在用户环境失败，根因为终端不支持 kitty 协议，用户决策换终端、代码不动，据此置为 `done`。
- [x] **Harness 迁移** — 从多 worktree lane 变式回到 harness-creator 原本的单 lane 模式：删除 `harness/lanes.sh`、`harness/wt.sh`、`harness/lib/workspace.cjs` 与 `.harness/<slug>/` 分片，状态合并进根级 `feature_list.json` 与本文件。

### What's In Progress

- [ ] **feat-006 M2 Web 后台管理（apps/admin）** — 核心实现、配置同步和 apps/web 删除已完成；`./init.sh` 与 admin 生产构建通过。剩余人工验收：hello 驱动的进程控制闭环、JSONL 字节只读、10MB 日志性能，以及受限环境下未能观察的崩溃 stderr UI，详见 Evidence 表。

  实现期需要注意的既有约束：
  - 依赖方向只能新增 `apps/admin <- client-core, protocol, utils`；**不得**新增 `apps/server <- client-core`。同步 `AGENTS.md` 依赖表与根 `tsconfig.json` references。
  - `running` 判定用 control 连接收到 `hello`，不是「进程还在」——否则进程起来但 WS 未就绪也会被误报为 running。
  - 重启必须等前一子进程真正 `exit` 后再 spawn，否则会撞端口 8787 并共写 `history.jsonl`（对应本文件 Blockers / Risks 里「运行环境未隔离」那条）。
  - `CAICAI_ADMIN_TOKEN` 缺失时 admin 拒绝启动，不留无认证降级路径。这是个高权限面板：可写 agent 人格、可启停进程，而 agent 自身持有 `exec` 工具。
  - memory 写入复刻 runtime `daydreaming()` 的同目录临时文件 + `rename` 原子替换；乐观锁冲突即拒绝保存，不做自动合并。
  - `history.jsonl` 对 admin 严格只读，admin 侧不得存在写/截断/补写路径。

### What's Next

1. 在允许本机 127.0.0.1 监听的环境完成 feat-006 的四项运行时验收，结束前将本文件与 `feature_list.json` 标记为 `done` 或记录实际偏差。
2. 用户换到支持 kitty 协议的终端后，顺手确认一次 Shift+Enter 真能插入换行 —— 这是 feat-005 唯一未经真实按键确认的行为，代码路径已由探针验证但未在真机按过。若那时发现不工作，先读 Blockers / Risks 里的实测结论，特别是「不要打开 tmux `extended-keys`」这条反向警告。
3. 改鼠标相关代码前先读 Blockers / Risks 里消费器的现有行为约定。

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
- [ ] **当前 Codex 沙箱无法执行 admin 进程闭环**：Node/WebSocket `listen` 在 127.0.0.1 上返回 `EPERM`，child_process 的 piped stdout/stderr 也不转发；代码已完成静态检查和临时文件边界验收，需在正常本机环境补做启动、停止、重启、stderr 与大日志实测。

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
| feat-006 静态验证 | `./init.sh` | pass | 2026-08-17：typecheck、lint、format:check 全部通过。 |
| feat-006 admin build | `pnpm --filter @caicaiclaw/admin build` | pass | 2026-08-17：Next 16 webpack production build 编译、类型检查、页面生成通过；Turbopack 在本沙箱因 CSS 子进程端口权限失败，build script 固定使用 webpack。 |
| feat-006 memory/logs 边界 | 一次性 Node + `tsx` 临时目录脚本 | pass | 2026-08-17：乐观锁冲突、原子替换无 `.tmp`、符号链接逃逸拒绝、反向日志分页、损坏行号和工具结果 offset/limit 均通过。 |
| feat-006 supervisor 运行时 | 一次性 Node + `tsx` supervisor harness | **待人工验收** | 本沙箱对 127.0.0.1 listen 返回 `EPERM`，无法建立 control hello；另 child_process piped stderr 不转发，无法据此验收崩溃 stderr UI。 |
| feat-006 大日志性能 / JSONL 字节只读 | 10MB 手动验收 | **待人工验收** | 需要可监听且可运行 agent 的本机环境；本次未编造响应时间、内存或 hash 结果。 |

## Notes for Next Session

- feat-001 的 runtime harness 是一次性脚本、跑完即删，**证据不可重跑**。若要回归验证滚动与输入行为需重新搭建，要点：ink 7 的 stdin 走 `readable` 事件 + `stdin.read()`，用 `data` 事件会导致按键完全不送达而产生假阴性。
- feat-001 经两轮独立 review，14 条发现中 13 条已修且经真实 Ink 渲染复核可复现；鼠标序列消费一条只修了单 chunk 完整 SGR 的部分。用户已在此状态上验收，残留项转为 feat-005。
- `packages/client-core/src/transport.ts` 保留 `onError?: (error: unknown) => void`。若后续新增消费方沿用更窄的 `Event | Error` 回调，需先调整回调参数类型或在注入处适配，避免 strictFunctionTypes 的 TS2322。
- feat-001 ~ feat-005 全部 `done`。feat-005 是在 Shift+Enter 一项验收失败的情况下由用户决策置 `done` 的（根因为终端能力缺失，用户选择换终端而非改代码）。**换行在支持 kitty 协议的终端上从未经真实按键确认过** —— 若日后有人报"换行不工作"，先按 Blockers / Risks 里的三步探针确认终端是否支持该协议，再怀疑代码。
- **不要自行把 Ctrl+J 提升为换行键位。** 该备选已被用户明确否决，理由是不想引入第二个换行键位与额外文案维护面。
- ink 7 的 kitty 支持是 opt-in + auto 探测：`Ink.initKittyKeyboard` 在 `mode: "auto"` 下先写 `CSI ? u` 并只等 200ms，无回应即静默放弃。要判断某终端能否支持 Shift+Enter，直接在真实 pty 里发该查询看有无回应即可，比翻终端文档快。注意必须在真实 pty 中测：普通 tool shell 没有 TTY（`process.stdin.isTTY` 为 `undefined`），可用 `tmux new-session -d` 起一个 detached pane 拿到真实 pty。
- 所有 feat-003 / feat-004 / feat-005 的验收脚本都是一次性的、跑完即删，**证据不可重跑**。要回归验证需重新搭建：protocol / config 相关的脚本必须放在 `apps/server` 下跑（workspace 依赖只在消费方目录内可解析），runtime 行为脚本放在 `packages/agent-core` 下跑且**不能 import protocol**（依赖方向不允许）；假模型要真的继承 `SimpleChatModel`，用 `{invoke, bindTools}` 裸对象会让 turn 直接 `turn.failed`。
- 追加 checkpoint 的验收需要至少 4 个 committed turn：`DEFAULT_PRESERVED_TURNS = 3`，turn 数不足时 compact 不会产生 checkpoint，容易被误读成 bug。
- feat-006 已完成代码交付但未满足运行时验收完成门槛；人工验收通过后再将 feature 状态改为 `done`。
