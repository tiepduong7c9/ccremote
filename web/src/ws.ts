import type { Terminal } from '@xterm/xterm';

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
import type { GitFileChange, GitRepo, ServerMsg, SessionMeta } from './lib/protocol';
import { notificationsEnabled } from './lib/notifications';
import { useRegistryStore, useTerminalStore } from './store';

class MessageParser {
  private buf = '';
  private onMessage: (msg: ServerMsg) => void;

  constructor(onMessage: (msg: ServerMsg) => void) {
    this.onMessage = onMessage;
  }

  feed(data: string) {
    this.buf += data;
    const lines = this.buf.split('\n');
    this.buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this.onMessage(JSON.parse(line) as ServerMsg); } catch {}
    }
  }
}

class BrowserSocket {
  private ws: WebSocket | null = null;
  private parser: MessageParser;
  private termsByAid: Map<string, Terminal> = new Map();
  private knownStatus = new Map<string, string | undefined>();
  private retries = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private repoCallbacks: Map<string, (repos: GitRepo[] | null, error?: string) => void> = new Map();
  private statusCallbacks: Map<string, (result: { branch: string; files: GitFileChange[] } | null, error?: string) => void> = new Map();
  private diffCallbacks: Map<string, (result: { oldContent: string; newContent: string; language: string; isBinary: boolean; tooLarge: boolean } | null, error?: string) => void> = new Map();

