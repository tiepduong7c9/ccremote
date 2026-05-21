'use strict';

const PING_INTERVAL_MS = 25000;
const PONG_TIMEOUT_MS = 60000;

function encode(obj) {
  return JSON.stringify(obj) + '\n';
}

class MessageParser {
  constructor(onMessage) {
    this._buf = '';
    this._onMessage = onMessage;
  }
  feed(data) {
    this._buf += data.toString();
    const lines = this._buf.split('\n');
    this._buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this._onMessage(JSON.parse(line)); } catch (_) {}
    }
  }
}

async function agentnodeWsRoute(fastify, { store, agentnodeHub }) {
  fastify.get('/ws/agentnode', { websocket: true }, (socket, request) => {
    const authHeader = request.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const record = token ? store.findByToken(token) : null;

    if (!record) {
      socket.send(encode({ type: 'rejected', reason: 'Invalid token' }));
      socket.close();
      return;
    }

    socket.send(encode({ type: 'welcome', agentnodeId: record.id, name: record.name }));
    const entry = agentnodeHub.register(record, socket);

    const parser = new MessageParser((msg) => agentnodeHub.onMessage(record, socket, msg));
    socket.on('message', (raw) => parser.feed(raw.toString()));

    let lastPong = Date.now();

    const pingTimer = setInterval(() => {
      if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
        socket.close(1001, 'Pong timeout');
        return;
      }
      socket.send(encode({ type: 'ping' }));
    }, PING_INTERVAL_MS);

    const origOnMessage = socket.listeners('message').slice(-1)[0];
    socket.on('message', (raw) => {
      const str = raw.toString().trim();
      if (str.includes('"pong"')) lastPong = Date.now();
    });

    socket.on('close', () => {
      clearInterval(pingTimer);
      agentnodeHub.unregister(record.id);
    });

    socket.on('error', () => {
      clearInterval(pingTimer);
    });
  });
}

module.exports = agentnodeWsRoute;
