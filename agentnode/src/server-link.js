'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { encode, MessageParser } = require('./protocol');
const WorkspaceManager = require('./workspace-manager');
const { getUsageDetail } = require('./usage');

const pkg = require('../package.json');

class ServerLink {
  constructor({ serverUrl, token, manager }) {
    this._serverUrl = serverUrl;
    this._token = token;
    this._manager = manager;
    this._ws = null;
    this._attachments = new Map(); // aid -> { sid, listener }
    this._retries = 0;
    this._rejectedCount = 0;
    this._stopped = false;
    this._retryTimer = null;
    this._git = new WorkspaceManager();

    // Hook into manager._persist to push session updates to the server
    const original = manager._persist.bind(manager);
    manager._persist = () => {
      original();
      this._send({ type: 'sessions', sessions: manager.list() });
    };
  }

  start() {
    this._connect();
  }

  // Poll account/usage and push to the server: once on connect, then every 15m.
  _startUsagePolling() {
    this._pushUsage();
    if (this._usageTimer) clearInterval(this._usageTimer);
    this._usageTimer = setInterval(() => this._pushUsage(), 15 * 60 * 1000);
  }

  _stopUsagePolling() {
    if (this._usageTimer) { clearInterval(this._usageTimer); this._usageTimer = null; }
  }

  _pushUsage() {
    getUsageDetail()
      .then(({ account, usage }) => this._send({ type: 'usage', account, usage }))
      .catch(() => {});
  }

  stop() {
    this._stopped = true;
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._stopUsagePolling();
    if (this._ws) {
      this._ws.removeAllListeners();
      this._ws.close();
      this._ws = null;
    }
    // Detach all attachments
    for (const [aid, att] of this._attachments) {
      try { this._manager.detach(att.sid, att.listener); } catch (_) {}
    }
    this._attachments.clear();
    this._git.cleanupUploads();
  }

