'use strict';

// Drives a Claude Code session over the Agent Client Protocol (ACP) instead of
// a raw PTY. Spawns the @agentclientprotocol/claude-agent-acp adapter as a
// stdio subprocess, speaks JSON-RPC to it via @agentclientprotocol/sdk's
// ClientSideConnection, and surfaces structured events to listeners using the
// same listener contract the PTY path uses (so SessionManager can treat both
// kinds of session alike).
//
// Events pushed to listeners (and replayed from history on attach):
//   { type: 'acp_user', blocks }                 — echo of the user's own prompt
//   { type: 'acp_update', update }               — raw ACP session/update payload
//   { type: 'acp_permission', requestId, request, resolved? } — pending tool permission
//   { type: 'acp_stop', stopReason }             — a prompt turn finished
//   { type: 'acp_status', claudeStatus }         — derived status change (not stored)
//   { type: 'acp_error', message }               — adapter/turn error
//   { type: 'exit', code }                       — adapter subprocess exited

const { spawn } = require('child_process');
const { Writable, Readable } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nanoid } = require('nanoid');

const MAX_HISTORY = 5000; // cap retained thread events for replay

// The SDK is ESM-only; agentnode is CommonJS. Load it lazily via dynamic import.
let _sdkPromise = null;
function loadSdk() {
  if (!_sdkPromise) _sdkPromise = import('@agentclientprotocol/sdk');
  return _sdkPromise;
}

// Absolute path to the adapter's entry module, resolved from our dependency.
function adapterEntry() {
  const pkgJson = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  return path.join(path.dirname(pkgJson), 'dist', 'index.js');
}

class AcpSession {
  constructor({ cwd, env }) {
    this.cwd = cwd;
    this._env = env || process.env;
    this.listeners = new Set();      // shared with the SessionManager session record
    this.history = [];               // ordered thread events for replay on attach
    this.claudeStatus = undefined;   // undefined = idle/never-prompted (green), like PTY
    this.acpSessionId = null;
    this.modeState = null;           // { currentModeId, availableModes:[{id,name,description}] }
    this.alive = false;

    this._conn = null;
    this._child = null;
    this._ready = null;              // resolves once initialize + new/loadSession done
    this._loadSupported = false;
    this._pending = new Map();       // requestId -> resolve(outcome)
    this._seq = 0;                   // monotonic id per stored event (browser dedupes on it)
  }

  // Spawn the adapter and establish the session. Returns the ACP sessionId.
  // Idempotent-ish: callers should await ready() rather than calling twice.
  start({ resumeSessionId } = {}) {
    if (this._ready) return this._ready;
    this._ready = this._start({ resumeSessionId });
    return this._ready;
  }

  ready() {
    return this._ready || Promise.reject(new Error('ACP session not started'));
  }

  async _start({ resumeSessionId }) {
    const { ClientSideConnection, ndJsonStream } = await loadSdk();

    const child = spawn(process.execPath, [adapterEntry()], {
      cwd: this.cwd,
      env: this._env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this._child = child;
    this.alive = true;

    child.stderr.on('data', (d) => process.stderr.write(`[acp ${this.acpSessionId || '?'}] ${d}`));
    child.on('exit', (code) => {
      this.alive = false;
      this._emit({ type: 'exit', code: code == null ? 0 : code });
      this.listeners.clear();
      // Reject any in-flight permission prompts so the adapter side unblocks.
      for (const [, fn] of this._pending) fn({ outcome: { outcome: 'cancelled' } });
      this._pending.clear();
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout),
    );

    const client = {
      sessionUpdate: async (params) => { this._onUpdate(params); },
      requestPermission: async (params) => this._onPermission(params),
      // fs/* and terminal/* intentionally omitted — we do not advertise those
      // capabilities, so the Claude SDK runs file edits and bash internally and
      // reports them to us as tool_call updates.
    };

    this._conn = new ClientSideConnection(() => client, stream);

    const init = await this._conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'ccremote', version: require('../package.json').version },
    });
    this._loadSupported = !!(init.agentCapabilities && init.agentCapabilities.loadSession);

