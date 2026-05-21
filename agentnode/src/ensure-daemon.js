'use strict';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { SOCKET_PATH } = require('./constants');
const DaemonClient = require('./client');

function canConnect() {
  return new Promise((resolve) => {
    const sock = net.createConnection(SOCKET_PATH);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function ensureDaemon() {
  if (await canConnect()) return;

  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, 'daemon.js')],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  // Poll until daemon socket is ready (up to 2 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await canConnect()) return;
  }

  throw new Error('Failed to start ccremote daemon. Run: node src/daemon.js');
}

async function getClient() {
  await ensureDaemon();
  const client = new DaemonClient();
  await client.connect();
  return client;
}

module.exports = { ensureDaemon, getClient };
