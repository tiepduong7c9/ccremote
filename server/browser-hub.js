'use strict';

class BrowserHub {
  constructor(agentnodeHub) {
    this._hub = agentnodeHub;
    this.browsers = new Set();
    // aid -> { ws, anid, sid }
    this.attachments = new Map();

    agentnodeHub.on('online', (payload) => this._broadcast({ type: 'agentnode_online', agentnode: payload }));
    agentnodeHub.on('offline', ({ anid }) => {
      // Clean up attachments for this agentnode
      for (const [aid, att] of this.attachments) {
        if (att.anid === anid) this.attachments.delete(aid);
      }
      this._broadcast({ type: 'agentnode_offline', anid });
    });
    agentnodeHub.on('sessions', ({ anid, sessions }) => {
      this._broadcast({ type: 'sessions', anid, sessions });
    });
    agentnodeHub.on('relay', ({ anid, msg }) => {
      this._routeRelay(anid, msg);
    });
  }

  addBrowser(ws) {
    this.browsers.add(ws);
    // Send snapshot immediately
    const snapshot = this._hub.getSnapshot();
    this._sendTo(ws, { type: 'snapshot', agentnodes: snapshot });
  }

  removeBrowser(ws) {
    this.browsers.delete(ws);
    // Detach all attachments owned by this browser
    for (const [aid, att] of this.attachments) {
      if (att.ws === ws) {
        this._hub.send(att.anid, { type: 'detach', aid });
        this.attachments.delete(aid);
      }
    }
  }

  onMessage(ws, msg) {
    const { anid, aid } = msg;

    if (!anid || !this._hub.online.has(anid)) {
      this._sendTo(ws, { type: 'server_error', message: `Agentnode '${anid}' not found or offline` });
      return;
    }

    switch (msg.type) {
      case 'attach':
        this.attachments.set(aid, { ws, anid, sid: msg.sid });
        this._hub.send(anid, { type: 'attach', aid, sid: msg.sid });
        break;

      case 'detach':
        this.attachments.delete(aid);
        this._hub.send(anid, { type: 'detach', aid });
        break;

      case 'input':
        this._hub.send(anid, { type: 'input', aid, data: msg.data });
        break;

      case 'resize':
        this._hub.send(anid, { type: 'resize', aid, cols: msg.cols, rows: msg.rows });
        break;

      case 'create':
        this.attachments.set(aid, { ws, anid, sid: null });
        this._hub.send(anid, { type: 'create', aid, name: msg.name, command: msg.command, cwd: msg.cwd, cols: msg.cols, rows: msg.rows, parentSid: msg.parentSid });
        break;

      case 'kill':
        this._hub.send(anid, { type: 'kill', sid: msg.sid });
        break;

      case 'rename':
        this._hub.send(anid, { type: 'rename', sid: msg.sid, name: msg.name });
        break;

      case 'upload_image':
        this._hub.send(anid, { type: 'upload_image', aid, sid: msg.sid, data: msg.data, ext: msg.ext });
        break;

      default:
        this._sendTo(ws, { type: 'server_error', message: `Unknown message type: ${msg.type}` });
    }
  }

  _routeRelay(anid, msg) {
    if (msg.aid !== undefined) {
      const att = this.attachments.get(msg.aid);
      if (att) {
        // Update sid if this is an 'attached' message from a create
        if (msg.type === 'attached' && msg.sid) att.sid = msg.sid;
        this._sendTo(att.ws, { ...msg, anid });
        return;
      }
    }
    // Broadcast session lifecycle events to all browsers
    if (['session_exit', 'server_error'].includes(msg.type)) {
      this._broadcast({ ...msg, anid });
    }
  }

  _broadcast(msg) {
    const raw = JSON.stringify(msg) + '\n';
    for (const ws of this.browsers) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  _sendTo(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg) + '\n');
  }
}

module.exports = BrowserHub;
