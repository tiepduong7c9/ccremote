#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const { getClient } = require('../src/ensure-daemon');
const pkg = require('../package.json');

program
  .name('ccremote')
  .description('Manage Claude Code sessions')
  .version(pkg.version);

// ── new ───────────────────────────────────────────────────────────────────────
program
  .command('new [name]')
  .alias('n')
  .description('Create a new session (and attach by default)')
  .option('--no-attach', 'Create without attaching')
  .option('--acp', 'Use the Agent Client Protocol (structured chat, browser-only)')
  .option('--cmd <command>', 'Command to run inside the session', 'claude')
  .option('--cwd <path>', 'Working directory for the session')
  .action(async (name, opts) => {
    const client = await getClient();
    let session;
    try {
      const res = await client.create({
        name,
        command: opts.cmd,
        cwd: opts.cwd || process.cwd(),
        cols: process.stdout.columns || 220,
        rows: process.stdout.rows || 50,
        ...(opts.acp && { mode: 'acp' }),
      });
      session = res.session;
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      client.close();
      process.exit(1);
    }

    console.error(chalk.green('✔ Created session'), chalk.bold(session.id), chalk.dim(`name=${session.name}`));

    // ACP sessions render as a structured chat in the browser, not a raw terminal,
    // so there's nothing to attach to from the CLI.
    if (opts.acp) {
      console.error(chalk.dim('  ACP session — open it in the ccremote web UI to chat.'));
      client.close();
      return;
    }

    if (opts.attach === false) {
      client.close();
      return;
    }

    client.close();
    await doAttach(session.id);
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .alias('ls')
  .description('List all sessions')
  .action(async () => {
    const client = await getClient();
    const res = await client.list();
    client.close();

    const sessions = res.sessions;
    if (sessions.length === 0) {
      console.log(chalk.dim('No sessions.'));
      return;
    }

    const W = { id: 10, name: 22, status: 9, created: 20 };
    const header =
      'ID'.padEnd(W.id) + '  ' +
      'NAME'.padEnd(W.name) + '  ' +
      'STATUS'.padEnd(W.status) + '  ' +
      'CREATED'.padEnd(W.created) + '  ' +
      'CWD';
    console.log(chalk.bold(header));
    console.log(chalk.dim('─'.repeat(Math.min(process.stdout.columns || 120, 120))));

    for (const s of sessions) {
      const statusStr = s.status === 'running'
        ? chalk.green(s.status.padEnd(W.status))
        : s.status === 'suspended'
          ? chalk.yellow(s.status.padEnd(W.status))
          : chalk.red(s.status.padEnd(W.status));
      const created = new Date(s.createdAt).toLocaleString('en-GB', {
        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      console.log(
        chalk.cyan(s.id.padEnd(W.id)) + '  ' +
        (s.name || '').slice(0, W.name - 1).padEnd(W.name) + '  ' +
        statusStr + '  ' +
        created.padEnd(W.created) + '  ' +
        chalk.dim(s.cwd),
      );
    }
  });

// ── attach ────────────────────────────────────────────────────────────────────
program
  .command('attach <id>')
  .alias('a')
  .description('Attach to a session (press Ctrl+\\ to detach)')
  .action(async (id) => {
    await doAttach(id);
  });

// ── kill ──────────────────────────────────────────────────────────────────────
program
  .command('kill <id>')
  .alias('k')
  .description('Kill and remove a session')
  .action(async (id) => {
    const client = await getClient();
    let res;
    try {
      res = await client.kill(id);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      client.close();
      process.exit(1);
    }
    client.close();
    if (res.success) {
      console.log(chalk.green('✔ Killed session:'), id);
    } else {
      console.error(chalk.red('Session not found:'), id);
      process.exit(1);
    }
  });

// ── rename ────────────────────────────────────────────────────────────────────
program
  .command('rename <id> <name>')
  .description('Rename a session')
  .action(async (id, name) => {
    const client = await getClient();
    try {
      const res = await client.rename(id, name);
      console.log(chalk.green('✔ Renamed:'), res.session.id, '→', chalk.bold(res.session.name));
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    } finally {
      client.close();
    }
  });

// ── daemon:stop ───────────────────────────────────────────────────────────────
program
  .command('daemon:stop')
  .description('Stop the daemon process')
  .action(() => {
    const fs = require('fs');
    const { PID_FILE } = require('../src/constants');
    if (!fs.existsSync(PID_FILE)) {
      console.log(chalk.dim('Daemon is not running.'));
      return;
    }
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green('✔ Daemon stopped') + chalk.dim(` (pid=${pid})`));
    } catch (e) {
      console.error(chalk.red('Failed to stop daemon:'), e.message);
    }
  });

// ── daemon:status ─────────────────────────────────────────────────────────────
program
  .command('daemon:status')
  .description('Show daemon status')
  .action(async () => {
    const fs = require('fs');
    const { PID_FILE, SOCKET_PATH } = require('../src/constants');

    const pidExists = fs.existsSync(PID_FILE);
    const sockExists = fs.existsSync(SOCKET_PATH);
    const pid = pidExists ? fs.readFileSync(PID_FILE, 'utf8').trim() : null;

    if (!pidExists && !sockExists) {
      console.log(chalk.red('●') + ' Daemon is not running');
      return;
    }

    // Try to ping it
    try {
      const client = new (require('../src/client'))();
      await client.connect();
      await client.ping();
      client.close();
      console.log(chalk.green('●') + ` Daemon is running (pid=${pid}, socket=${SOCKET_PATH})`);
    } catch (_) {
      console.log(chalk.yellow('●') + ` Daemon socket exists but is not responding (pid=${pid})`);
    }
  });

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage server connection config');

configCmd
  .command('show')
  .description('Show current config (token redacted)')
  .action(() => {
    const cfg = require('../src/config').load();
    const display = { ...cfg };
    if (display.token) display.token = display.token.slice(0, 8) + '…';
    console.log(JSON.stringify(display, null, 2));
  });

configCmd
  .command('set-server <url>')
  .description('Set the server WebSocket URL')
  .action((url) => {
    require('../src/config').update({ serverUrl: url });
    console.log(chalk.green('✔ serverUrl set to'), url);
  });

configCmd
  .command('set-token <token>')
  .description('Set the agentnode bearer token')
  .action((token) => {
    require('../src/config').update({ token });
    console.log(chalk.green('✔ token saved'));
  });

configCmd
  .command('clear')
  .description('Clear all config')
  .action(() => {
    require('../src/config').save({});
    console.log(chalk.green('✔ Config cleared'));
  });

// ── link ──────────────────────────────────────────────────────────────────────
program
  .command('link')
  .description('Restart daemon to apply new server config')
  .action(async () => {
    const fs = require('fs');
    const { PID_FILE } = require('../src/constants');
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
      await new Promise(r => setTimeout(r, 500));
    }
    const { ensureDaemon } = require('../src/ensure-daemon');
    await ensureDaemon();
    console.log(chalk.green('✔ Daemon restarted with new config'));
    const svc = require('../src/service');
    if (process.platform === 'linux') {
      const st = svc.status();
      if (!st.installed) {
        console.log(chalk.dim('Tip: run `ccremote service install` to start the daemon on boot and reconnect automatically.'));
      }
    }
  });

// ── service ─────────────────────────────────────────────────────────────────--
const serviceCmd = program
  .command('service')
  .description('Manage the systemd user service that keeps the daemon running');

serviceCmd
  .command('install')
  .description('Install + enable a systemd user service so the daemon starts on boot and reconnects automatically')
  .action(() => {
    try {
      const { install } = require('../src/service');
      const { unitPath, lingered } = install();
      console.log(chalk.green('✔ Service installed and started'));
      console.log(chalk.dim(`  unit: ${unitPath}`));
      if (lingered) {
        console.log(chalk.dim('  lingering enabled — daemon will start at boot without login'));
      } else {
        console.log(chalk.yellow('  ! could not enable lingering; daemon may not start until you log in.'));
        console.log(chalk.dim(`    enable it manually: loginctl enable-linger ${require('os').userInfo().username}`));
      }
    } catch (err) {
      console.error(chalk.red('✖ ' + err.message));
      process.exit(1);
    }
  });

serviceCmd
  .command('uninstall')
  .alias('remove')
  .description('Stop, disable, and remove the systemd user service')
  .action(() => {
    try {
      const { uninstall } = require('../src/service');
      const { existed } = uninstall();
      console.log(chalk.green(existed ? '✔ Service stopped and removed' : '✔ Nothing to remove (service was not installed)'));
    } catch (err) {
      console.error(chalk.red('✖ ' + err.message));
      process.exit(1);
    }
  });

serviceCmd
  .command('status')
  .description('Show whether the systemd user service is installed, enabled, and active')
  .action(() => {
    try {
      const { status } = require('../src/service');
      const st = status();
      if (!st.installed) {
        console.log(chalk.yellow('● Not installed') + chalk.dim('  (run `ccremote service install`)'));
        return;
      }
      const dot = st.active === 'active' ? chalk.green('●') : chalk.red('●');
      console.log(`${dot} active: ${st.active}    enabled: ${st.enabled}`);
      console.log(chalk.dim(`  unit: ${st.unitPath}`));
    } catch (err) {
      console.error(chalk.red('✖ ' + err.message));
      process.exit(1);
    }
  });

// ── attach implementation ─────────────────────────────────────────────────────

async function doAttach(nameOrId) {
  const client = await getClient();

  // Resolve session by name or ID prefix via list
  const listRes = await client.list();
  const match = listRes.sessions.find(s =>
    s.id === nameOrId ||
    s.name === nameOrId ||
    s.id.startsWith(nameOrId),
  );

  if (!match) {
    console.error(chalk.red('Session not found:'), nameOrId);
    client.close();
    process.exit(1);
  }

  if (match.status === 'exited') {
    console.error(chalk.yellow(`Session '${match.name}' has already exited.`));
    client.close();
    process.exit(0);
  }

  if (match.status === 'suspended') {
    process.stderr.write(chalk.yellow(`[resuming suspended session '${match.name}'...]\r\n`));
  }

  // Register live data/event listeners BEFORE sending attach to avoid missing output.
  // Scrollback is intentionally skipped: Claude Code is a full-screen TUI that uses
  // absolute cursor positioning. Replaying raw scrollback bytes on a non-blank terminal
  // corrupts the display. Instead we send a resize after attaching, which always triggers
  // SIGWINCH → Claude Code clears the screen and redraws its full UI from scratch.
  client.on('data', (msg) => {
    process.stdout.write(Buffer.from(msg.data, 'base64'));
  });

  client.on('session_exit', (msg) => {
    restore();
    process.stderr.write(chalk.yellow(`\r\n[session '${match.name}' exited with code ${msg.code}]\r\n`));
    client.close();
    process.exit(0);
  });

  client.on('socket_close', () => {
    restore();
    process.stderr.write(chalk.red('\r\n[daemon disconnected]\r\n'));
    process.exit(1);
  });

  try {
    await client.attach(match.id);
  } catch (err) {
    console.error(chalk.red('Attach failed:'), err.message);
    client.close();
    process.exit(1);
  }

  // Force a redraw by sending a transient size change then the real size.
  // Both resizes must be in separate event-loop ticks: if they arrive at the
  // daemon in the same sync batch both ioctls fire before Claude Code's loop
  // runs, Linux collapses the two SIGWINCH into one, and the PTY is back at
  // the original rows when the handler fires — Ink sees no size change and
  // skips the redraw entirely.  A 50 ms gap guarantees the first SIGWINCH is
  // fully handled before the correcting resize arrives.
  process.stdout.write('\x1b[2J\x1b[H');
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  client.sendResize(cols, rows + 1);
  setTimeout(() => client.sendResize(cols, rows), 50);

  process.stderr.write(chalk.dim(`[attached to '${match.name}' (${match.id}) — Ctrl+\\ to detach]\r\n`));

  // Enter raw mode so all keystrokes go directly to the PTY
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch (_) {}
    }
    process.stdin.pause();
    process.stdout.removeListener('resize', onResize);
  }

  function onResize() {
    if (process.stdout.columns && process.stdout.rows) {
      client.sendResize(process.stdout.columns, process.stdout.rows);
    }
  }
  process.stdout.on('resize', onResize);

  process.stdin.on('data', async (chunk) => {
    if (restored) return;

    // Ctrl+\ (0x1C) — detach
    if (chunk.length === 1 && chunk[0] === 0x1c) {
      restore();
      try { await client.detach(); } catch (_) {}
      process.stderr.write(chalk.dim('\r\n[detached]\r\n'));
      client.close();
      process.exit(0);
      return;
    }

    client.sendInput(chunk);
  });
}

program.parse(process.argv);
