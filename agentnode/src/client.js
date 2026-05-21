'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { encode, MessageParser } = require('./protocol');
const { SOCKET_PATH } = require('./constants');

class DaemonClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(SOCKET_PATH);
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);

      const parser = new MessageParser((msg) => {
        // 'error' is a reserved EventEmitter event that throws if unhandled;
        // remap daemon error messages to a safe event name.
        const eventName = msg.type === 'error' ? 'server_error' : msg.type;
        this.emit(eventName, msg);
      });

      this.socket.on('data', (chunk) => parser.feed(chunk));
      this.socket.on('error', (err) => this.emit('socket_error', err));
      this.socket.on('close', () => this.emit('socket_close'));
    });
  }

  // Send a message and wait for a specific response type.
  // Also resolves immediately on 'server_error' (rejects the promise).
  request(msg, responseType, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => { cleanup(); reject(new Error(`Request '${msg.type}' timed out`)); },
        timeoutMs,
      );

      const onOk = (res) => { cleanup(); resolve(res); };
      const onErr = (res) => { cleanup(); reject(new Error(res.message || 'Daemon error')); };

      const cleanup = () => {
        clearTimeout(timer);
        this.off(responseType, onOk);
        this.off('server_error', onErr);
      };

      this.once(responseType, onOk);
      this.once('server_error', onErr);
      this._send(msg);
    });
  }

  _send(msg) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encode(msg));
    }
  }

  ping()              { return this.request({ type: 'ping' }, 'pong'); }
  create(opts)        { return this.request({ type: 'create', ...opts }, 'created'); }
  list()              { return this.request({ type: 'list' }, 'list_response'); }
  attach(id)          { return this.request({ type: 'attach', id }, 'attached'); }
  detach()            { return this.request({ type: 'detach' }, 'detached'); }
  kill(id)            { return this.request({ type: 'kill', id }, 'kill_response'); }
  rename(id, name)    { return this.request({ type: 'rename', id, name }, 'renamed'); }

  sendInput(buf) {
    this._send({ type: 'input', data: buf.toString('base64') });
  }

  sendResize(cols, rows) {
    this._send({ type: 'resize', cols, rows });
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

module.exports = DaemonClient;
