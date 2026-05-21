'use strict';

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

async function browserWsRoute(fastify, { agentnodeHub, browserHub }) {
  fastify.get('/ws/browser', { websocket: true }, async (socket, request) => {
    // Auth check via cookie
    const cookie = request.cookies?.['ccremote_session'];
    if (!cookie) {
      socket.close(1008, 'Unauthorized');
      return;
    }
    const unsigned = request.unsignCookie(cookie);
    if (!unsigned.valid || unsigned.value !== 'authenticated') {
      socket.close(1008, 'Unauthorized');
      return;
    }

    browserHub.addBrowser(socket);

    const parser = new MessageParser((msg) => browserHub.onMessage(socket, msg));
    socket.on('message', (raw) => parser.feed(raw.toString()));

    socket.on('close', () => browserHub.removeBrowser(socket));
    socket.on('error', () => browserHub.removeBrowser(socket));
  });
}

module.exports = browserWsRoute;
