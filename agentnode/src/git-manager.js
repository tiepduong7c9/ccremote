'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATE_DIR } = require('./constants');

const REPOS_FILE = path.join(STATE_DIR, 'repos.json');

function resolvePath(p) {
  return path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
}

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

// Resolves with raw stdout Buffer (no encoding conversion, no trim).
// Rejects on any non-zero exit.
function runBuf(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()));
      else resolve(stdout);
    });
  });
}

const LANG_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cc: 'cpp', h: 'cpp', hh: 'cpp', cs: 'csharp',
  php: 'php', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  less: 'less', json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', sh: 'shell', bash: 'shell', zsh: 'shell',
  xml: 'xml', sql: 'sql', kt: 'kotlin', swift: 'swift', dart: 'dart',
  lua: 'lua', tf: 'hcl', toml: 'toml', ini: 'ini',
  vue: 'html', svelte: 'html',
};

function detectLanguage(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  const ext = base.split('.').pop() || '';
  return LANG_MAP[ext] || 'plaintext';
}

function parseWorktrees(output) {
  const worktrees = [];
  const blocks = output.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const wt = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace('refs/heads/', '');
      else if (line === 'detached') wt.detached = true;
    }
    if (wt.path) worktrees.push({
      path: wt.path,
      branch: wt.branch || (wt.detached ? '(detached)' : null),
      isMain: worktrees.length === 0,
    });
  }
  return worktrees;
}

class GitManager {
  constructor() {
    this._repos = [];
    this._load();
  }

  _load() {
    try {
      this._repos = JSON.parse(fs.readFileSync(REPOS_FILE, 'utf8'));
    } catch (_) {
      this._repos = [];
    }
  }

  _save() {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(REPOS_FILE, JSON.stringify(this._repos, null, 2));
    } catch (_) {}
  }

  async clone(url, localPath) {
    const abs = resolvePath(localPath);
    await run(['clone', url, abs], os.homedir());
    if (!this._repos.find(r => r.localPath === abs)) {
      this._repos.push({ localPath: abs, url });
      this._save();
    }
  }

  addRepo(localPath) {
    const abs = resolvePath(localPath);
    if (!this._repos.find(r => r.localPath === abs)) {
      this._repos.push({ localPath: abs });
      this._save();
    }
  }

  removeRepo(localPath) {
    const abs = resolvePath(localPath);
    this._repos = this._repos.filter(r => r.localPath !== abs);
    this._save();
  }

  async listRepos() {
    const results = [];
    for (const repo of this._repos) {
      let worktrees = [];
      try {
        const out = await run(['worktree', 'list', '--porcelain'], repo.localPath);
        worktrees = parseWorktrees(out);
      } catch (_) {}
      results.push({ ...repo, worktrees });
    }
    return results;
  }

  async addWorktree(repoPath, worktreePath, branch) {
    const abs = worktreePath
      ? resolvePath(worktreePath)
      : path.join(path.dirname(repoPath), branch);
    await run(['fetch', 'origin'], repoPath);
    await run(['worktree', 'add', '-b', branch, abs, 'origin/HEAD'], repoPath);
  }

  async removeWorktree(repoPath, worktreePath) {
    const abs = resolvePath(worktreePath);
    await run(['worktree', 'remove', abs], repoPath);
  }

  async status(cwd) {
    const abs = resolvePath(cwd);
    const [porcelainBuf, branch] = await Promise.all([
      runBuf(['status', '--porcelain=v1', '-z', '--untracked-files=all'], abs),
      run(['rev-parse', '--abbrev-ref', 'HEAD'], abs).catch(() => 'HEAD'),
    ]);
    const porcelain = porcelainBuf.toString('utf8');

    const files = [];
    if (porcelain) {
      // -z output: null-separated entries. Renames have two paths separated by NUL.
      const entries = porcelain.split('\0');
      let i = 0;
      while (i < entries.length) {
        const entry = entries[i];
        if (!entry) { i++; continue; }
        const indexStatus = entry[0];
        const worktreeStatus = entry[1];
        const filePath = entry.slice(3);
        const file = { path: filePath, indexStatus, worktreeStatus, staged: false, untracked: false };
        if (indexStatus === 'R' || indexStatus === 'C') {
          file.oldPath = entries[i + 1];
          i += 2;
        } else {
          i++;
        }
        file.staged = indexStatus !== ' ' && indexStatus !== '?';
        file.untracked = indexStatus === '?' && worktreeStatus === '?';
        files.push(file);
      }
    }

    return { branch, files };
  }

  async fileContents(cwd, filePath) {
    const abs = resolvePath(cwd);
    const fullPath = path.join(abs, filePath);
    const MAX_BYTES = 2 * 1024 * 1024;
    const language = detectLanguage(filePath);

    // ── Old content (committed version in HEAD) ───────────────────────────────
    let oldContent = '';
    let isBinary = false;
    try {
      const buf = await runBuf(['show', `HEAD:${filePath}`], abs);
      if (buf.length > MAX_BYTES) return { oldContent: '', newContent: '', language, isBinary: false, tooLarge: true };
      if (buf.indexOf(0) !== -1) { isBinary = true; }
      else oldContent = buf.toString('utf8');
    } catch (_) {
      // File not in HEAD — new / untracked file
    }

    if (isBinary) return { oldContent: '', newContent: '', language, isBinary: true, tooLarge: false };

    // ── New content (working tree) ────────────────────────────────────────────
    let newContent = '';
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_BYTES) return { oldContent: '', newContent: '', language, isBinary: false, tooLarge: true };
      const buf = fs.readFileSync(fullPath);
      if (buf.indexOf(0) !== -1) return { oldContent: '', newContent: '', language, isBinary: true, tooLarge: false };
      newContent = buf.toString('utf8');
    } catch (_) {
      // File absent from working tree — deleted file; newContent stays ''
    }

    return { oldContent, newContent, language, isBinary: false, tooLarge: false };
  }
}

module.exports = GitManager;
