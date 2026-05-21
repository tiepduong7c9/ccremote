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
      });
      session = res.session;
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      client.close();
      process.exit(1);
    }

    console.error(chalk.green('✔ Created session'), chalk.bold(session.id), chalk.dim(`name=${session.name}`));

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
