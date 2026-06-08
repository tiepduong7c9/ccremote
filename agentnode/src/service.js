'use strict';

// Manage a systemd --user service that keeps the ccremote daemon running:
// it starts on boot/login and restarts on crash, so the agentnode reconnects
// to the server automatically without anyone having to run `ccremote link`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVICE_NAME = 'ccremote-daemon.service';
const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = path.join(UNIT_DIR, SERVICE_NAME);
const DAEMON_PATH = path.resolve(__dirname, 'daemon.js');

function assertLinux() {
  if (process.platform !== 'linux') {
    throw new Error(
      `Service management uses systemd and is only supported on Linux (this is ${process.platform}). ` +
      'Run the daemon another way (e.g. launchd on macOS, or keep a terminal open with `ccremote list`).',
    );
  }
}

function unitContents() {
  // ExecStart pins the absolute node + daemon.js paths captured at install time.
  // network-online is a "want" not a hard dep: the ServerLink retries on its own,
  // so the daemon still starts fine if the network is briefly unavailable.
  return `[Unit]
Description=ccremote agentnode daemon
Documentation=https://github.com/tiepduong7c9/ccremote
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=${process.execPath} ${DAEMON_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
}

function systemctl(args, { check = true } = {}) {
  try {
    return execFileSync('systemctl', ['--user', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch (err) {
    if (check) throw err;
    return (err.stdout ? err.stdout.toString() : '').trim();
  }
}

// Enable lingering so the user service starts at boot without an interactive
// login (otherwise a headless/rebooted box won't run it until someone logs in).
function enableLinger() {
  try {
    execFileSync('loginctl', ['enable-linger', os.userInfo().username], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function install() {
  assertLinux();
  fs.mkdirSync(UNIT_DIR, { recursive: true });
  fs.writeFileSync(UNIT_PATH, unitContents());

  systemctl(['daemon-reload']);
  systemctl(['enable', '--now', SERVICE_NAME]);
  const lingered = enableLinger();

  return { unitPath: UNIT_PATH, lingered };
}

function uninstall() {
  assertLinux();
  const existed = fs.existsSync(UNIT_PATH);

  // Best-effort stop/disable; ignore failures (service may not be loaded).
  systemctl(['disable', '--now', SERVICE_NAME], { check: false });

  try { fs.unlinkSync(UNIT_PATH); } catch (_) {}
  systemctl(['daemon-reload'], { check: false });
  systemctl(['reset-failed', SERVICE_NAME], { check: false });

  // Lingering is left enabled on purpose — it is a user-wide setting that other
  // services may rely on, so we don't disable it here.
  return { existed };
}

function status() {
  assertLinux();
  const installed = fs.existsSync(UNIT_PATH);
  const active = systemctl(['is-active', SERVICE_NAME], { check: false });
  const enabled = systemctl(['is-enabled', SERVICE_NAME], { check: false });
  return { installed, active, enabled, unitPath: UNIT_PATH };
}

module.exports = { SERVICE_NAME, UNIT_PATH, install, uninstall, status };
