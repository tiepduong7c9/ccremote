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
  private pullCallbacks: Map<string, (result: { output: string } | null, error?: string) => void> = new Map();
  private revertCallbacks: Map<string, (error?: string) => void> = new Map();
  private fileListCallbacks: Map<string, (files: string[] | null, error?: string) => void> = new Map();
  private fileDirCallbacks: Map<string, (entries: { name: string; isDir: boolean }[] | null, error?: string) => void> = new Map();
  private fileReadCallbacks: Map<string, (result: { content: string; language: string; isBinary: boolean; tooLarge: boolean } | null, error?: string) => void> = new Map();
  private fileWriteCallbacks: Map<string, (error?: string) => void> = new Map();
  private fileDeleteCallbacks: Map<string, (error?: string) => void> = new Map();
  private fileDownloadCallbacks: Map<string, (result: { base64: string; size: number } | null, error?: string) => void> = new Map();
  private claudeMdReadCallbacks: Map<string, (content: string | null, error?: string) => void> = new Map();
  private claudeMdWriteCallbacks: Map<string, (error?: string) => void> = new Map();

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
        if (diffCb) { diffCb(null, msg.message); this.diffCallbacks.delete(msg.aid); break; }
        const pullCb = this.pullCallbacks.get(msg.aid);
        if (pullCb) { pullCb(null, msg.message); this.pullCallbacks.delete(msg.aid); break; }
        const revertCb = this.revertCallbacks.get(msg.aid);
        if (revertCb) { revertCb(msg.message); this.revertCallbacks.delete(msg.aid); break; }
        const fileListCb = this.fileListCallbacks.get(msg.aid);
        if (fileListCb) { fileListCb(null, msg.message); this.fileListCallbacks.delete(msg.aid); break; }
        const fileDirCb = this.fileDirCallbacks.get(msg.aid);
        if (fileDirCb) { fileDirCb(null, msg.message); this.fileDirCallbacks.delete(msg.aid); break; }
        const fileReadCb = this.fileReadCallbacks.get(msg.aid);
        if (fileReadCb) { fileReadCb(null, msg.message); this.fileReadCallbacks.delete(msg.aid); break; }
        const fileWriteCb = this.fileWriteCallbacks.get(msg.aid);
        if (fileWriteCb) { fileWriteCb(msg.message); this.fileWriteCallbacks.delete(msg.aid); break; }
        const fileDeleteCb = this.fileDeleteCallbacks.get(msg.aid);
        if (fileDeleteCb) { fileDeleteCb(msg.message); this.fileDeleteCallbacks.delete(msg.aid); break; }
        const claudeMdReadCb = this.claudeMdReadCallbacks.get(msg.aid);
        if (claudeMdReadCb) { claudeMdReadCb(null, msg.message); this.claudeMdReadCallbacks.delete(msg.aid); break; }
        const claudeMdWriteCb = this.claudeMdWriteCallbacks.get(msg.aid);
        if (claudeMdWriteCb) { claudeMdWriteCb(msg.message); this.claudeMdWriteCallbacks.delete(msg.aid); }
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

      case 'git_pull_result': {
        const cb = this.pullCallbacks.get(msg.aid);
        if (cb) { cb({ output: msg.output }); this.pullCallbacks.delete(msg.aid); }
        break;
      }

      case 'git_revert_result': {
        const cb = this.revertCallbacks.get(msg.aid);
        if (cb) { cb(); this.revertCallbacks.delete(msg.aid); }
        break;
      }

      case 'file_list_result': {
        const cb = this.fileListCallbacks.get(msg.aid);
        if (cb) { cb(msg.files); this.fileListCallbacks.delete(msg.aid); }
        break;
      }

      case 'file_list_dir_result': {
        const cb = this.fileDirCallbacks.get(msg.aid);
        if (cb) { cb(msg.entries); this.fileDirCallbacks.delete(msg.aid); }
        break;
      }

      case 'file_read_result': {
        const cb = this.fileReadCallbacks.get(msg.aid);
        if (cb) { cb({ content: msg.content, language: msg.language, isBinary: msg.isBinary, tooLarge: msg.tooLarge }); this.fileReadCallbacks.delete(msg.aid); }
        break;
      }

      case 'file_download_result': {
        const cb = this.fileDownloadCallbacks.get(msg.aid);
        if (cb) {
          if (msg.error) { cb(null, msg.error); } else { cb({ base64: msg.base64!, size: msg.size! }); }
          this.fileDownloadCallbacks.delete(msg.aid);
        }
        break;
      }

      case 'file_write_result': {
        const cb = this.fileWriteCallbacks.get(msg.aid);
        if (cb) { cb(); this.fileWriteCallbacks.delete(msg.aid); }
        break;
      }

      case 'file_delete_result': {
        const cb = this.fileDeleteCallbacks.get(msg.aid);
        if (cb) { cb(); this.fileDeleteCallbacks.delete(msg.aid); }
        break;
      }

      case 'claude_md_read_result': {
        const cb = this.claudeMdReadCallbacks.get(msg.aid);
        if (cb) { cb(msg.content); this.claudeMdReadCallbacks.delete(msg.aid); }
        break;
      }

      case 'claude_md_write_result': {
        const cb = this.claudeMdWriteCallbacks.get(msg.aid);
        if (cb) { cb(); this.claudeMdWriteCallbacks.delete(msg.aid); }
        break;
      }

      case 'server_error': {
        console.error('[ccremote]', msg.message);
        const errAid = msg.aid;
        if (errAid) {
          const repoCb = this.repoCallbacks.get(errAid);
          if (repoCb) { repoCb(null, msg.message); this.repoCallbacks.delete(errAid); }
          const statusCb = this.statusCallbacks.get(errAid);
          if (statusCb) { statusCb(null, msg.message); this.statusCallbacks.delete(errAid); }
          const diffCb = this.diffCallbacks.get(errAid);
          if (diffCb) { diffCb(null, msg.message); this.diffCallbacks.delete(errAid); }
          const pullCb = this.pullCallbacks.get(errAid);
          if (pullCb) { pullCb(null, msg.message); this.pullCallbacks.delete(errAid); }
          const revertCb = this.revertCallbacks.get(errAid);
          if (revertCb) { revertCb(msg.message); this.revertCallbacks.delete(errAid); }
          const fileListCb = this.fileListCallbacks.get(errAid);
          if (fileListCb) { fileListCb(null, msg.message); this.fileListCallbacks.delete(errAid); }
          const fileDirCb = this.fileDirCallbacks.get(errAid);
          if (fileDirCb) { fileDirCb(null, msg.message); this.fileDirCallbacks.delete(errAid); }
          const fileReadCb = this.fileReadCallbacks.get(errAid);
          if (fileReadCb) { fileReadCb(null, msg.message); this.fileReadCallbacks.delete(errAid); }
          const fileWriteCb = this.fileWriteCallbacks.get(errAid);
          if (fileWriteCb) { fileWriteCb(msg.message); this.fileWriteCallbacks.delete(errAid); }
          const fileDeleteCb = this.fileDeleteCallbacks.get(errAid);
          if (fileDeleteCb) { fileDeleteCb(msg.message); this.fileDeleteCallbacks.delete(errAid); }
          const fileDownloadCb = this.fileDownloadCallbacks.get(errAid);
          if (fileDownloadCb) { fileDownloadCb(null, msg.message); this.fileDownloadCallbacks.delete(errAid); }
          const claudeMdReadCb = this.claudeMdReadCallbacks.get(errAid);
          if (claudeMdReadCb) { claudeMdReadCb(null, msg.message); this.claudeMdReadCallbacks.delete(errAid); }
          const claudeMdWriteCb = this.claudeMdWriteCallbacks.get(errAid);
          if (claudeMdWriteCb) { claudeMdWriteCb(msg.message); this.claudeMdWriteCallbacks.delete(errAid); }
        }
        break;
      }
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

  gitPull(anid: string, aid: string, cwd: string, cb: (result: { output: string } | null, error?: string) => void) {
    this.pullCallbacks.set(aid, cb);
    this.send({ type: 'git_pull', anid, aid, cwd });
  }

  gitRevert(anid: string, aid: string, cwd: string, paths: string[], includeUntracked: boolean, cb: (error?: string) => void) {
    this.revertCallbacks.set(aid, cb);
    this.send({ type: 'git_revert', anid, aid, cwd, paths, includeUntracked });
  }

  fileList(anid: string, aid: string, cwd: string, cb: (files: string[] | null, error?: string) => void) {
    this.fileListCallbacks.set(aid, cb);
    this.send({ type: 'file_list', anid, aid, cwd });
  }

  fileDir(anid: string, aid: string, cwd: string, subPath: string, cb: (entries: { name: string; isDir: boolean }[] | null, error?: string) => void) {
    this.fileDirCallbacks.set(aid, cb);
    this.send({ type: 'file_list_dir', anid, aid, cwd, subPath });
  }

  fileRead(anid: string, aid: string, cwd: string, filePath: string, cb: (result: { content: string; language: string; isBinary: boolean; tooLarge: boolean } | null, error?: string) => void) {
    this.fileReadCallbacks.set(aid, cb);
    this.send({ type: 'file_read', anid, aid, cwd, path: filePath });
  }

  fileWrite(anid: string, aid: string, cwd: string, filePath: string, content: string, cb: (error?: string) => void) {
    this.fileWriteCallbacks.set(aid, cb);
    this.send({ type: 'file_write', anid, aid, cwd, path: filePath, content });
  }

  fileDelete(anid: string, aid: string, cwd: string, filePath: string, cb: (error?: string) => void) {
    this.fileDeleteCallbacks.set(aid, cb);
    this.send({ type: 'file_delete', anid, aid, cwd, path: filePath });
  }

  fileDownload(anid: string, aid: string, cwd: string, filePath: string, cb: (result: { base64: string; size: number } | null, error?: string) => void) {
    this.fileDownloadCallbacks.set(aid, cb);
    this.send({ type: 'file_download', anid, aid, cwd, path: filePath });
  }

  claudeMdRead(anid: string, aid: string, cb: (content: string | null, error?: string) => void) {
    this.claudeMdReadCallbacks.set(aid, cb);
    this.send({ type: 'claude_md_read', anid, aid });
  }

  claudeMdWrite(anid: string, aid: string, content: string, cb: (error?: string) => void) {
    this.claudeMdWriteCallbacks.set(aid, cb);
    this.send({ type: 'claude_md_write', anid, aid, content });
  }
}

export const browserSocket = new BrowserSocket();
