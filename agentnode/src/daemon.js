'use strict';

const net = require('net');
const fs = require('fs');
const SessionManager = require('./session-manager');
const { encode, MessageParser } = require('./protocol');
const { STATE_DIR, SOCKET_PATH, PID_FILE } = require('./constants');
const { load: loadConfig } = require('./config');
const ServerLink = require('./server-link');

function startDaemon() {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Remove stale socket from a previous run
  try { fs.unlinkSync(SOCKET_PATH); } catch (_) {}

  fs.writeFileSync(PID_FILE, String(process.pid));

  const manager = new SessionManager();

  let link = null;
  const cfg = loadConfig();
  if (cfg.serverUrl && cfg.token) {
    link = new ServerLink({ serverUrl: cfg.serverUrl, token: cfg.token, manager });
    link.start();
    process.stderr.write(`ccremote daemon: linking to ${cfg.serverUrl}\n`);
  }

  const server = net.createServer((socket) => {
    let attachedId = null;
    let attachedListener = null;

    const cleanupAttach = () => {
      if (attachedId && attachedListener) {
        manager.detach(attachedId, attachedListener);
        attachedId = null;
        attachedListener = null;
      }
    };

    socket.on('error', cleanupAttach);
    socket.on('close', cleanupAttach);

    const parser = new MessageParser((msg) => handleMessage(socket, msg));
    socket.on('data', (chunk) => parser.feed(chunk));

    function send(obj) {
      if (!socket.destroyed) socket.write(encode(obj));
    }

    function handleMessage(socket, msg) {
      switch (msg.type) {

        case 'ping':
          send({ type: 'pong' });
          break;

        case 'create': {
          try {
            const meta = manager.create({
              name: msg.name,
              cwd: msg.cwd,
              command: msg.command,
              args: msg.args,
              cols: msg.cols,
              rows: msg.rows,
            });
            send({ type: 'created', session: meta });
          } catch (err) {
            send({ type: 'server_error', message: err.message });
          }
          break;
        }

        case 'list':
          send({ type: 'list_response', sessions: manager.list() });
          break;

        case 'attach': {
          // Resolve by name or ID prefix
          const meta = manager.resolve(msg.id);
          if (!meta) {
            send({ type: 'server_error', message: `Session '${msg.id}' not found` });
            break;
          }
          if (meta.status === 'exited') {
            send({ type: 'server_error', message: `Session '${msg.id}' has exited` });
            break;
          }

          const listener = (event) => {
            if (socket.destroyed) return;
            if (event.type === 'data') {
              send({ type: 'data', data: event.data.toString('base64') });
            } else if (event.type === 'exit') {
              send({ type: 'session_exit', code: event.code });
            }
          };

          const result = manager.attach(meta.id, listener);
          if (!result) {
            send({ type: 'server_error', message: `Failed to resume session '${msg.id}'` });
            break;
          }
          attachedId = meta.id;
          attachedListener = listener;

          if (result.scrollback.length > 0) {
            send({ type: 'scrollback', data: result.scrollback.toString('base64') });
          }
          send({ type: 'attached', session: result.meta });
          break;
        }

        case 'detach':
          cleanupAttach();
          send({ type: 'detached' });
          break;

        case 'input':
          if (attachedId) {
            manager.write(attachedId, Buffer.from(msg.data, 'base64'));
          }
          break;

        case 'resize':
          if (attachedId) {
            manager.resize(attachedId, msg.cols, msg.rows);
          } else if (msg.id) {
            manager.resize(msg.id, msg.cols, msg.rows);
          }
          break;

        case 'kill': {
          const ok = manager.kill(msg.id);
          send({ type: 'kill_response', success: ok });
          break;
        }

        case 'rename': {
          const renamed = manager.rename(msg.id, msg.name);
          if (!renamed) {
            send({ type: 'server_error', message: `Session '${msg.id}' not found` });
          } else {
            send({ type: 'renamed', session: renamed });
          }
          break;
        }

        case 'set_claude_status':
          manager.setClaudeStatus(msg.sid, msg.claudeStatus);
          break;

        default:
          send({ type: 'server_error', message: `Unknown command: ${msg.type}` });
      }
    }
  });

  server.listen(SOCKET_PATH, () => {
    process.stderr.write(`ccremote daemon started (pid=${process.pid}, socket=${SOCKET_PATH})\n`);
  });

  const shutdown = () => {
    if (link) link.stop();
    manager.suspendAll();
    server.close();
    try { fs.unlinkSync(SOCKET_PATH); } catch (_) {}
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  startDaemon();
}

module.exports = { startDaemon };
