import type { Terminal } from '@xterm/xterm';

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
import type { ServerMsg } from './lib/protocol';
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
  private retries = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

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
        registry.applySnapshot(msg.agentnodes);
        break;

      case 'agentnode_online':
        registry.setOnline(msg.agentnode);
        break;

      case 'agentnode_offline':
        registry.setOffline(msg.anid);
        break;

      case 'sessions':
        registry.setSessions(msg.anid, msg.sessions);
        break;

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
        registry.setSessions(msg.anid, registry.agentnodes.get(msg.anid)?.sessions.map(s =>
          s.id === msg.sid ? { ...s, status: 'exited' as const } : s
        ) || []);
        break;

      case 'server_error':
        console.error('[ccremote]', msg.message);
        break;
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

  create(anid: string, aid: string, opts: { name?: string; command?: string; cwd?: string; cols: number; rows: number }) {
    this.send({ type: 'create', anid, aid, ...opts });
  }

  kill(anid: string, sid: string) {
    this.send({ type: 'kill', anid, sid });
  }

  rename(anid: string, sid: string, name: string) {
    this.send({ type: 'rename', anid, sid, name });
  }
}

export const browserSocket = new BrowserSocket();
