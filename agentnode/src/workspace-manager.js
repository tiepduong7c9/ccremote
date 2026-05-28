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

class WorkspaceManager {
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
    await run(['worktree', 'remove', '--force', abs], repoPath);
  }

  async listBranches(cwd) {
    const abs = resolvePath(cwd);
    const output = await run(['branch', '--list', '--format=%(refname:short)'], abs);
    const branches = output.split('\n').map(b => b.trim()).filter(Boolean);
    return { branches };
  }

  async checkout(cwd, branch) {
    const abs = resolvePath(cwd);
    await run(['checkout', branch], abs);
  }

  async pull(cwd) {
    const abs = resolvePath(cwd);
    const output = await run(['pull'], abs);
    return { output };
  }

  async log(cwd, limit = 30) {
    const abs = resolvePath(cwd);
    const SEP = '\x1f';
    const RS = '\x1e';
    const output = await run([
      'log', `-n${limit}`,
      `--format=%H${SEP}%h${SEP}%an${SEP}%at${SEP}%s${RS}`,
    ], abs).catch(() => '');
    const commits = [];
    for (const entry of output.split(RS)) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const [hash, shortHash, author, atStr, subject] = trimmed.split(SEP);
      if (!hash) continue;
      commits.push({ hash, shortHash, author, timestamp: parseInt(atStr, 10), subject });
    }
    return { commits };
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

  async revertFiles(cwd, paths, includeUntracked) {
    const abs = resolvePath(cwd);
    const { files } = await this.status(cwd);
    const fileMap = new Map(files.map(f => [f.path, f]));

    const resolved = [];
    for (const p of paths) {
      if (fileMap.has(p)) {
        resolved.push(fileMap.get(p));
      } else {
        const prefix = p + '/';
        for (const f of files) {
          if (f.path.startsWith(prefix)) resolved.push(f);
        }
      }
    }

    if (resolved.length === 0) return;

    const addedStaged = resolved.filter(f => f.indexStatus === 'A' && !f.untracked);
    const trackedModified = resolved.filter(f => !f.untracked && f.indexStatus !== 'A');
    const untracked = resolved.filter(f => f.untracked);

    if (addedStaged.length > 0) {
      await run(['reset', 'HEAD', '--', ...addedStaged.map(f => f.path)], abs);
    }
    if (trackedModified.length > 0) {
      await run(['checkout', 'HEAD', '--', ...trackedModified.map(f => f.path)], abs);
    }
    const toClean = [...addedStaged, ...(includeUntracked ? untracked : [])];
    if (toClean.length > 0) {
      await run(['clean', '-fd', '--', ...toClean.map(f => f.path)], abs);
    }
  }

  async listDir(cwd, subPath = '') {
    const abs = resolvePath(cwd);
    const target = subPath ? path.resolve(abs, subPath) : abs;
    if (target !== abs && !target.startsWith(abs + path.sep)) throw new Error('Invalid path');

    const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', 'coverage', '.nyc_output', '.turbo', '.svelte-kit']);
    let raw;
    try { raw = fs.readdirSync(target, { withFileTypes: true }); } catch { return { entries: [] }; }

    const entries = [];
    for (const entry of raw) {
      if (SKIP.has(entry.name)) continue;
      entries.push({ name: entry.name, isDir: entry.isDirectory() });
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { entries };
  }

  async listFiles(cwd) {
    const abs = resolvePath(cwd);
    const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', 'coverage', '.nyc_output', '.turbo', '.svelte-kit']);
    const files = [];
    const MAX = 5000;
    const MAX_DEPTH = 12;

    const walk = (dir, base, depth) => {
      if (files.length >= MAX || depth > MAX_DEPTH) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel, depth + 1);
        } else if (entry.isFile()) {
          files.push(rel);
          if (files.length >= MAX) return;
        }
      }
    };

    walk(abs, '', 0);
    return { files };
  }

  async readFile(cwd, filePath) {
    const abs = resolvePath(cwd);
    const fullPath = path.resolve(abs, filePath);
    if (!fullPath.startsWith(abs + path.sep) && fullPath !== abs) throw new Error('Path traversal denied');
    const MAX = 2 * 1024 * 1024;
    const language = detectLanguage(filePath);
    let stat;
    try { stat = fs.statSync(fullPath); } catch { throw new Error(`File not found: ${filePath}`); }
    if (stat.size > MAX) return { content: '', language, isBinary: false, tooLarge: true };
    const buf = fs.readFileSync(fullPath);
    if (buf.indexOf(0) !== -1) return { content: '', language, isBinary: true, tooLarge: false, base64Content: buf.toString('base64') };
    return { content: buf.toString('utf8'), language, isBinary: false, tooLarge: false };
  }

  async writeFile(cwd, filePath, content) {
    const abs = resolvePath(cwd);
    const fullPath = path.resolve(abs, filePath);
    if (!fullPath.startsWith(abs + path.sep) && fullPath !== abs) throw new Error('Path traversal denied');
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  async deleteFile(cwd, filePath) {
    const abs = resolvePath(cwd);
    const fullPath = path.resolve(abs, filePath);
    if (!fullPath.startsWith(abs + path.sep) && fullPath !== abs) throw new Error('Path traversal denied');
    fs.rmSync(fullPath, { recursive: true, force: true });
  }

  async downloadFile(cwd, filePath, onChunk) {
    const abs = resolvePath(cwd);
    const fullPath = path.resolve(abs, filePath);
    if (!fullPath.startsWith(abs + path.sep) && fullPath !== abs) throw new Error('Path traversal denied');
    let stat;
    try { stat = fs.statSync(fullPath); } catch { throw new Error(`File not found: ${filePath}`); }
    if (stat.isDirectory()) throw new Error('Cannot download a directory');
    const MAX = 1024 * 1024 * 1024; // 1 GB
    if (stat.size > MAX) throw new Error('File exceeds 1 GB download limit');
    // 3 MB per chunk — multiple of 3 so every chunk except the last has no base64 padding
    const CHUNK = 3 * 1024 * 1024;
    const total = Math.max(1, Math.ceil(stat.size / CHUNK));
    const fd = fs.openSync(fullPath, 'r');
    try {
      for (let i = 0; i < total; i++) {
        const len = Math.min(CHUNK, stat.size - i * CHUNK);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, i * CHUNK);
        await onChunk(i, total, buf.toString('base64'), stat.size);
      }
    } finally {
      fs.closeSync(fd);
    }
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

module.exports = WorkspaceManager;
