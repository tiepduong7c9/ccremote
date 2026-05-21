# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ccremote** is an npm workspace monorepo with three packages:

- **`agentnode/`** — CLI + daemon that manages Claude Code sessions with persistent PTY instances. Sessions survive detach and daemon restarts. Optionally tunnels to a central server via outbound WebSocket.
- **`server/`** — Fastify backend. Accepts inbound WebSocket connections from agentnodes, serves the React frontend, exposes HTTP+WS APIs to browsers.
- **`web/`** — Vite + React + TypeScript + Tailwind + DaisyUI + xterm.js frontend. Lists agentnodes, sessions, and attaches to any session in a browser terminal.

## Development Commands

```bash
npm install                        # Install all workspace deps (compiles node-pty — needs make + gcc)
cd agentnode && npm link           # Install 'ccremote' globally for local testing
npm run dev                        # Start daemon + server + Vite dev server concurrently
npm run build                      # Build web/dist/ (Fastify then serves it at /)

# Individual pieces
npm run daemon                     # node agentnode/src/daemon.js
npm run server                     # node server/index.js
npm --workspace @ccremote/web run dev   # Vite at :5173, proxies /api and /ws to :8080
```

**Requirements**: Node.js >= 18, `make`, `gcc` (for `node-pty` native compilation).

No test runner or linter is configured. Main test workflow:

```bash
ccremote new          # Create a session
ccremote list         # Verify it appears
ccremote attach <id>  # Attach and test interactivity
# Ctrl+\ to detach
```

## Monorepo layout

```
ccremote/
├── package.json                  workspace root (no code)
├── scripts/dev.js                concurrent dev launcher
│
├── agentnode/                    package: ccremote (CLI + daemon)
│   ├── bin/ccremote.js           Commander CLI — all user-facing commands
│   └── src/
│       ├── daemon.js             Long-running Unix-socket server
│       ├── session-manager.js    Owns node-pty instances + scrollback
│       ├── server-link.js        Outbound WS tunnel to central server
│       ├── config.js             Read/write ~/.ccremote/config.json
│       ├── client.js             EventEmitter over Unix socket
│       ├── protocol.js           NDJSON encode/decode
│       ├── ensure-daemon.js      Auto-start daemon if not running
│       └── constants.js          STATE_DIR, SOCKET_PATH, PID_FILE, etc.
│
├── server/
│   ├── index.js                  Fastify bootstrap
│   ├── config.js                 Env vars + cookie secret persistence
│   ├── auth.js                   Cookie auth + rate limiter
│   ├── store.js                  AgentnodeStore — JSON file persistence
│   ├── agentnode-hub.js          Live agentnode connections (EventEmitter)
│   ├── browser-hub.js            Live browser connections + aid routing table
│   ├── routes/auth.js            POST /api/login, /api/logout, GET /api/me
│   ├── routes/agentnodes.js      CRUD /api/agentnodes
│   ├── ws/agentnode-ws.js        GET /ws/agentnode — agentnode WS handler
│   └── ws/browser-ws.js          GET /ws/browser — browser WS handler
│
└── web/
    ├── src/
    │   ├── main.tsx, App.tsx
    │   ├── store.ts              Zustand: auth, registry, terminals (3 separate stores)
    │   ├── ws.ts                 BrowserSocket singleton + xterm hot-path
    │   ├── lib/protocol.ts       TypeScript envelope types
    │   └── components/
    │       ├── Terminal.tsx      xterm.js mount, input/resize/scrollback
    │       ├── AgentnodeSidebar.tsx
    │       ├── SessionList.tsx
    │       ├── LoginScreen.tsx
    │       └── ThemeToggle.tsx   DaisyUI light/dark, persisted to localStorage
    └── vite.config.ts            Proxies /api and /ws to :8080 in dev
```

**State directory**: `~/.ccremote/` — holds `daemon.sock`, `daemon.pid`, `sessions.json`, `config.json`.

## Architecture

### Agentnode side

