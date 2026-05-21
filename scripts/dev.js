#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function color(name) {
  const colors = { daemon: '\x1b[36m', server: '\x1b[32m', web: '\x1b[35m' };
  return colors[name] || '\x1b[0m';
}

function tag(name, line) {
  return `${color(name)}[${name}]\x1b[0m ${line}`;
}

function spawnChild(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'pipe', ...opts });

  child.stdout.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach(l => console.log(tag(name, l)));
  });
  child.stderr.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach(l => console.error(tag(name, l)));
  });
  child.on('exit', (code) => {
    console.log(tag(name, `exited with code ${code}`));
  });

  return child;
}

const daemon = spawnChild('daemon', process.execPath, [path.join(root, 'agentnode/src/daemon.js')]);
const server = spawnChild('server', process.execPath, [path.join(root, 'server/index.js')]);
const web = spawnChild('web', 'npm', ['--workspace', '@ccremote/web', 'run', 'dev']);

function shutdown() {
  daemon.kill('SIGTERM');
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('ccremote dev: daemon + server + web started. Ctrl+C to stop.');
