'use strict';

const pty = require('node-pty');
const { nanoid } = require('nanoid');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATE_DIR, SESSIONS_FILE } = require('./constants');

const MAX_SCROLLBACK = 100 * 1024; // 100 KB per session

// Absolute path to the hook script — written into .claude/settings.local.json
const HOOK_COMMAND = `node ${path.join(__dirname, 'hook.js')}`;
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'];

const ADJECTIVES = [
  'amber', 'arctic', 'bold', 'brave', 'bright', 'calm', 'cold', 'cool',
  'crisp', 'dark', 'dawn', 'deep', 'dusk', 'fast', 'fierce', 'frosty',
  'gentle', 'glad', 'golden', 'grand', 'green', 'grey', 'hidden', 'hollow',
  'jade', 'keen', 'kind', 'late', 'lively', 'lone', 'lucid', 'mellow',
  'misty', 'noble', 'north', 'quiet', 'rapid', 'rough', 'royal', 'rustic',
  'shady', 'sharp', 'silent', 'silver', 'sleek', 'slim', 'solar', 'still',
  'stout', 'sturdy', 'swift', 'tall', 'teal', 'tiny', 'vivid', 'warm',
  'white', 'wild', 'wise', 'young',
];

const ANIMALS = [
  'bear', 'bison', 'boar', 'buck', 'bull', 'cobra', 'crane', 'crow',
  'deer', 'dove', 'duck', 'eagle', 'elk', 'falcon', 'finch', 'fox',
  'frog', 'goat', 'goose', 'hawk', 'heron', 'horse', 'hound', 'ibis',
  'jay', 'kite', 'lamb', 'lark', 'lion', 'lynx', 'mink', 'moose',
  'moth', 'mule', 'newt', 'orca', 'otter', 'owl', 'panda', 'pike',
  'puma', 'quail', 'raven', 'robin', 'seal', 'shark', 'snipe', 'stag',
  'swan', 'swift', 'tiger', 'toad', 'trout', 'viper', 'vole', 'wasp',
  'weasel', 'whale', 'wolf', 'wren',
];

function randomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj}-${animal}`;
}

class SessionManager {
  constructor() {
    this._sessions = new Map(); // id -> { meta, pty, scrollback, listeners }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    this._loadPersistedSessions();
  }

  _loadPersistedSessions() {
    try {
      if (!fs.existsSync(SESSIONS_FILE)) return;
      const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const meta of saved) {
        if (this._sessions.has(meta.id)) continue;
        // Sessions that were running when daemon stopped are now suspended
        if (meta.status === 'running') meta.status = 'suspended';
        this._sessions.set(meta.id, {
          meta,
          pty: null,
          scrollback: Buffer.alloc(0),
          listeners: new Set(),
        });
      }
    } catch (_) {}
  }

  create(opts = {}) {
    const id = nanoid(8);
    let name = opts.name;
    if (!name) {
      const base = randomName();
      const taken = new Set([...this._sessions.values()].map(s => s.meta.name));
      name = taken.has(base) ? `${base}-${id.slice(0, 4)}` : base;
    }
    const rawCwd = opts.cwd || process.cwd();
    const cwd = path.resolve(rawCwd.replace(/^~(?=$|\/)/, os.homedir()));
    const command = opts.command || 'claude';
    const args = opts.args || [];
    const parentSid = opts.parentSid || null;
    const transient = opts.transient || false;

    const ptyProc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: opts.cols || 220,
      rows: opts.rows || 50,
      cwd,
      env: { ...process.env, CCREMOTE_SID: id },
    });

    const meta = {
      id,
      name,
      cwd,
      command,
      args,
      ...(parentSid && { parentSid }),
      ...(transient && { transient }),
      pid: ptyProc.pid,
      status: 'running',
      createdAt: new Date().toISOString(),
      lastAttachedAt: null,
    };

    const session = {
      meta,
      pty: ptyProc,
      scrollback: Buffer.alloc(0),
      listeners: new Set(),
    };

    this._registerPtyHandlers(session);
    if (command === 'claude') this._installClaudeHooks(cwd);
    this._sessions.set(id, session);
    this._persist();
    return { ...meta };
  }

  _registerPtyHandlers(session) {
    const { meta } = session;

    session.pty.onData((data) => {
      const buf = Buffer.from(data);
      const combined = Buffer.concat([session.scrollback, buf]);
      session.scrollback = combined.length > MAX_SCROLLBACK
        ? combined.slice(combined.length - MAX_SCROLLBACK)
        : combined;
      for (const fn of session.listeners) fn({ type: 'data', data: buf });
    });

    session.pty.onExit(({ exitCode }) => {
      // Non-zero exit = crashed/interrupted → keep resumable; zero = clean exit
      meta.status = exitCode === 0 ? 'exited' : 'suspended';
      meta.exitCode = exitCode;
      delete meta.claudeStatus;
      for (const fn of session.listeners) fn({ type: 'exit', code: exitCode });
      session.listeners.clear();
      this._persist();
    });
  }

  resumeSession(id) {
    const session = this._sessions.get(id);
    if (!session || session.meta.status !== 'suspended') return false;

    const { meta } = session;
    // For claude: resume the exact conversation by its pinned session ID.
    // Fall back to --continue for sessions created before this feature.
    // For other commands: restart with the original args.
    let resumeArgs;
    if (meta.command === 'claude') {
      resumeArgs = ['--continue'];
    } else {
      resumeArgs = meta.args || [];
    }

    let ptyProc;
    try {
      ptyProc = pty.spawn(meta.command, resumeArgs, {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: meta.cwd,
        env: { ...process.env, CCREMOTE_SID: meta.id },
      });
    } catch (err) {
      return false;
    }

    meta.pid = ptyProc.pid;
    meta.status = 'running';
    meta.resumedAt = new Date().toISOString();
    delete meta.exitCode;

    session.pty = ptyProc;
    session.scrollback = Buffer.alloc(0);

    this._registerPtyHandlers(session);
    if (meta.command === 'claude') this._installClaudeHooks(meta.cwd);
    this._persist();
    return true;
  }

  list() {
    return [...this._sessions.values()].map(s => ({ ...s.meta }));
  }

  // Resolve by exact ID, name, or ID prefix
  resolve(nameOrId) {
    if (this._sessions.has(nameOrId)) return this._sessions.get(nameOrId).meta;
    for (const s of this._sessions.values()) {
      if (s.meta.name === nameOrId) return s.meta;
    }
    for (const [id, s] of this._sessions) {
      if (id.startsWith(nameOrId)) return s.meta;
    }
    return null;
  }

  attach(id, listener) {
    const session = this._sessions.get(id);
    if (!session) return null;

    // Auto-resume suspended sessions
    if (session.meta.status === 'suspended') {
      if (!this.resumeSession(id)) return null;
    }

    if (session.meta.status !== 'running') return null;

    session.meta.lastAttachedAt = new Date().toISOString();
    session.listeners.add(listener);
    this._persist();
    return { scrollback: session.scrollback, meta: { ...session.meta } };
  }

  detach(id, listener) {
    const session = this._sessions.get(id);
    if (session) session.listeners.delete(listener);
  }

  write(id, buf) {
    const session = this._sessions.get(id);
    if (!session || session.meta.status !== 'running') return false;
    // node-pty.write() takes a string; use binary encoding to preserve all bytes
    session.pty.write(buf.toString());
    return true;
  }

  resize(id, cols, rows) {
    const session = this._sessions.get(id);
    if (!session || session.meta.status !== 'running') return;
    try { session.pty.resize(cols, rows); } catch (_) {}
  }

  rename(id, name) {
    const meta = this.resolve(id);
    if (!meta) return null;
    meta.name = name;
    this._persist();
    return { ...meta };
  }

  kill(id) {
    const session = this._sessions.get(id);
    if (!session) {
      // Try resolving by name/prefix then retry by ID
      const meta = this.resolve(id);
      if (meta) return this.kill(meta.id);
      return false;
    }
    // Kill any bash child sessions that belong to this session
    for (const [childId, child] of this._sessions) {
      if (child.meta.parentSid === session.meta.id) {
        if (child.meta.status === 'running') {
          try { child.pty.kill(); } catch (_) {}
        }
        this._sessions.delete(childId);
      }
    }
    if (session.meta.status === 'running') {
      try { session.pty.kill(); } catch (_) {}
    }
    this._sessions.delete(session.meta.id);
    this._persist();
    return true;
  }

  // Called during graceful daemon shutdown — marks live sessions as suspended
  // so they appear resumable after the daemon restarts. Transient sessions
  // (bash tabs) are killed and deleted instead so they don't reappear.
  suspendAll() {
    for (const [id, session] of this._sessions) {
      if (session.meta.transient) {
        if (session.meta.status === 'running') {
          try { session.pty.kill(); } catch (_) {}
        }
        this._sessions.delete(id);
      } else if (session.meta.status === 'running') {
        session.meta.status = 'suspended';
        delete session.meta.claudeStatus;
        try { session.pty.kill(); } catch (_) {}
      }
    }
    this._persist();
  }

  _installClaudeHooks(cwd) {
    if (!cwd) return;
    const claudeDir = path.join(cwd, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
    if (!settings.hooks) settings.hooks = {};
    const hookEntry = { hooks: [{ type: 'command', command: HOOK_COMMAND }] };
    for (const event of HOOK_EVENTS) {
      if (!settings.hooks[event]) settings.hooks[event] = [];
      // Remove stale ccremote entries, then re-add fresh one
      settings.hooks[event] = settings.hooks[event].filter(
        e => !e.hooks?.some(h => h.command === HOOK_COMMAND)
      );
      settings.hooks[event].push(hookEntry);
    }
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (_) {}
  }

  setClaudeStatus(id, claudeStatus) {
    const session = this._sessions.get(id);
    if (!session || session.meta.status !== 'running') return;
    if (session.meta.claudeStatus === claudeStatus) return;
    session.meta.claudeStatus = claudeStatus;
    this._persist();
  }

  _persist() {
    try {
      fs.writeFileSync(
        SESSIONS_FILE,
        JSON.stringify(
          [...this._sessions.values()].filter(s => !s.meta.transient).map(s => s.meta),
          null,
          2,
        ),
      );
    } catch (_) {}
  }
}

module.exports = SessionManager;
