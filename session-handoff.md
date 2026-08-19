# Session Handoff

仅在工作未完成、受阻或需要较多上下文才能续接时更新本文件。日常当前状态以 `progress.md` 为准。

本文件不是历史归档：已完成 feature 的证据写入 `feature_list.json` 的 `evidence` 与 `progress.md`，不要在这里追加 `## feat-0XX Handoff` 小节。交接结束后把 Status 改回「无活动交接」并清空各节。

## Current Objective

- **Status:** feat-014（M3-6 QQ 开放平台渠道）代码完成，等待用户提供沙箱凭据后做真实验收
- **Goal:** 完成 feat-014 最后一条 doneCriteria：QQ 沙箱真实手动验收
- **Branch / commit:** main / `c3ef25e`
- **Last Updated:** 2026-08-19

## Completed This Session

- feat-014 全部代码单元（见 `progress.md` 的「feat-014 实施进度」逐单元提交与 probe 证据）。
- 顺带修掉三处此前无人踩到的断路：normalize 要求 `author.id` 必填会拒收全部真实事件；`apps/server` 从不填充 `toolPermissions` 使所有 MCP 工具实际停留在默认 L3；L1 闸门后的成品文本没有出口，渠道回复无法离开核心。

## Verification Evidence

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| 全量校验 | `./init.sh` | 通过 | 每个提交边界各跑一次 |
| adapter 双面组装 | 临时 probe（真实子进程 + 假网关/假 server） | 通过 | intents=1<<25、role 先声明、四个 MCP 工具可 tools/list、stdout 只有 JSON-RPC 帧、无凭据泄露、SIGTERM 优雅退出 |
| 权限分级传导 | 临时 probe（真实 MCP client + runtime） | 通过 | L0/L1/L2/L3 全部解析；运维配置压过 adapter 自报；未声明默认 L3；工具集替换后旧声明清空 |
| 输出路由端到端 | 临时 probe（真实子进程 + 假平台） | 通过 | 回复带 msg_id、msg_seq 1→2、窗口不可用不降级主动消息 |
| QQ 沙箱真实往返 | - | **未执行** | 缺凭据，见 Blockers |

## Files Changed

- 见 `git log ab1b676..c3ef25e`（本次续接段）与 `progress.md` 的逐单元提交清单。

## Decisions Made

- **权限分级由 adapter 自报、运维配置优先**：adapter 在 `tools/list` 用 `_meta` 的 `com.caicaiclaw/permission` 声明级别，避免 server 硬编码 QQ 工具名；但运维显式 `toolPermissions` 压过自报，防止 adapter 用元数据自行提权。未声明仍默认 L3。
- **被动回复走 `outbound_reply` 而非让 adapter 拼 delta**：L1 闸门在流式结束后才评估，adapter 自行拼接 `assistant_delta` 会发出未裁剪原文，因此由 runtime 显式下发闸门后的成品文本。
- **窗口不可用时绝不降级为主动消息**：主动消息是 L2 且受平台额度约束，静默降级会绕过权限分级；一律只记明确失败日志。

## Blockers / Risks

- **阻塞**：feat-014 最后一条 doneCriteria 需要 QQ 机器人 **AppID / AppSecret** 与沙箱环境（开放平台需已配置群聊 @ 与单聊权限）。所有代码路径目前只经过假网关 / 假平台 / 注入时钟验证。
- **风险**：`apps/adapter-qq/src/api-client.ts` 的 `QQ_ERROR_CODE_CATEGORIES` 刻意留空——平台错误码到失败分类（`window_expired` / `reply_quota_exhausted` / `rate_limited` / `auth`）的映射需要真实沙箱调用校准，否则这些失败目前都会落到笼统的 `platform` 分类。

## Next Session Startup

完整启动路径以 `AGENTS.md` 的 Startup Workflow 为准（那里第 4 步会把你带到本文件），此处只写本次交接特有的补充步骤：

1. 先问用户是否已有 QQ 沙箱凭据。有则把 `QQ_BOT_APP_ID` / `QQ_BOT_CLIENT_SECRET` 写进 `.env`（不要提交），按 `progress.md` 提交计划的单元 11 执行验收，然后把 feat-014 置为 `done`。
2. 没有凭据则**不要**把 feat-014 标成 done，也不要为了绕过验收去改 doneCriteria。

## Recommended Next Step

- 拿到凭据后执行 feat-014 单元 11 验收；仍无凭据时向用户确认是否允许先开工 feat-015（M3-7 后台队列、adapter 视图与调试入口）——默认遵守一次只做一个 feature，不擅自并行。
