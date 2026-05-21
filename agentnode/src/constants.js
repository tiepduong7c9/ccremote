'use strict';

const path = require('path');
const os = require('os');

const STATE_DIR = path.join(os.homedir(), '.ccremote');
const SOCKET_PATH = path.join(STATE_DIR, 'daemon.sock');
const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
const SESSIONS_FILE = path.join(STATE_DIR, 'sessions.json');

module.exports = { STATE_DIR, SOCKET_PATH, PID_FILE, SESSIONS_FILE };
