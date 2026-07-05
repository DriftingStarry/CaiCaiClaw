# M1 Web Frontend Plan

## Goal

M1 Web is a minimal observation and input surface for the single shared
`AgentRuntime`. It is not a separate chat session and must not own agent state.

The Web UI includes only:

- Streaming chat input and assistant output.
- Agent activity display: reasoning text when available, tool calls, and tool
  results.

Out of scope for M1:

- Authentication and authorization.
- Memory browsing or editing.
- Background admin screens.
- Semantic memory, reload, multi-agent sessions, and long-term log pagination.

## Architecture

The frontend is split into UI, client state, transport, and shared domain logic:

- `apps/web`: Next.js App Router application with React, Ant Design,
  TailwindCSS, and Zustand.
- `packages/protocol`: shared WebSocket message schemas and TypeScript types.
- `packages/client-core`: React-independent reducers and domain models for chat
  and agent activity. Future TUI code should consume this package rather than
  parsing Web UI state.

The Web app connects directly to the WS server through
`NEXT_PUBLIC_CAICAI_WS_URL`, for example `ws://127.0.0.1:8787`.
To keep the displayed client identity stable across refreshes, the Web app may
append a browser-scoped anonymous `clientId` in the connection URL query, for
example `ws://127.0.0.1:8787?clientId=web-...`. The WS server treats this value
as an observational identifier only, not an authenticated user identity.

## WS Event Contract

Client messages:

- `input`: user text submitted by a client.
- `ping`: connection health check.

Server messages:

- `hello`: connection accepted and client id assigned.
  The server returns the final accepted `clientId`, which may differ from the
  requested query value if the request omits it or provides an invalid ID.
- `ack`: client request accepted by the WS server.
- `input_accepted`: user input entered the shared runtime and is visible to all
  clients.
- `agent_turn_start`: runtime started processing one or more accepted inputs.
- `assistant_message_delta`: assistant text delta for the current turn.
- `reasoning_delta`: reasoning text delta when the model/provider exposes it.
- `tool_call_start`: tool execution started.
- `tool_call_result`: tool execution finished with success or error.
- `agent_turn_done`: runtime finished the current turn.
- `error`: structured user-visible error.
- `pong`: reply to `ping`.

The UI must not invent reasoning text. If no `reasoning_delta` is received, it
shows only a generic running state.

## Client State Model

Client state is derived from server events:

- `ConnectionState`: `idle`, `connecting`, `connected`, `reconnecting`, or
  `closed`.
- `ChatMessage`: user and assistant messages, grouped by `turnId` where
  available.
- `AgentActivity`: current and recent reasoning/tool events, keyed by `turnId`
  and `toolCallId`.

Zustand stores wrap the shared reducers and expose actions to React components.
Reducers must stay free of React, DOM, Ant Design, and Next.js dependencies.

## UI Layout

Desktop:

- Left: chat transcript and composer.
- Right: agent activity timeline.

Mobile:

- Chat first, agent activity below it.

Ant Design provides layout, input, cards, tags, alerts, timeline, and collapse
components. TailwindCSS handles spacing and responsive layout only.

## Validation

Required checks after TypeScript changes:

```bash
pnpm typecheck
pnpm --filter @caicaiclaw/web typecheck
pnpm --filter @caicaiclaw/web build
```
