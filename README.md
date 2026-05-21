# ccremote

Manage Claude Code sessions with `node-pty`. Sessions persist across detaches — the PTY keeps running in a background daemon.

## Install

```bash
npm install
npm link   # makes `ccremote` available globally
```

Requires `make` + `gcc` for `node-pty` native compilation.

## Usage

```
ccremote new [name]            Create session and attach (runs `claude` by default)
ccremote new mywork --no-attach   Create without attaching
ccremote new --cmd bash        Create a bash session

ccremote list  (ls)            List all sessions
ccremote attach <id|name>  (a) Attach to a session
ccremote kill <id|name>    (k) Kill and remove a session
ccremote rename <id> <name>    Rename a session

ccremote daemon:status         Check daemon health
ccremote daemon:stop           Stop the daemon
```

`<id>` accepts the full session ID, session name, or a unique ID prefix.

**Detach from a session: `Ctrl+\`** — the session keeps running in the background.

## How it works

- A daemon process (auto-started on first use) holds all PTY instances over a Unix socket at `~/.ccremote/daemon.sock`.
- Session metadata is persisted to `~/.ccremote/sessions.json`.
- Each session keeps a 100 KB in-memory scrollback buffer shown when you re-attach.
- The daemon is automatically started if not running; stop it with `daemon:stop`.