  constructor() {
    this.parser = new MessageParser((msg) => this.handleMessage(msg));
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/browser`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
    };

    ws.onmessage = (e) => {
      this.parser.feed(e.data as string);
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };

    ws.onerror = () => {};
  }

  close() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(1.5, this.retries), 30000) + Math.random() * 500;
    this.retries++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(msg: ServerMsg) {
    const registry = useRegistryStore.getState();
    const terminals = useTerminalStore.getState();

    switch (msg.type) {
      case 'snapshot':
        // Seed known status from initial state — no notifications on connect
        for (const node of msg.agentnodes)
          for (const s of node.sessions)
            this.knownStatus.set(s.id, s.claudeStatus);
        registry.applySnapshot(msg.agentnodes);
        break;

      case 'agentnode_online':
        registry.setOnline(msg.agentnode);
        break;

      case 'agentnode_offline':
        registry.setOffline(msg.anid);
        break;

      case 'sessions': {
        const nodeName = registry.agentnodes.get(msg.anid)?.name ?? '';
        this.notifyStatusChanges(msg.sessions, nodeName);
        registry.setSessions(msg.anid, msg.sessions);
        break;
      }

      case 'attached': {
        const att = terminals.attachments.get(msg.aid);
        if (att) {
          terminals.setAttachment(msg.aid, { ...att, sid: msg.sid, session: msg.session, status: 'attached' });
        }
        break;
      }

      case 'scrollback': {
        const term = this.termsByAid.get(msg.aid);
        if (term) term.write(b64ToBytes(msg.data));
        break;
      }

      case 'data': {
        // Hot path: bypass React entirely
        const term = this.termsByAid.get(msg.aid);
        if (term) term.write(b64ToBytes(msg.data));
        break;
      }

      case 'session_exit':
        this.knownStatus.delete(msg.sid);
        localStorage.removeItem(`ccremote:notif:${msg.sid}:waiting`);
        localStorage.removeItem(`ccremote:notif:${msg.sid}:idle`);
        registry.setSessions(msg.anid, registry.agentnodes.get(msg.anid)?.sessions.map(s =>
          s.id === msg.sid ? { ...s, status: 'exited' as const } : s
        ) || []);
        if (registry.selectedAnid === msg.anid && registry.selectedSid === msg.sid) {
          registry.select(msg.anid, null);
        }
        break;

      case 'image_uploaded': {
        const att = useTerminalStore.getState().attachments.get(msg.aid);
        if (att?.anid) {
          this.input(att.anid, msg.aid, btoa(unescape(encodeURIComponent('[read image @' + msg.path + '] '))));
        }
        break;
      }

      case 'git_repos': {
        const cb = this.repoCallbacks.get(msg.aid);
        if (cb) { cb(msg.repos); this.repoCallbacks.delete(msg.aid); }
        break;
      }

      case 'git_result': {
        const repoCb = this.repoCallbacks.get(msg.aid);
        if (repoCb) { repoCb(null, msg.message); this.repoCallbacks.delete(msg.aid); break; }
        const statusCb = this.statusCallbacks.get(msg.aid);
        if (statusCb) { statusCb(null, msg.message); this.statusCallbacks.delete(msg.aid); break; }
        const diffCb = this.diffCallbacks.get(msg.aid);
        if (diffCb) { diffCb(null, msg.message); this.diffCallbacks.delete(msg.aid); }
        break;
      }

      case 'git_status_result': {
        const cb = this.statusCallbacks.get(msg.aid);
        if (cb) { cb({ branch: msg.branch, files: msg.files }); this.statusCallbacks.delete(msg.aid); }
        break;
      }

      case 'git_diff_result': {
        const cb = this.diffCallbacks.get(msg.aid);
        if (cb) { cb({ oldContent: msg.oldContent, newContent: msg.newContent, language: msg.language, isBinary: msg.isBinary, tooLarge: msg.tooLarge }); this.diffCallbacks.delete(msg.aid); }
        break;
      }

      case 'server_error':
        console.error('[ccremote]', msg.message);
        break;
    }
  }

  private notifyStatusChanges(sessions: SessionMeta[], nodeName: string) {
    for (const s of sessions) {
      const prev = this.knownStatus.get(s.id);
      const curr = s.claudeStatus;
      if (prev !== undefined && prev !== curr && (curr === 'waiting' || curr === 'idle')) {
        this.fireNotification(s, nodeName, curr);
      }
      this.knownStatus.set(s.id, curr);
    }
  }

  private fireNotification(s: SessionMeta, nodeName: string, status: 'waiting' | 'idle') {
    if (!notificationsEnabled()) return;
    if (document.visibilityState === 'visible') return;
    const storageKey = `ccremote:notif:${s.id}:${status}`;
    const lockName = `ccremote-notif-${s.id}-${status}`;
    const tryFire = () => {
      const now = Date.now();
      const last = parseInt(localStorage.getItem(storageKey) || '0', 10);
      if (last + 30_000 > now) return;
      localStorage.setItem(storageKey, String(now));
      const folder = s.cwd ? s.cwd.split('/').filter(Boolean).pop() : null;
      const label = folder ? `[${folder}] ${s.name}` : s.name;
      const title = status === 'waiting' ? `${label} needs your input` : `${label} is done`;
      new Notification(title, { body: nodeName || undefined, icon: '/favicon.svg' });
    };
    if ('locks' in navigator) {
      // ifAvailable: skip rather than queue if another tab is already handling this
      navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        tryFire();
      });
    } else {
      tryFire();
    }
  }

  send(msg: object) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg) + '\n');
    }
  }

  registerTerm(aid: string, term: Terminal) {
    this.termsByAid.set(aid, term);
  }

  unregisterTerm(aid: string) {
    this.termsByAid.delete(aid);
  }

  attach(anid: string, aid: string, sid: string) {
    this.send({ type: 'attach', anid, aid, sid });
  }

  detach(anid: string, aid: string) {
    this.send({ type: 'detach', anid, aid });
  }

  input(anid: string, aid: string, data: string) {
    this.send({ type: 'input', anid, aid, data });
  }

  resize(anid: string, aid: string, cols: number, rows: number) {
    this.send({ type: 'resize', anid, aid, cols, rows });
  }

  create(anid: string, aid: string, opts: { name?: string; command?: string; cwd?: string; cols: number; rows: number; parentSid?: string }) {
    this.send({ type: 'create', anid, aid, ...opts });
  }

  kill(anid: string, sid: string) {
    this.send({ type: 'kill', anid, sid });
  }

  rename(anid: string, sid: string, name: string) {
    this.send({ type: 'rename', anid, sid, name });
  }

  uploadImage(anid: string, aid: string, sid: string, data: string, ext: string) {
    this.send({ type: 'upload_image', anid, aid, sid, data, ext });
  }

  gitRepoList(anid: string, aid: string, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_repo_list', anid, aid });
  }

  gitClone(anid: string, aid: string, url: string, localPath: string, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_clone', anid, aid, url, localPath });
  }

  gitRepoAdd(anid: string, aid: string, localPath: string, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_repo_add', anid, aid, localPath });
  }

  gitRepoRemove(anid: string, aid: string, localPath: string, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_repo_remove', anid, aid, localPath });
  }

  gitWorktreeAdd(anid: string, aid: string, repoPath: string, worktreePath: string, branch: string, newBranch: boolean, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_worktree_add', anid, aid, repoPath, worktreePath, branch, newBranch });
  }

  gitWorktreeRemove(anid: string, aid: string, repoPath: string, worktreePath: string, cb: (repos: GitRepo[] | null, error?: string) => void) {
    this.repoCallbacks.set(aid, cb);
    this.send({ type: 'git_worktree_remove', anid, aid, repoPath, worktreePath });
  }

  gitStatus(anid: string, aid: string, cwd: string, cb: (result: { branch: string; files: GitFileChange[] } | null, error?: string) => void) {
    this.statusCallbacks.set(aid, cb);
    this.send({ type: 'git_status', anid, aid, cwd });
  }

  gitDiff(anid: string, aid: string, cwd: string, filePath: string, cb: (result: { oldContent: string; newContent: string; language: string; isBinary: boolean; tooLarge: boolean } | null, error?: string) => void) {
    this.diffCallbacks.set(aid, cb);
    this.send({ type: 'git_diff', anid, aid, cwd, path: filePath });
  }
}

export const browserSocket = new BrowserSocket();
