# Lane: feature/tui (feat-001)

## Current State
- **Last Updated:** 2026-08-16
- **Status:** Done（已合并到 main：PR #37, merge 997dfce）

## What's Done
- `packages/client-core` 提供跨运行时 WebSocket transport、URL 构建和 timeline selector。
- `apps/tui` 提供 Ink 7 三栏界面、共享 client-core 状态归约、输入/设置/滚动/鼠标清理。滚动与输入行为经 harness 实测（见 Verification Evidence），未在真实终端验证。
- 第二轮 review 修复了滚动视口方向、ws_url/连接错误边界、函数式字素缓冲、emoji 光标、动画门控和布局挤压；SGR 鼠标消费**只修了单 chunk 完整序列这一部分**，X10 降级与跨 chunk 分片仍会泄漏（见 Blockers / Risks）。
- 根 workspace 已同步 TUI package、TypeScript reference、启动脚本、依赖方向和环境变量。

## What's In Progress
- 无。本 lane 已收尾并合并到 main。

## What's Next（移交给后续工作，不在本 lane 范围）
- 用户在真实终端执行 `pnpm server` 与 `pnpm tui` 后记录交互验收结果。
- 修 Blockers / Risks 里的鼠标序列消费缺陷（前缀式消费），这是本 lane 已知未修项。
- feat-002 承接 `apps/web` 迁移到 client-core 传输层，注意 Handoff Notes 里的 `onError` 签名必改点。

## Verification Evidence
| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Static verification | `./init.sh` | pass | 2026-08-16：harness validate、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过；保留既有 `apps/tui` touches 警告。 |
| Runtime harness | 一次性脚本（写在 `/tmp`，跑完即删，**不可重跑**） | pass | 真实 Ink 7.0.6 渲染 + 真实 `parse-keypress` 输入管道。滚动：`maxOffset > 0` 且恒等于「内容高 − 视口高」，offset 变化时可见行数不变而内容不同（证明是裁剪而非 flex-shrink 抽稀）；具体数值随终端 rows 与内容条数变化，独立复核在 rows=24 / 60 条消息下测得 `viewportHeight=16, maxOffset=44`。单 chunk 完整 SGR 鼠标序列不进输入缓冲，64/65 正常滚动。`abcdef` cursor=3 连按三次退格得 `def/cursor=0`。`a😀b` 退格得 `a😀`，无孤立代理对。stickBottom 三态（贴底跟随 / 上滚不抢焦点 / 滚回底恢复）实测成立。 |

## Blockers / Risks
- **鼠标序列消费不完整（已知缺陷，本 lane 未修）**：`apps/tui/src/components/App.tsx` 的分发器用全量锚定正则 `/^\[<\d+;\d+;\d+[Mm]$/` 判定鼠标上报，只覆盖「单个 chunk 内完整投递的 SGR(1006)」。两条泄漏路径经独立复核实测确认：① 终端忽略 `?1006h` 而降级到 X10 格式（`\x1b[M` + 三字节）时不匹配，序列会被当普通文本插进输入框，设置面板打开时会污染 ws_url；② SGR 序列跨 chunk 分片（两段间隔 ≥25ms 越过 ink 的 escape flush 窗口）时被拆成 `[<0;1` 与 `0;5M`，两段均不匹配，整串落入缓冲。修法：改成前缀式消费——`^\[[<M]` 起头即视为鼠标流整块丢弃，仅在完整匹配且 button 为 64/65 时滚动；或维持一个「序列组装中」标志跨 chunk 补全。
- reasoning 在 client-core 中每轮累加为一个字符串，无法还原 think → tool → think 的真实交错；当前每轮只呈现工具调用前的一个 thinking 块。要还原需扩展 `packages/protocol`。
- 输入缓冲按**码点**（`Array.from`）而非字素簇切分：ZWJ 组合 emoji（如 `👨‍👩‍👧`）退格只删掉最后一个码点，组合符 `é`（e + U+0301）退格只去掉重音。纯显示问题，无崩溃、无孤立代理对，BMP 与单码点 emoji 场景正确。彻底修需改用 `Intl.Segmenter` 统一封装字素切分供 buffer 与 Composer 共用。
- 交互式手动验收尚未执行，需用户在真实终端操作确认备用屏、kitty Shift+Enter、真实鼠标滚轮和双端共享 runtime。所有运行时验证都在假 TTY 的 harness 里完成，**没有任何一项在真实终端跑过**。

## Decisions Made
- 本 lane 只写入自己的分片，不修改根级 `feature_list.json`、`README.md` 或其他 lane。
- 传输层已提升到 client-core，Web 侧迁移由 feat-002 承接。
- 换行只做 Shift+Enter，需 kitty 键盘协议。
- `ws_url` 仅进程内生效，不落盘。

## Handoff Notes
- 静态验证与 harness 运行时验证已完成；真实终端手动验收待用户执行。若发现交互问题，从本 lane 状态与本文件继续。
- 两轮独立 review 的结论：14 条发现中 13 条已修且经真实 Ink 渲染复核可复现，鼠标序列消费一条只修了单 chunk 完整 SGR 的部分（详见 Blockers / Risks）。用户已在此状态上验收，残留项作为后续工作。
- Runtime harness 是一次性脚本、跑完即删，证据不可重跑；若后续要回归验证滚动与输入行为，需重新搭建（要点：ink 7 的 stdin 走 `readable` 事件 + `stdin.read()`，用 `data` 事件会导致按键完全不送达而产生假阴性）。
- `packages/client-core/src/transport.ts` 保留 `onError?: (error: unknown) => void`；feat-002 迁移 `apps/web` 时，若沿用现有窄化的 `Event | Error` 回调，需要先调整回调参数类型或在注入处适配，避免 strictFunctionTypes 的 TS2322。
