'use strict';

const { EventEmitter } = require('events');

class AgentnodeHub extends EventEmitter {
  constructor() {
    super();
    // anid -> { ws, record, sessions, hostname, platform }
    this.online = new Map();
  }

  register(record, ws) {
    const entry = { ws, record, sessions: [], hostname: null, platform: null };
    this.online.set(record.id, entry);
    this.emit('online', { anid: record.id, name: record.name });
    return entry;
  }

  unregister(anid) {
    if (!this.online.has(anid)) return;
    this.online.delete(anid);
    this.emit('offline', { anid });
  }

  onMessage(record, ws, msg) {
    const entry = this.online.get(record.id);
    if (!entry) return;

    switch (msg.type) {
      case 'hello':
        entry.hostname = msg.hostname;
        entry.platform = msg.platform;
        break;

      case 'sessions':
        entry.sessions = msg.sessions || [];
        this.emit('sessions', { anid: record.id, sessions: entry.sessions });
        break;

      case 'session_created':
        if (msg.session) {
          entry.sessions = [...entry.sessions.filter(s => s.id !== msg.session.id), msg.session];
          this.emit('sessions', { anid: record.id, sessions: entry.sessions });
        }
        break;

      case 'session_killed':
        entry.sessions = entry.sessions.filter(s => s.id !== msg.sid);
        this.emit('sessions', { anid: record.id, sessions: entry.sessions });
        break;

      case 'session_renamed':
        if (msg.session) {
          entry.sessions = entry.sessions.map(s => s.id === msg.session.id ? msg.session : s);
          this.emit('sessions', { anid: record.id, sessions: entry.sessions });
        }
        break;

      case 'attached':
      case 'scrollback':
      case 'data':
      case 'acp_event':
      case 'acp_history':
      case 'acp_conversations_result':
      case 'session_exit':
      case 'image_uploaded':
      case 'server_error':
      case 'git_repos':
      case 'git_result':
      case 'git_status_result':
      case 'git_diff_result':
      case 'git_pull_result':
      case 'git_revert_result':
      case 'git_log_result':
      case 'git_branches_result':
      case 'git_checkout_result':
      case 'file_list_result':
      case 'file_list_dir_result':
      case 'file_read_result':
      case 'file_write_result':
      case 'file_delete_result':
      case 'file_upload_result':
      case 'claude_md_read_result':
      case 'claude_md_write_result':
      case 'skill_inject_result':
      case 'file_download_chunk':
        this.emit('relay', { anid: record.id, msg });
        break;

      case 'pong':
        break;

      default:
        break;
    }
  }

  send(anid, msg) {
    const entry = this.online.get(anid);
    if (entry && entry.ws.readyState === 1 /* OPEN */) {
      entry.ws.send(JSON.stringify(msg) + '\n');
    }
  }

  getSnapshot() {
    return [...this.online.entries()].map(([anid, entry]) => ({
      id: anid,
      name: entry.record.name,
      hostname: entry.hostname,
      platform: entry.platform,
      sessions: entry.sessions,
      online: true,
    }));
  }
}

module.exports = AgentnodeHub;