  _connect() {
    if (this._stopped) return;

    const url = this._serverUrl.replace(/\/$/, '') + '/ws/agentnode';
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this._token}` },
    });
    this._ws = ws;

    const parser = new MessageParser((msg) => this._handleMessage(msg));

    ws.on('open', () => {
      this._retries = 0;
      process.stderr.write(`ccremote: linked to ${this._serverUrl}\n`);
      this._send({
        type: 'hello',
        token: this._token,
        hostname: require('os').hostname(),
        platform: process.platform,
        version: pkg.version,
      });
      this._send({ type: 'sessions', sessions: this._manager.list() });
      this._startUsagePolling();
    });

    ws.on('message', (raw) => {
      parser.feed(raw.toString());
    });

    ws.on('close', () => {
      if (this._stopped) return;
      this._ws = null;
      this._stopUsagePolling();
      // Detach all current attachments from manager
      for (const [, att] of this._attachments) {
        try { this._manager.detach(att.sid, att.listener); } catch (_) {}
      }
      this._attachments.clear();
      this._git.cleanupUploads();
      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      process.stderr.write(`ccremote: server-link error: ${err.message}\n`);
    });
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    if (this._rejectedCount >= 3) {
      process.stderr.write('ccremote: server rejected token 3 times, stopping reconnect\n');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this._retries), 30000) + Math.random() * 1000;
    this._retries++;
    process.stderr.write(`ccremote: reconnecting in ${Math.round(delay / 1000)}s...\n`);
    this._retryTimer = setTimeout(() => this._connect(), delay);
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(encode(obj));
    }
  }

  // Listener that forwards session events for one attachment (aid) to the server.
  // Handles both PTY byte streams and structured ACP events.
  _relayListener(aid, sid) {
    return (event) => {
      if (event.type === 'data') {
        this._send({ type: 'data', aid, sid, data: event.data.toString('base64') });
      } else if (event.type === 'exit') {
        this._send({ type: 'session_exit', sid, code: event.code });
        this._attachments.delete(aid);
      } else if (typeof event.type === 'string' && event.type.startsWith('acp_')) {
        this._send({ type: 'acp_event', aid, sid, event });
      }
    };
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this._rejectedCount = 0;
        process.stderr.write(`ccremote: server assigned id=${msg.agentnodeId} name=${msg.name}\n`);
        break;

      case 'rejected':
        this._rejectedCount++;
        process.stderr.write(`ccremote: server rejected connection: ${msg.reason}\n`);
        if (this._ws) this._ws.close();
        break;

      case 'ping':
        this._send({ type: 'pong' });
        break;

      case 'attach': {
        const { aid, sid } = msg;
        const meta = this._manager.resolve(sid);
        if (!meta) {
          this._send({ type: 'server_error', aid, message: `Session '${sid}' not found` });
          break;
        }

        const listener = this._relayListener(aid, meta.id);

        const result = this._manager.attach(meta.id, listener);
        if (!result) {
          this._send({ type: 'server_error', aid, message: `Failed to attach to '${sid}'` });
          break;
        }

        this._attachments.set(aid, { sid: meta.id, listener });

        // ACP sessions replay structured thread history instead of raw scrollback.
        if (result.meta.mode === 'acp') {
          const snap = result.acp || { events: [], claudeStatus: undefined, acpSessionId: null };
          this._send({
            type: 'acp_history',
            aid,
            sid: meta.id,
            events: snap.events,
            claudeStatus: snap.claudeStatus,
            acpSessionId: snap.acpSessionId,
            modeState: snap.modeState,
            availableCommands: snap.availableCommands,
            model: snap.model,
            modelState: snap.modelState,
          });
          this._send({ type: 'attached', aid, sid: meta.id, session: result.meta });
          break;
        }

        // Replay scrollback so the browser has prior history to scroll back through.
        // For Claude sessions the browser also sends a double SIGWINCH after 'attached'
        // which makes Claude repaint a fresh frame; replaying raw bytes on top of that
        // caused duplicate history. The `redraw` flag tells the browser to bury the
        // replayed frame into scrollback before that repaint, so the live frame appears
        // exactly once. Transient (bash) sessions get no redraw, so no burying needed.
        if (result.scrollback && result.scrollback.length > 0) {
          this._send({
            type: 'scrollback',
            aid,
            sid: meta.id,
            data: result.scrollback.toString('base64'),
            redraw: !result.meta.transient,
          });
        }
        this._send({ type: 'attached', aid, sid: meta.id, session: result.meta });
        break;
      }

      case 'detach': {
        const att = this._attachments.get(msg.aid);
        if (att) {
          this._manager.detach(att.sid, att.listener);
          this._attachments.delete(msg.aid);
        }
        break;
      }

      case 'input': {
        const att = this._attachments.get(msg.aid);
        if (att) {
          this._manager.write(att.sid, Buffer.from(msg.data, 'base64'));
        }
        break;
      }

      case 'resize': {
        const att = this._attachments.get(msg.aid);
        if (att) {
          this._manager.resize(att.sid, msg.cols, msg.rows);
        }
        break;
      }

      case 'create': {
        const { aid, name, cwd, cols, rows, parentSid, mode } = msg;
        // If parentSid is set this is a bash tab — use the user's shell and
        // mark it transient so it is never persisted and dies on shutdown.
        const isBashTab = !!parentSid;
        const command = msg.command || (isBashTab ? (process.env.SHELL || 'bash') : 'claude');
        let meta;
        try {
          meta = this._manager.create({ name, command, cwd, cols, rows, parentSid, transient: isBashTab, mode });
        } catch (err) {
          this._send({ type: 'server_error', aid, message: err.message });
          break;
        }

        // Auto-attach the requesting aid
        const listener = this._relayListener(aid, meta.id);
        const result = this._manager.attach(meta.id, listener);
        if (result) {
          this._attachments.set(aid, { sid: meta.id, listener });
        }

        this._send({ type: 'session_created', session: meta });
        if (result) {
          if (result.meta.mode === 'acp') {
            const snap = result.acp || { events: [], claudeStatus: undefined, acpSessionId: null };
            this._send({ type: 'acp_history', aid, sid: meta.id, events: snap.events, claudeStatus: snap.claudeStatus, acpSessionId: snap.acpSessionId, modeState: snap.modeState, availableCommands: snap.availableCommands, model: snap.model });
          }
          this._send({ type: 'attached', aid, sid: meta.id, session: meta });
        }
        break;
      }

      case 'acp_prompt': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.prompt(att.sid, msg.blocks);
        break;
      }

      case 'acp_cancel': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.cancelPrompt(att.sid);
        break;
      }

      case 'acp_permission_response': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.resolvePermission(att.sid, msg.requestId, msg.optionId);
        break;
      }

      case 'acp_set_mode': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.setMode(att.sid, msg.modeId);
        break;
      }

      case 'acp_set_model': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.setModel(att.sid, msg.modelId);
        break;
      }

      case 'acp_list_conversations': {
        const att = this._attachments.get(msg.aid);
        if (att) {
          this._manager.listConversations(att.sid)
            .then(conversations => this._send({ type: 'acp_conversations_result', aid: msg.aid, conversations }))
            .catch(() => this._send({ type: 'acp_conversations_result', aid: msg.aid, conversations: [] }));
        }
        break;
      }

      case 'acp_new_conversation': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.newConversation(att.sid);
        break;
      }

      case 'acp_resume_conversation': {
        const att = this._attachments.get(msg.aid);
        if (att) this._manager.resumeConversation(att.sid, msg.sessionId);
        break;
      }

      case 'acp_usage_detail': {
        const { aid } = msg;
        getUsageDetail()
          .then(({ account, usage }) => this._send({ type: 'acp_usage_detail_result', aid, account, usage }))
          .catch(() => this._send({ type: 'acp_usage_detail_result', aid, account: null, usage: null }));
        break;
      }

      case 'usage_refresh':
        this._pushUsage();
        break;

      case 'kill': {
        const ok = this._manager.kill(msg.sid);
        if (ok) {
          this._send({ type: 'session_killed', sid: msg.sid });
        } else {
          this._send({ type: 'server_error', message: `Session '${msg.sid}' not found` });
        }
        break;
      }

      case 'rename': {
        const renamed = this._manager.rename(msg.sid, msg.name);
        if (renamed) {
          this._send({ type: 'session_renamed', session: renamed });
        } else {
          this._send({ type: 'server_error', message: `Session '${msg.sid}' not found` });
        }
        break;
      }

      case 'upload_image': {
        const { aid, sid, data, ext } = msg;
        const meta = this._manager.resolve(sid);
        if (!meta) {
          this._send({ type: 'server_error', aid, message: `Session '${sid}' not found` });
          break;
        }
        try {
          const tmpDir = path.join(meta.cwd, '.tmp');
          fs.mkdirSync(tmpDir, { recursive: true });
          const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
          const filename = `paste-${hash}.${ext || 'png'}`;
          const filepath = path.join(tmpDir, filename);
          if (!fs.existsSync(filepath)) {
            fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
          }
          this._send({ type: 'image_uploaded', aid, path: path.join('.tmp', filename) });
        } catch (err) {
          this._send({ type: 'server_error', aid, message: `Failed to save image: ${err.message}` });
        }
        break;
      }

      case 'list':
        this._send({ type: 'sessions', sessions: this._manager.list() });
        break;

      case 'git_repo_list': {
        const { aid } = msg;
        this._git.listRepos()
          .then(repos => this._send({ type: 'git_repos', aid, repos }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_clone': {
        const { aid, url, localPath } = msg;
        this._git.clone(url, localPath)
          .then(() => this._git.listRepos())
          .then(repos => this._send({ type: 'git_repos', aid, repos }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_repo_add': {
        const { aid, localPath } = msg;
        try {
          this._git.addRepo(localPath);
          this._git.listRepos()
            .then(repos => this._send({ type: 'git_repos', aid, repos }))
            .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        } catch (err) {
          this._send({ type: 'git_result', aid, success: false, message: err.message });
        }
        break;
      }

      case 'git_repo_remove': {
        const { aid, localPath } = msg;
        this._git.removeRepo(localPath);
        this._git.listRepos()
          .then(repos => this._send({ type: 'git_repos', aid, repos }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_worktree_add': {
        const { aid, repoPath, worktreePath, branch, newBranch } = msg;
        this._git.addWorktree(repoPath, worktreePath, branch, newBranch)
          .then(() => this._git.listRepos())
          .then(repos => this._send({ type: 'git_repos', aid, repos }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_worktree_remove': {
        const { aid, repoPath, worktreePath } = msg;
        this._git.removeWorktree(repoPath, worktreePath)
          .then(() => this._git.listRepos())
          .then(repos => this._send({ type: 'git_repos', aid, repos }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_list_branches': {
        const { aid, cwd } = msg;
        this._git.listBranches(cwd)
          .then(({ branches }) => this._send({ type: 'git_branches_result', aid, branches }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_checkout': {
        const { aid, cwd, branch } = msg;
        this._git.checkout(cwd, branch)
          .then(() => this._send({ type: 'git_checkout_result', aid }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_status': {
        const { aid, cwd } = msg;
        this._git.status(cwd)
          .then(({ branch, files }) => this._send({ type: 'git_status_result', aid, branch, files }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_pull': {
        const { aid, cwd } = msg;
        this._git.pull(cwd)
          .then(({ output }) => this._send({ type: 'git_pull_result', aid, output }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_diff': {
        const { aid, cwd, path: filePath } = msg;
        this._git.fileContents(cwd, filePath)
          .then(({ oldContent, newContent, language, isBinary, tooLarge }) =>
            this._send({ type: 'git_diff_result', aid, path: filePath, oldContent, newContent, language, isBinary, tooLarge }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_revert': {
        const { aid, cwd, paths, includeUntracked } = msg;
        this._git.revertFiles(cwd, paths, includeUntracked)
          .then(() => this._send({ type: 'git_revert_result', aid }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'git_log': {
        const { aid, cwd, limit } = msg;
        this._git.log(cwd, limit)
          .then(({ commits }) => this._send({ type: 'git_log_result', aid, commits }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_list': {
        const { aid, cwd } = msg;
        this._git.listFiles(cwd)
          .then(({ files }) => this._send({ type: 'file_list_result', aid, files }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_list_dir': {
        const { aid, cwd, subPath } = msg;
        this._git.listDir(cwd, subPath)
          .then(({ entries }) => this._send({ type: 'file_list_dir_result', aid, entries }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_read': {
        const { aid, cwd, path: filePath } = msg;
        this._git.readFile(cwd, filePath)
          .then(({ content, language, isBinary, tooLarge }) =>
            this._send({ type: 'file_read_result', aid, path: filePath, content, language, isBinary, tooLarge }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_write': {
        const { aid, cwd, path: filePath, content } = msg;
        this._git.writeFile(cwd, filePath, content)
          .then(() => this._send({ type: 'file_write_result', aid, path: filePath }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_delete': {
        const { aid, cwd, path: filePath } = msg;
        this._git.deleteFile(cwd, filePath)
          .then(() => this._send({ type: 'file_delete_result', aid, path: filePath }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      case 'file_download': {
        const { aid, cwd, path: filePath } = msg;
        this._git.downloadFile(cwd, filePath, async (index, total, base64, size) => {
          this._send({ type: 'file_download_chunk', aid, path: filePath, index, total, base64, size });
        }).catch(err => {
          this._send({ type: 'file_download_chunk', aid, path: filePath, index: 0, total: 0, error: err.message });
        });
        break;
      }

      case 'file_upload_chunk': {
        const { aid, cwd, path: filePath, index, total, base64 } = msg;
        try {
          const done = this._git.uploadFileChunk(cwd, filePath, index, total, base64, aid);
          if (done) this._send({ type: 'file_upload_result', aid, path: filePath });
        } catch (err) {
          this._git.cancelUpload(aid);
          this._send({ type: 'git_result', aid, success: false, message: err.message });
        }
        break;
      }

      case 'claude_md_read': {
        const { aid } = msg;
        const mdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
        try {
          const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
          this._send({ type: 'claude_md_read_result', aid, content });
        } catch (err) {
          this._send({ type: 'git_result', aid, success: false, message: err.message });
        }
        break;
      }

      case 'claude_md_write': {
        const { aid, content } = msg;
        const mdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
        try {
          fs.mkdirSync(path.dirname(mdPath), { recursive: true });
          fs.writeFileSync(mdPath, content, 'utf8');
          this._send({ type: 'claude_md_write_result', aid });
        } catch (err) {
          this._send({ type: 'git_result', aid, success: false, message: err.message });
        }
        break;
      }

      case 'skill_inject': {
        const { aid, cwd, name, content } = msg;
        this._git.injectSkill(cwd, name, content)
          .then(() => this._send({ type: 'skill_inject_result', aid, name }))
          .catch(err => this._send({ type: 'git_result', aid, success: false, message: err.message }));
        break;
      }

      default:
        break;
    }
  }
}

module.exports = ServerLink;
