# ccremote

Manage Claude Code sessions with `node-pty`. Sessions persist across detaches — the PTY keeps running in a background daemon. Optionally connect the daemon to a central web server to manage sessions on multiple machines from one browser.

## Install

Requires Node.js >= 18, `make`, `gcc` (for native `node-pty`).

**On each machine running Claude sessions:**

```bash
curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash
```

Installs the `ccremote` CLI. Run `ccremote new` to start a session.

**On the machine hosting the web UI:**

```bash
curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --server
```

Builds the frontend, prompts for a password, and registers a systemd user service (`ccremote-server`) that starts on login.

**To update either machine:**

```bash
curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --update
```

**To uninstall:**

```bash
# Agentnode
curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --uninstall

# Server
curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --server --uninstall
```

Both will prompt before removing runtime data (sessions, config, server registry).

Files are downloaded to `~/.local/share/ccremote`. Override with `CCREMOTE_DIR=/your/path`.

## CLI usage

```
ccremote new [name]               Create session and attach (runs claude by default)
ccremote new mywork --no-attach   Create without attaching
ccremote new --cmd bash           Create a bash session

ccremote list  (ls)               List all sessions
ccremote attach <id|name>  (a)    Attach to a session
ccremote kill <id|name>    (k)    Kill and remove a session
ccremote rename <id> <name>       Rename a session

ccremote daemon:status            Check daemon health
ccremote daemon:stop              Stop the daemon
```

`<id>` accepts the full session ID, session name, or a unique ID prefix.

**Detach: `Ctrl+\`** — the session keeps running in the background.

## Web server (optional)

Control sessions on remote machines from a browser. The agentnode (daemon) dials out to the server — works behind NAT, no inbound ports needed on the agentnode machine.

### 1. Run the server

```bash
CCREMOTE_WEB_PASSWORD=yourpassword node server/index.js
# or: npm run server
```

Browse to `http://localhost:8080` and log in.

### 2. Register an agentnode

Click **+ Add agentnode** in the sidebar, give it a name, and copy the one-time token shown.

### 3. Configure the agentnode machine

```bash
ccremote config set-server wss://your-server-hostname
ccremote config set-token ant_...
ccremote link       # restarts daemon with new config
```

The daemon logs `linking to wss://...` on startup and the browser sidebar shows a green dot within ~1 second.

### 4. Use it

- The session list updates live when you run `ccremote new` on the agentnode machine.
- Click a session to open a browser terminal. Claude TUI redraws automatically.
- Multiple browser tabs can attach to the same session simultaneously.
- Closing the tab leaves the session running; re-opening re-attaches.

### Server env vars

| Variable | Default | Description |
|---|---|---|
| `CCREMOTE_WEB_PASSWORD` | _(required)_ | Web UI password |
| `CCREMOTE_PORT` | `8080` | Listen port |
| `CCREMOTE_HOST` | `0.0.0.0` | Listen host |

Cookie signing secret is auto-generated and persisted to `server/data/server-config.json` on first run.

### Dev mode

Starts daemon + server + Vite dev server with colour-tagged output:

```bash
npm run dev
```

Vite runs at `:5173` and proxies `/api` and `/ws` to Fastify at `:8080`.

### Build frontend

```bash
npm run build
```

Fastify then serves `web/dist/` at `/`.

## How it works

- A daemon (auto-started on first use) holds all PTY instances, reachable over `~/.ccremote/daemon.sock`.
- Session metadata persists to `~/.ccremote/sessions.json`; config (server URL + token) to `~/.ccremote/config.json`.
- Each session keeps a 100 KB scrollback buffer. On attach, the CLI sends a double resize (SIGWINCH) instead of replaying scrollback — this triggers Claude's TUI to redraw cleanly.
- If a server URL is configured, the daemon opens an outbound WebSocket to `/ws/agentnode` and tunnels all PTY traffic through it. The server routes it to any connected browser.
