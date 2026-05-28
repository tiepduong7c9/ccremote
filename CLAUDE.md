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

Additional agentnode source files:
- `agentnode/src/workspace-manager.js` — Git repo + worktree management; persists to `repos.json`
- `agentnode/src/hook.js` — Claude Code hook handler; reports `claudeStatus` to daemon

Additional web components (not exhaustive):
- `web/src/git-store.ts` — Zustand store: git status, diff, branches, worktrees
- `web/src/components/RightPanel.tsx` — Collapsible side panel (Git Changes + Files tabs)
- `web/src/components/FileTreePanel.tsx` — Lazy-loaded file browser (expands on demand)
- `web/src/components/FileModal.tsx` — Monaco editor + markdown preview for file editing
- `web/src/components/FileSearchModal.tsx` — Fuzzy file search (Cmd/Ctrl+P)
- `web/src/components/GitChangesTab.tsx` — Git status, diff, revert, branch, worktrees
- `web/src/components/DiffModal.tsx` — Monaco DiffEditor side-by-side comparison

**State directory**: `~/.ccremote/` — holds `daemon.sock`, `daemon.pid`, `sessions.json`, `config.json`, `repos.json`.

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
- **[agentnode/src/workspace-manager.js](agentnode/src/workspace-manager.js)** — manages git repos and worktrees per agentnode. Persists repo list to `~/.ccremote/repos.json`. Handles git operations (status, diff, pull, revert, log, branches, checkout, clone, worktree add/remove) by spawning `git` subprocesses.
- **[agentnode/src/hook.js](agentnode/src/hook.js)** — tiny Claude Code hook handler. Reads hook event from stdin (JSON), maps `PreToolUse`/`PostToolUse` → `working` and `Stop` → `idle` (with "asking" detection), writes `claude_status` message to the daemon socket. Installed automatically at session creation as `.claude/settings.local.json` in the session cwd.

### Request-response routing for non-PTY operations

Git and file operations use a request-response pattern layered on top of the existing relay:

1. Browser sends a message (e.g. `git_status`, `file_read`) with a unique `aid`
2. Server stores `{ ws }` in `BrowserHub._gitRequests.get(aid)`
3. Server relays to the agentnode; agentnode responds with the same `aid` and a `_result` suffix (e.g. `git_status_result`)
4. Server routes the response back to the originating browser tab by `aid`

This avoids broadcasting large diffs/file contents to all connected browsers.

### Session lifecycle & state

Sessions have three states: `running`, `suspended`, `exited`.

- `suspended` — PTY has exited but session is resumable. Resume uses `--resume <claudeSessionId>` (UUID pinned at creation), falling back to `--continue`.
- `exited` — Clean exit (code 0); not resumable.
- Sessions are identified by nanoid(8) ID or an optional user-provided name; `attach/kill/rename` accept ID, name, or unique prefix.

Additional session fields (beyond id/name/state):
- `claudeStatus` — `'idle'` | `'working'` | `'waiting'`; updated by `hook.js` and broadcast to browsers
- `parentSid` — set on "bash tab" sessions spawned inside another session; these are transient
- `transient` — if true, session is not restored on daemon restart (used for bash tabs)

Claude Code hooks are automatically installed at session creation: `SessionManager` writes `.claude/settings.local.json` in the session cwd pointing `hook.js` as a `UserPromptSubmit` + `PostToolUse` + `Stop` hook.

### Scrollback strategy

The 100 KB scrollback buffer is **not replayed on attach** to Claude Code sessions — sending raw scrollback bytes corrupts the Claude TUI. Instead the CLI (and browser terminal) sends a double SIGWINCH: resize to rows+1, then back to the real rows 50 ms later. This forces Claude's Ink UI to re-render from scratch.

See [agentnode/bin/ccremote.js:302-313](agentnode/bin/ccremote.js#L302-L313) and [web/src/components/Terminal.tsx](web/src/components/Terminal.tsx).

### Protocol

All messages are NDJSON on every transport (Unix socket, agentnode WS, browser WS). Two envelope fields are added for the network layer: `aid` (attachment ID, browser-allocated) and `anid` (agentnode ID, server-assigned). Existing `sid` = session ID.

Beyond the PTY messages (`attach`, `detach`, `input`, `resize`, `data`, `attached`, `session_exit`), the protocol includes:

- **Git**: `git_repo_list/add/remove`, `git_clone`, `git_status`, `git_diff`, `git_pull`, `git_revert`, `git_log`, `git_list_branches`, `git_checkout`, `git_worktree_add/remove` — each has a corresponding `_result` response
- **Files**: `file_list`, `file_list_dir`, `file_read`, `file_write`, `file_delete`, `file_download`, `file_upload_chunk` — file transfers use chunked messages (`file_download_chunk` with `index`/`total` fields); uploads use 3 MB chunks
- **Metadata**: `claude_md_read` / `claude_md_write` (reads/writes `.claude/settings.json` in session cwd)

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

HTTP routes: `GET /api/info` returns `{ serverUrl }` — used by the browser to construct the `ccremote link` command shown in AddAgentnodeModal.

### Frontend state

Three separate Zustand stores plus a git store:
- `useAuthStore` — login state
- `useRegistryStore` — agentnode list, selected agentnode/session
- `useTerminalStore` — per-session xterm instances
- `useGitStore` ([web/src/git-store.ts](web/src/git-store.ts)) — git status/diff per session, worktree list, branch list

The RightPanel (288 px, collapsible, state persisted to localStorage) renders either the **Changes** tab (git status + diff) or the **Files** tab (file tree browser) depending on the active tab. File editing opens a `FileModal` with Monaco Editor; markdown files show a preview toggle. File search is globally bound to Cmd/Ctrl+P and opens `FileSearchModal`.
