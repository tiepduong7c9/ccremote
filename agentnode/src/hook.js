'use strict';
// Invoked by Claude Code hooks — reports session status to the ccremote daemon.

const net = require('net');
const os = require('os');
const path = require('path');

const SOCKET_PATH = path.join(os.homedir(), '.ccremote', 'daemon.sock');
const sid = process.env.CCREMOTE_SID;

if (!sid) process.exit(0);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }

  let claudeStatus;
  switch (event.hook_event_name) {
    case 'Stop':
      claudeStatus = 'idle';
      break;
    case 'PreToolUse':
      claudeStatus = event.tool_name === 'AskUserQuestion' ? 'waiting' : 'working';
      break;
    case 'PostToolUse':
      claudeStatus = 'working';
      break;
    default: process.exit(0);
  }

  const msg = JSON.stringify({ type: 'set_claude_status', sid, claudeStatus }) + '\n';
  const socket = net.createConnection(SOCKET_PATH, () => {
    socket.write(msg);
    socket.end();
  });
  socket.on('error', () => process.exit(0));
});
