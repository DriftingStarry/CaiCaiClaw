# Lane: feature/web-shared-transport (feat-002)

## Current State
- **Last Updated:** 2026-08-16
- **Status:** Done

## What's Done
- 删除 `apps/web` 自带 WebSocket adapter，store 改用 `@caicaiclaw/client-core` transport。
- 保留 Web 层 `NEXT_PUBLIC_CAICAI_WS_URL` 配置、浏览器原生 WebSocket 工厂与 `clientIdentity` 持久化。
- 更新 `apps/web/README.md` 的目录与传输层职责说明。

## What's In Progress
- 等待集成到 `main`；本 lane 不修改根级 `feature_list.json`。

## What's Next
- 集成前从 `origin/main...feature/web-shared-transport` 复核提交 `be131bb`。

## Verification Evidence
| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Static verification | `./init.sh` | pass | harness validate、typecheck、lint、format:check 全部通过。 |
| Web build | `pnpm --filter @caicaiclaw/web build` | pass | Next production build 编译、类型检查和静态页面生成通过。 |
| Runtime acceptance | 一次性 `tsx` fake browser/socket harness | pass | URL/clientId 恢复、连接、hello/message、input 序列化、重连退避、显式断开、协议版本不匹配主动断开。 |

## Blockers / Risks
- 无已确认的代码审查 finding；真实浏览器/真实 server 端到端手动验收仍需集成环境执行。

## Decisions Made
- 本 lane 只写入自己的分片和 `apps/web`，不修改根级 `feature_list.json`、`README.md` 或其他 lane。
- 采用删除 Web adapter、复用 client-core transport、由 store 注入浏览器 WebSocket 工厂的主方案；无新增依赖或公共协议变更。

## Handoff Notes
- lane 已完成，集成时将本分支 rebase/合并到 `main` 后重跑 `./init.sh`。
