# `@caicaiclaw/web`

`apps/web` 是 CaiCaiClaw 的 M1 Web observer。它不是独立会话，也不持有 agent runtime 状态；它只是共享 `AgentRuntime` 的一个观察和输入界面。

## 目标

- 展示共享 runtime 的聊天消息流
- 展示 agent activity，包括 reasoning、tool call 和 tool result
- 提供一个最小输入面板，把用户输入经 WebSocket 发给同一个 runtime

当前不包含：

- 登录、鉴权、用户体系
- 独立 chat session
- 记忆管理后台
- 语义检索、分页历史、管理端配置

## 技术栈

- Next.js App Router
- React 19
- Ant Design 6
- TailwindCSS 4
- Zustand
- `@caicaiclaw/protocol`
- `@caicaiclaw/client-core`

## 本地运行

先启动仓库根目录下的 WebSocket server，再启动 Web：

```bash
pnpm --filter @caicaiclaw/web dev
```

默认连接地址：

```text
ws://127.0.0.1:8787
```

可通过环境变量覆盖：

```bash
NEXT_PUBLIC_CAICAI_WS_URL=ws://127.0.0.1:8787
```

## 验证

修改 Web 代码后，至少执行：

```bash
pnpm typecheck
pnpm --filter @caicaiclaw/web build
```

## 目录结构

```text
apps/web
├── app/                     # Next.js App Router 入口
├── src/components/         # UI 组件
├── src/stores/             # Zustand store，封装 shared reducers
└── src/adapters/ws/        # WebSocket transport 和 browser identity
```

模块职责：

- `app/page.tsx`: 页面入口，渲染 `ChatShell`
- `src/components/ChatShell.tsx`: 页面骨架，组合 chat、activity、connection badge
- `src/stores/useAgentClientStore.ts`: 连接 lifecycle、发送输入、接收 server message
- `src/adapters/ws/wsClient.ts`: 浏览器 WebSocket 封装
- `src/adapters/ws/config.ts`: WS URL 配置与 query 拼装
- `src/adapters/ws/clientIdentity.ts`: 浏览器匿名 `clientId` 持久化

## 状态模型

Web UI 不自己发明业务状态，界面状态由服务器事件驱动。

- `@caicaiclaw/client-core` 提供 `ClientState`、reducer 和 activity/message 模型
- `useAgentClientStore` 只做 transport 层接线，不承载协议解释之外的核心业务逻辑
- React 组件只消费 store 状态，不直接处理协议消息

当前连接状态包括：

- `idle`
- `connecting`
- `connected`
- `reconnecting`
- `closed`

## WebSocket 协议约定

共享协议定义在 `@caicaiclaw/protocol`。

客户端发送：

- `input`
- `ping`

服务端接收后可能返回：

- `hello`
- `ack`
- `input_accepted`
- `agent_turn_start`
- `assistant_message_delta`
- `reasoning_delta`
- `tool_call_start`
- `tool_call_result`
- `agent_turn_done`
- `error`
- `pong`

`hello.clientId` 是服务端最终确认的 client identity，界面显示值以它为准。

## 稳定 `clientId`

Web 端会在浏览器本地持久化匿名 `clientId`，用于在刷新页面后保持同一个观察者身份。

- 存储位置：`localStorage["caicaiclaw.clientId"]`
- 首次访问时生成：`web-${crypto.randomUUID()}`
- 建立 WS 连接时追加到 URL query：`?clientId=web-...`
- 服务端会校验该值；缺失或非法时会回退到临时 `client-N`
- 收到 `hello` 后，前端会把服务端确认的最终 `clientId` 回写到本地存储

这个 `clientId` 仅用于观察、日志和 source 标记，不是安全身份，也不能作为权限依据。

## UI 布局

- Desktop: 左侧 chat，右侧 activity
- Mobile: chat 在前，activity 在后

当前页面主要由三部分组成：

- `ConnectionBadge`: 显示 WS 连接状态和当前 `clientId`
- `ChatMessageList` + `ChatComposer`: 展示消息并发送输入
- `AgentActivityPanel`: 展示 reasoning 和工具调用时间线