    if (resumeSessionId && this._loadSupported) {
      this.acpSessionId = resumeSessionId;
      const res = await this._conn.loadSession({ sessionId: resumeSessionId, cwd: this.cwd, mcpServers: [] });
      if (res && res.modes) this.modeState = res.modes;
    } else {
      const res = await this._conn.newSession({ cwd: this.cwd, mcpServers: [] });
      this.acpSessionId = res.sessionId;
      if (res.modes) this.modeState = res.modes;
    }
    this._emitMode();
    return this.acpSessionId;
  }

  _emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch (_) {}
    }
  }

  _pushHistory(item) {
    // Tag every stored event with a monotonic sequence id. The same event is
    // fanned out to every attached browser; keying dedup on seq means multiple
    // attachments to one session never double-render the thread.
    if (item.seq === undefined) item.seq = this._seq++;
    this.history.push(item);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }

  _setStatus(status) {
    if (this.claudeStatus === status) return;
    this.claudeStatus = status;
    this._emit({ type: 'acp_status', claudeStatus: status });
  }

  _emitMode() {
    this._emit({ type: 'acp_mode', modeState: this.modeState });
  }

  _onUpdate(params) {
    const update = params.update;
    // Mode changes (incl. ones the agent makes autonomously) update state and
    // are surfaced as a transient acp_mode event rather than a thread entry.
    if (update && update.sessionUpdate === 'current_mode_update') {
      if (this.modeState) this.modeState.currentModeId = update.currentModeId;
      this._emitMode();
      return;
    }
    const item = { type: 'acp_update', update };
    this._pushHistory(item);
    this._emit(item);
  }

  async setMode(modeId) {
    await this.ready();
    if (!this._conn || !this.acpSessionId) return;
    try {
      await this._conn.setSessionMode({ sessionId: this.acpSessionId, modeId });
      if (this.modeState) this.modeState.currentModeId = modeId;
      this._emitMode();
    } catch (err) {
      this._emit({ type: 'acp_error', message: `Failed to set mode: ${err && err.message ? err.message : err}` });
    }
  }

  _onPermission(params) {
    const requestId = nanoid(8);
    const item = { type: 'acp_permission', requestId, request: params };
    this._pushHistory(item);
    this._setStatus('waiting');
    this._emit(item);
    return new Promise((resolve) => {
      this._pending.set(requestId, resolve);
    });
  }

  // Called when the browser answers a permission prompt. optionId === null
  // (or undefined) means cancelled.
  resolvePermission(requestId, optionId) {
    const fn = this._pending.get(requestId);
    if (!fn) return;
    this._pending.delete(requestId);
    // Mark resolved in history so a re-attach doesn't render a live prompt again.
    for (const h of this.history) {
      if (h.type === 'acp_permission' && h.requestId === requestId) {
        h.resolved = optionId || '__cancelled__';
      }
    }
    if (optionId) fn({ outcome: { outcome: 'selected', optionId } });
    else fn({ outcome: { outcome: 'cancelled' } });
    // Back to working; the turn continues. If the turn was actually finished the
    // next prompt result will flip us to idle.
    this._setStatus('working');
  }

  // blocks: ACP ContentBlock[] (e.g. [{ type: 'text', text: '...' }])
  async prompt(blocks) {
    await this.ready();
    if (!this._conn || !this.acpSessionId) throw new Error('ACP session not ready');

    const userItem = { type: 'acp_user', blocks };
    this._pushHistory(userItem);
    this._emit(userItem);

    this._setStatus('working');
    try {
      const res = await this._conn.prompt({ sessionId: this.acpSessionId, prompt: blocks });
      const stop = { type: 'acp_stop', stopReason: res.stopReason };
      this._pushHistory(stop);
      this._emit(stop);
      this._setStatus('idle');
      return res;
    } catch (err) {
      const errItem = { type: 'acp_error', message: err && err.message ? err.message : String(err) };
      this._pushHistory(errItem);
      this._emit(errItem);
      this._setStatus('idle');
      throw err;
    }
  }

  cancel() {
    if (this._conn && this.acpSessionId) {
      Promise.resolve(this._conn.cancel({ sessionId: this.acpSessionId })).catch(() => {});
    }
  }

  // ── Conversation management (Claude-style new / resume) ───────────────────
  // Clears the live thread and tells listeners to start fresh.
  _resetThread() {
    this.history = [];
    this._seq = 0;
    this.claudeStatus = undefined;
    this._emit({ type: 'acp_reset', acpSessionId: this.acpSessionId });
  }

  // Start a brand new conversation in the same cwd (like running `claude`).
  async newConversation() {
    await this.ready();
    if (!this._conn) return;
    const res = await this._conn.newSession({ cwd: this.cwd, mcpServers: [] });
    this.acpSessionId = res.sessionId;
    if (res.modes) this.modeState = res.modes;
    this._resetThread();
    this._emitMode();
  }

  // Resume a prior conversation by id (like `claude --resume`); the adapter
  // streams the whole conversation back, which rebuilds the thread.
  async resumeConversation(sessionId) {
    await this.ready();
    if (!this._conn) return;
    this.acpSessionId = sessionId;
    this._resetThread();
    try {
      const res = await this._conn.loadSession({ sessionId, cwd: this.cwd, mcpServers: [] });
      if (res && res.modes) { this.modeState = res.modes; this._emitMode(); }
    } catch (err) {
      this._emit({ type: 'acp_error', message: `Failed to resume conversation: ${err && err.message ? err.message : err}` });
    }
  }

  // Claude stores per-project conversation logs under ~/.claude/projects/<enc cwd>.
  _projectDir() {
    const enc = this.cwd.replace(/[^a-zA-Z0-9]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', enc);
  }

  async listConversations() {
    const dir = this._projectDir();
    let files;
    try { files = await fs.promises.readdir(dir); } catch (_) { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      let stat;
      try { stat = await fs.promises.stat(full); } catch (_) { continue; }
      if (!stat.size) continue;
      out.push({ sessionId: f.replace(/\.jsonl$/, ''), title: await this._readTitle(full), mtime: stat.mtimeMs });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  // Read just the head of a log to derive a human title (first real user line).
  async _readTitle(file) {
    let fd;
    try {
      fd = await fs.promises.open(file, 'r');
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      const text = buf.slice(0, bytesRead).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch (_) { continue; }
        if (o.type === 'summary' && o.summary) return String(o.summary).slice(0, 80);
        if (o.type === 'user' && o.message) {
          const c = o.message.content;
          const t = typeof c === 'string' ? c : (Array.isArray(c) ? ((c.find(x => x.type === 'text') || {}).text || '') : '');
          if (t && !t.startsWith('<')) return t.replace(/\s+/g, ' ').slice(0, 80);
        }
      }
    } catch (_) {
      // ignore — title is best-effort
    } finally {
      if (fd) await fd.close().catch(() => {});
    }
    return null;
  }

  // Snapshot for attach replay.
  snapshot() {
    return {
      events: this.history,
      claudeStatus: this.claudeStatus,
      acpSessionId: this.acpSessionId,
      modeState: this.modeState,
    };
  }

  kill() {
    this.alive = false;
    try { if (this._child) this._child.kill(); } catch (_) {}
  }
}

module.exports = AcpSession;