```
CLI (agentnode/bin/ccremote.js)
  └─ getClient() auto-starts daemon (agentnode/src/ensure-daemon.js)
  └─ Sends NDJSON over Unix socket (~/.ccremote/daemon.sock)

Daemon (agentnode/src/daemon.js)
  └─ SessionManager — owns all node-pty instances
  └─ ServerLink (optional) — outbound WS to server /ws/agentnode
  └─ Routes Unix-socket messages to SessionManager
  └─ Pushes 'data' and 'session_exit' to attached clients
```

### Server side

```
Browser  ──WS──▶  BrowserHub  ──aid routing──▶  AgentnodeHub  ──WS──▶  Agentnode daemon
                      │                               │
                 attachments Map               online Map
                 (aid → {ws, anid, sid})       (anid → {ws, sessions})
```

`aid` (attachment ID) is allocated by the browser. Every PTY data frame flowing from an agentnode carries an `aid`; the server looks up `attachments[aid].ws` and forwards it directly — no fan-out scan.

### Key modules

- **[agentnode/src/server-link.js](agentnode/src/server-link.js)** — outbound WS client. Handles the full agentnode-side protocol: `attach`, `detach`, `input`, `resize`, `create`, `kill`, `rename`, `list`, `ping`. Reconnects with exponential backoff (1s → 30s + jitter); stops after 3 consecutive `rejected` responses. Monkey-patches `manager._persist` to push session-list updates to the server on every state change.
- **[server/agentnode-hub.js](server/agentnode-hub.js)** — fan-in from all connected agentnodes. Emits `online`, `offline`, `sessions`, `relay` events that `BrowserHub` subscribes to.
- **[server/browser-hub.js](server/browser-hub.js)** — fan-out to browsers. Maintains `attachments: Map<aid, {ws, anid, sid}>`. Routes relay messages by `aid`; broadcasts lifecycle events to all browsers.
- **[web/src/ws.ts](web/src/ws.ts)** — singleton `BrowserSocket`. Hot-path: PTY `data` frames call `term.write(atob(data))` directly, bypassing React. All other message types update Zustand.
- **[web/src/components/Terminal.tsx](web/src/components/Terminal.tsx)** — xterm.js mount. Sends `attach` on mount, `detach` on unmount. Mirrors the double-SIGWINCH redraw trick from the CLI after `attached`.

### Session lifecycle & state

Sessions have three states: `running`, `suspended`, `exited`.

- `suspended` — PTY has exited but session is resumable. Resume uses `--resume <claudeSessionId>` (UUID pinned at creation), falling back to `--continue`.
- `exited` — Clean exit (code 0); not resumable.
- Sessions are identified by nanoid(8) ID or an optional user-provided name; `attach/kill/rename` accept ID, name, or unique prefix.

### Scrollback strategy

The 100 KB scrollback buffer is **not replayed on attach** to Claude Code sessions — sending raw scrollback bytes corrupts the Claude TUI. Instead the CLI (and browser terminal) sends a double SIGWINCH: resize to rows+1, then back to the real rows 50 ms later. This forces Claude's Ink UI to re-render from scratch.

See [agentnode/bin/ccremote.js:302-313](agentnode/bin/ccremote.js#L302-L313) and [web/src/components/Terminal.tsx](web/src/components/Terminal.tsx).

### Protocol

All messages are NDJSON on every transport (Unix socket, agentnode WS, browser WS). Two envelope fields are added for the network layer: `aid` (attachment ID, browser-allocated) and `anid` (agentnode ID, server-assigned). Existing `sid` = session ID.

Auth:
- Agentnode → server: `Authorization: Bearer <token>` on WS upgrade
- Browser → server: signed `ccremote_session` cookie (set by `POST /api/login`)

### Server config

| Env var | Default | |
|---|---|---|
| `CCREMOTE_WEB_PASSWORD` | _(required)_ | Web UI password |
| `CCREMOTE_PORT` | `8080` | Listen port |
| `CCREMOTE_HOST` | `0.0.0.0` | Listen host |

Cookie signing secret is auto-generated and saved to `server/data/server-config.json`.
Agentnode registry is persisted to `server/data/agentnodes.json` (both gitignored).
