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
}

module.exports = GitManager;
