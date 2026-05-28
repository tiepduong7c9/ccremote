import { useState, useRef, useEffect } from 'react';
import { useRegistryStore } from '../store';
import { browserSocket } from '../ws';
import { nanoid } from 'nanoid';
import type { AgentnodeView, GitRepo, SessionMeta } from '../lib/protocol';
import { Plus, X, Server, Copy, Check, Cable, ChevronDown, Settings, GitBranch, FolderGit2, Trash2, ChevronRight, FileText } from 'lucide-react';

// ── Add Node Modal ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="btn btn-xs btn-ghost gap-1" onClick={copy} title="Copy">
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AddAgentnodeModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<{ id: string; token: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  useEffect(() => {
    fetch('/api/info').then(r => r.json()).then(d => setServerUrl(d.serverUrl));
  }, []);

  const linkCmd = result && serverUrl
    ? `ccremote config set-server ${serverUrl} && ccremote config set-token ${result.token} && ccremote link`
    : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/agentnodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setResult(data);
    setLoading(false);
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Server size={18} /> Add Agent Node
        </h3>
        {!result ? (
          <form onSubmit={submit}>
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Name</span></label>
              <input
                className="input input-bordered"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. my-laptop"
                autoFocus
              />
            </div>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary gap-2" disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : <><Plus size={15} /> Create</>}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mt-4 text-sm text-base-content/70">
              Agent node <strong>{result.name}</strong> created. Run this on the agent node machine to link it:
            </p>
            <div className="mt-2 rounded-lg bg-base-300">
              <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-xs text-base-content/40 font-mono">Link command</span>
                <CopyButton text={linkCmd} />
              </div>
              <div className="overflow-x-auto px-3 pb-3">
                <pre className="text-sm">{`ccremote config set-server ${serverUrl}\nccremote config set-token ${result.token}\nccremote link`}</pre>
              </div>
            </div>
            <p className="mt-3 text-xs text-base-content/50">Token — save this, it's shown only once:</p>
            <div className="mt-1 rounded-lg bg-base-300">
              <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-xs text-base-content/40 font-mono">Token</span>
                <CopyButton text={result.token} />
              </div>
              <div className="overflow-x-auto px-3 pb-3">
                <pre className="text-sm"><code>{result.token}</code></pre>
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <p className="text-sm">{message}</p>
        <div className="modal-action">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-error btn-sm" onClick={() => { onConfirm(); onClose(); }}>Kill</button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

// ── Recent CWDs ───────────────────────────────────────────────────────────────

const RECENT_CWDS_KEY = 'ccremote:recent-cwds';
const MAX_RECENT = 8;

function loadRecentCwds(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_CWDS_KEY) || '[]'); } catch { return []; }
}

export function saveRecentCwd(cwd: string) {
  const recent = [cwd, ...loadRecentCwds().filter(c => c !== cwd)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(recent));
}

// ── CWD Combobox ──────────────────────────────────────────────────────────────

function CwdCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = loadRecentCwds();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div className="input input-bordered flex items-center gap-1 pr-1 font-mono text-sm">
        <input
          className="flex-1 bg-transparent outline-none min-w-0"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="~ or /absolute/path"
          autoFocus
        />
        {recent.length > 0 && (
          <button
            type="button"
            className="shrink-0 text-base-content/40 hover:text-base-content transition-colors px-1"
            onClick={() => setOpen(o => !o)}
            tabIndex={-1}
          >
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {open && recent.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg overflow-hidden">
          {recent.map(r => (
            <li
              key={r}
              className={`px-3 py-1.5 text-sm font-mono cursor-pointer hover:bg-base-200 transition-colors ${value === r ? 'bg-base-200 text-primary' : ''}`}
              onMouseDown={e => { e.preventDefault(); onChange(r); setOpen(false); }}
            >{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── New Session Modal ─────────────────────────────────────────────────────────

function NewSessionModal({ anid, onClose, onCreate }: { anid: string; onClose: () => void; onCreate: (cwd: string, name: string) => void }) {
  const [cwd, setCwd] = useState('~');
  const [name, setName] = useState('');
  const [repos, setRepos] = useState<GitRepo[] | null>(null);

  useEffect(() => {
    browserSocket.gitRepoList(anid, nanoid(8), (r) => { if (r) setRepos(r); });
  }, [anid]);

  const worktrees = repos?.flatMap(r => r.worktrees.map(wt => ({ ...wt, repoPath: r.localPath }))) ?? [];

  const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(cwd.trim() || '~', name.trim());
    onClose();
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Plus size={18} /> New Session
        </h3>
        <form onSubmit={submit}>
          {repos === null ? (
            <div className="flex justify-center py-4"><span className="loading loading-spinner loading-sm" /></div>
          ) : worktrees.length > 0 ? (
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Worktree</span></label>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {worktrees.map(wt => (
                  <button
                    key={wt.path}
                    type="button"
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${cwd === wt.path ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}`}
                    onClick={() => setCwd(wt.path)}
                  >
                    <GitBranch size={13} className="shrink-0 opacity-60" />
                    <code className="font-mono flex-1 truncate">{wt.branch ?? '(detached)'}</code>
                    <span className="font-mono text-xs opacity-60 truncate max-w-[40%]" title={wt.path}>{shortPath(wt.path)}</span>
                    {wt.isMain && <span className="badge badge-xs badge-ghost shrink-0">main</span>}
                  </button>
                ))}
              </div>
              <div className="divider text-xs text-base-content/40 my-4">or enter path</div>
              <CwdCombobox value={cwd} onChange={setCwd} />
            </div>
          ) : (
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Working directory</span></label>
              <CwdCombobox value={cwd} onChange={setCwd} />
            </div>
          )}
          <div className="form-control mt-3">
            <label className="label"><span className="label-text">Name <span className="text-base-content/40">(optional)</span></span></label>
            <input
              className="input input-bordered"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="auto-generated if empty"
            />
          </div>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary gap-2">
              <Plus size={15} /> Create
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

// ── Claude.md Tab ─────────────────────────────────────────────────────────────

function ClaudeMdPanel({ anid }: { anid: string }) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let settled = false;
    const aid = nanoid(8);
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setLoading(false); setError('No response from agentnode — is the daemon up to date?'); }
    }, 8000);
    browserSocket.claudeMdRead(anid, aid, (text, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setLoading(false);
      if (err) { setError(err); return; }
      const val = text ?? '';
      setContent(val);
      setSavedContent(val);
    });
    return () => clearTimeout(timer);
  }, [anid]);

  function handleSave() {
    setSaving(true);
    setSaveError(null);
    browserSocket.claudeMdWrite(anid, nanoid(8), content, (err) => {
      setSaving(false);
      if (err) { setSaveError(err); return; }
      setSavedContent(content);
    });
  }

  const dirty = content !== savedContent;

  if (loading) return (
    <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
  );

  if (error) return (
    <div className="alert alert-error text-sm py-2"><span>{error}</span></div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-base-content/50 font-mono">~/.claude/CLAUDE.md</p>
      {saveError && (
        <div className="alert alert-error py-2 text-sm"><span>{saveError}</span></div>
      )}
      <textarea
        className="textarea textarea-bordered w-full font-mono text-xs resize-none"
        rows={16}
        value={content}
        onChange={e => setContent(e.target.value)}
        spellCheck={false}
        placeholder={'# User-scope CLAUDE.md\n\nAdd instructions for Claude Code here...'}
      />
      <div className="flex justify-end">
        <button
          className="btn btn-sm btn-primary"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? <><span className="loading loading-spinner loading-xs" /> Saving…</> : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Agentnode Settings Modal ──────────────────────────────────────────────────

type SettingsTab = 'git' | 'claude-md';
type GitView = 'repos' | 'clone' | 'add-existing' | 'add-worktree';

function AgentnodeSettingsModal({ anid, nodeName, onClose }: { anid: string; nodeName: string; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('git');

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Settings size={18} /> {nodeName}
          </h3>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}><X size={15} /></button>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 px-5 border-b border-base-300">
          <button
            className={`text-sm font-semibold px-3 py-2 border-b-2 transition-colors -mb-px ${activeTab === 'git' ? 'border-primary text-primary' : 'border-transparent text-base-content/50 hover:text-base-content/80'}`}
            onClick={() => setActiveTab('git')}
          >
            <span className="flex items-center gap-1.5"><FolderGit2 size={14} /> Git</span>
          </button>
          <button
            className={`text-sm font-semibold px-3 py-2 border-b-2 transition-colors -mb-px ${activeTab === 'claude-md' ? 'border-primary text-primary' : 'border-transparent text-base-content/50 hover:text-base-content/80'}`}
            onClick={() => setActiveTab('claude-md')}
          >
            <span className="flex items-center gap-1.5"><FileText size={14} /> Claude.md</span>
          </button>
        </div>
        {/* Tab content */}
        <div className="p-5">
          {activeTab === 'git' && <GitManagerContent anid={anid} />}
          {activeTab === 'claude-md' && <ClaudeMdPanel anid={anid} />}
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

function GitManagerContent({ anid }: { anid: string }) {
  const [repos, setRepos] = useState<GitRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<GitView>('repos');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);

  // Clone form
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState('');

  // Add existing form
  const [addPath, setAddPath] = useState('');

  // Add worktree form
  const [wtBranch, setWtBranch] = useState('');

  const wtDerivedPath = (() => {
    if (!worktreeTarget || !wtBranch.trim()) return '';
    const lastSlash = worktreeTarget.lastIndexOf('/');
    return `${worktreeTarget.slice(0, lastSlash)}/${wtBranch.trim()}`;
  })();

  const refresh = (aid = nanoid(8)) => {
    setLoading(true);
    setError(null);
    browserSocket.gitRepoList(anid, aid, (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
      if (r) setExpanded(prev => new Set([...prev, ...r.map(repo => repo.localPath)]));
    });
  };

  useEffect(() => { refresh(); }, []);

  const toggleExpand = (localPath: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(localPath) ? next.delete(localPath) : next.add(localPath);
      return next;
    });
  };

  const handleClone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim() || !clonePath.trim()) return;
    setLoading(true);
    setError(null);
    browserSocket.gitClone(anid, nanoid(8), cloneUrl.trim(), clonePath.trim(), (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
      setView('repos');
      setCloneUrl(''); setClonePath('');
    });
  };

  const handleAddExisting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addPath.trim()) return;
    setLoading(true);
    setError(null);
    browserSocket.gitRepoAdd(anid, nanoid(8), addPath.trim(), (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
      setView('repos');
      setAddPath('');
    });
  };

  const handleRemoveRepo = (localPath: string) => {
    setLoading(true);
    browserSocket.gitRepoRemove(anid, nanoid(8), localPath, (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
    });
  };

  const handleAddWorktree = (e: React.FormEvent) => {
    e.preventDefault();
    if (!worktreeTarget || !wtBranch.trim()) return;
    setLoading(true);
    setError(null);
    browserSocket.gitWorktreeAdd(anid, nanoid(8), worktreeTarget, '', wtBranch.trim(), true, (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
      setView('repos');
      setWtBranch('');
    });
  };

  const handleRemoveWorktree = (repoPath: string, worktreePath: string) => {
    setLoading(true);
    browserSocket.gitWorktreeRemove(anid, nanoid(8), repoPath, worktreePath, (r, err) => {
      setLoading(false);
      if (err) { setError(err); return; }
      setRepos(r);
    });
  };

  const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

  return (
    <div>
        {error && (
          <div className="alert alert-error mb-3 py-2 text-sm">
            <span className="font-mono break-all">{error}</span>
            <button className="btn btn-xs btn-ghost ml-auto" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* ── Repo list ── */}
        {view === 'repos' && (
          <>
            {repos === null && loading && (
              <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
            )}
            {repos !== null && repos.length === 0 && (
              <p className="text-sm text-base-content/50 text-center py-6">No repos added yet.</p>
            )}
            {repos !== null && repos.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto mb-4">
                {repos.map(repo => (
                  <div key={repo.localPath} className="border border-base-300 rounded-lg overflow-hidden">
                    <div
                      className="flex items-center gap-2 px-3 py-2 bg-base-200 cursor-pointer hover:bg-base-300 transition-colors"
                      onClick={() => toggleExpand(repo.localPath)}
                    >
                      <ChevronRight size={13} className={`shrink-0 text-base-content/50 transition-transform ${expanded.has(repo.localPath) ? 'rotate-90' : ''}`} />
                      <FolderGit2 size={14} className="shrink-0 text-base-content/60" />
                      <span className="text-sm font-mono truncate flex-1" title={repo.localPath}>{shortPath(repo.localPath)}</span>
                      <button
                        className="shrink-0 btn btn-xs btn-ghost gap-1 text-base-content/50 hover:text-primary"
                        onClick={e => { e.stopPropagation(); setWorktreeTarget(repo.localPath); setView('add-worktree'); }}
                        title="Add worktree"
                      ><GitBranch size={12} /> Worktree</button>
                      <button
                        className="shrink-0 btn btn-xs btn-ghost text-error hover:bg-error/10"
                        onClick={e => { e.stopPropagation(); handleRemoveRepo(repo.localPath); }}
                        title="Remove repo"
                      ><Trash2 size={12} /></button>
                    </div>
                    {expanded.has(repo.localPath) && (
                      <div className="divide-y divide-base-300">
                        {repo.worktrees.length === 0 && (
                          <p className="px-4 py-2 text-xs text-base-content/40">No worktrees found</p>
                        )}
                        {repo.worktrees.map(wt => (
                          <div key={wt.path} className="flex items-center gap-2 px-4 py-1.5">
                            <GitBranch size={12} className="shrink-0 text-base-content/40" />
                            <code className="text-xs text-primary truncate">{wt.branch ?? '(detached)'}</code>
                            <span className="text-xs text-base-content/40 font-mono truncate flex-1" title={wt.path}>{shortPath(wt.path)}</span>
                            {wt.isMain ? (
                              <span className="text-[10px] badge badge-ghost">main</span>
                            ) : (
                              <button
                                className="shrink-0 btn btn-xs btn-ghost text-error hover:bg-error/10"
                                onClick={() => handleRemoveWorktree(repo.localPath, wt.path)}
                                title="Remove worktree"
                              ><Trash2 size={11} /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn btn-sm btn-primary gap-1" onClick={() => setView('clone')}>
                <Plus size={13} /> Clone repo
              </button>
              <button className="btn btn-sm btn-ghost gap-1" onClick={() => setView('add-existing')}>
                <Plus size={13} /> Add existing
              </button>
            </div>
          </>
        )}

        {/* ── Clone ── */}
        {view === 'clone' && (
          <form onSubmit={handleClone}>
            <button type="button" className="btn btn-xs btn-ghost mb-3" onClick={() => setView('repos')}>← Back</button>
            <div className="form-control">
              <label className="label"><span className="label-text">Repository URL</span></label>
              <input className="input input-bordered font-mono text-sm" value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} placeholder="https://github.com/user/repo.git" autoFocus />
            </div>
            <div className="form-control mt-3">
              <label className="label"><span className="label-text">Clone to</span></label>
              <input className="input input-bordered font-mono text-sm" value={clonePath} onChange={e => setClonePath(e.target.value)} placeholder="~/projects/repo" />
            </div>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setView('repos')}>Cancel</button>
              <button type="submit" className="btn btn-primary gap-1" disabled={loading || !cloneUrl.trim() || !clonePath.trim()}>
                {loading ? <span className="loading loading-spinner loading-xs" /> : <Plus size={14} />} Clone
              </button>
            </div>
          </form>
        )}

        {/* ── Add existing ── */}
        {view === 'add-existing' && (
          <form onSubmit={handleAddExisting}>
            <button type="button" className="btn btn-xs btn-ghost mb-3" onClick={() => setView('repos')}>← Back</button>
            <div className="form-control">
              <label className="label"><span className="label-text">Local path to existing repo</span></label>
              <input className="input input-bordered font-mono text-sm" value={addPath} onChange={e => setAddPath(e.target.value)} placeholder="~/projects/myrepo" autoFocus />
            </div>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setView('repos')}>Cancel</button>
              <button type="submit" className="btn btn-primary gap-1" disabled={loading || !addPath.trim()}>
                {loading ? <span className="loading loading-spinner loading-xs" /> : <Plus size={14} />} Add
              </button>
            </div>
          </form>
        )}

        {/* ── Add worktree ── */}
        {view === 'add-worktree' && (
          <form onSubmit={handleAddWorktree}>
            <button type="button" className="btn btn-xs btn-ghost mb-3" onClick={() => setView('repos')}>← Back</button>
            <p className="text-xs text-base-content/50 font-mono mb-3 truncate" title={worktreeTarget ?? ''}>
              {worktreeTarget ? shortPath(worktreeTarget) : ''}
            </p>
            <div className="form-control">
              <label className="label"><span className="label-text">Branch name</span></label>
              <input className="input input-bordered font-mono text-sm" value={wtBranch} onChange={e => setWtBranch(e.target.value)} placeholder="feature-x" autoFocus />
            </div>
            {wtDerivedPath && (
              <p className="mt-3 text-xs font-mono text-base-content/50 truncate" title={wtDerivedPath}>
                → {shortPath(wtDerivedPath)}
              </p>
            )}

            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setView('repos')}>Cancel</button>
              <button type="submit" className="btn btn-primary gap-1" disabled={loading || !wtBranch.trim()}>
                {loading ? <span className="loading loading-spinner loading-xs" /> : <GitBranch size={14} />} Add Worktree
              </button>
            </div>
          </form>
        )}
    </div>
  );
}

// ── Claude Code Icon ──────────────────────────────────────────────────────────

function ClaudeCodeIcon({ size = 11 }: { size?: number }) {
  return (
    <svg height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flex: 'none' }}>
      <path clipRule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill="#D97757" fillRule="evenodd" />
    </svg>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

interface CardProps {
  session: SessionMeta;
  selected: boolean;
  onSelect: () => void;
  onKill: () => void;
  onRename: (name: string) => void;
}

function SessionCard({ session: s, selected, onSelect, onKill, onRename }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isExited = s.status === 'exited';
  const lastFolder = s.cwd ? s.cwd.split('/').filter(Boolean).pop() : null;

  const commitRename = () => {
    if (draft.trim()) onRename(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={`relative group w-56 overflow-hidden rounded-lg border p-2 transition-colors select-none
        ${isExited
          ? 'opacity-40 cursor-not-allowed border-base-300 bg-base-100'
          : selected
            ? 'border-primary bg-primary/10 cursor-pointer'
            : 'border-base-300 bg-base-100 hover:border-primary/50 hover:bg-base-200 cursor-pointer'
        }`}
      onClick={() => !isExited && onSelect()}
    >
      {!isExited && (
        <button
          className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded text-error opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-opacity"
          onClick={e => { e.stopPropagation(); onKill(); }}
          title="Kill"
        ><X size={11} /></button>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 pr-4">
          <ClaudeCodeIcon size={16} />
          {editing ? (
            <input
              className="input input-xs input-bordered flex-1 min-w-0"
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-sm font-semibold truncate leading-tight"
              title={s.name || s.id}
              onDoubleClick={e => {
                e.stopPropagation();
                if (!isExited) { setDraft(s.name); setEditing(true); }
              }}
            >
              {lastFolder && <span className="font-normal text-base-content/45">[{lastFolder}]</span>}
              {lastFolder && ' '}
              {s.name || s.id.slice(0, 8)}
            </span>
          )}
        </div>

        {s.cwd && (
          <div className="text-[10px] text-base-content/60 truncate font-mono" title={s.cwd}>
            {s.cwd.replace(/^\/home\/[^/]+/, '~')}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[9px] text-base-content/35 font-mono leading-none">{s.id}</span>
          <div className="flex items-center gap-1">
            {s.status === 'running' && s.claudeStatus === 'working' && <>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0 animate-pulse" />
              <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400">working</span>
            </>}
            {s.status === 'running' && s.claudeStatus === 'waiting' && <>
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
              <span className="text-[10px] font-medium text-yellow-600 dark:text-yellow-400">waiting</span>
            </>}
            {s.status === 'running' && !s.claudeStatus && <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">idle</span>
            </>}
            {s.status === 'running' && s.claudeStatus === 'idle' && <>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
              <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">done</span>
            </>}
            {s.status === 'suspended' && <>
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
              <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">suspended</span>
            </>}
            {s.status === 'exited' && <>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span className="text-[10px] font-medium text-rose-500 dark:text-rose-400">exited</span>
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  selectedAnid: string | null;
  selectedSid: string | null;
  onSelect: (anid: string, sid: string) => void;
}

export default function SessionCards({ selectedAnid, selectedSid, onSelect }: Props) {
  const agentnodes = useRegistryStore(s => [...s.agentnodes.values()]);
  const [showAdd, setShowAdd] = useState(false);
  const [newSessionAnid, setNewSessionAnid] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<{ anid: string; sid: string } | null>(null);
  const [settingsAnid, setSettingsAnid] = useState<string | null>(null);

  const handleNew = (anid: string) => {
    setNewSessionAnid(anid);
  };

  const handleCreate = (cwd: string, name: string) => {
    if (!newSessionAnid) return;
    saveRecentCwd(cwd);
    browserSocket.create(newSessionAnid, nanoid(8), {
      cwd,
      name: name || undefined,
      cols: Math.floor(window.innerWidth * 0.7 / 8),
      rows: Math.floor(window.innerHeight / 20),
    });
    setNewSessionAnid(null);
  };

  const handleKill = (anid: string, sid: string) => {
    setKillTarget({ anid, sid });
  };

  return (
    <div className="w-64 shrink-0 bg-base-200 flex flex-col border-r border-base-300 h-full">
      <div className="flex items-center justify-between px-4 h-12 border-b border-base-300 bg-base-100 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-sm">
          <Cable size={15} />
          CCREMOTE
        </div>
        <button className="btn btn-xs btn-ghost gap-1" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Node
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-2 space-y-4">
        {agentnodes.length === 0 && (
          <p className="text-center text-base-content/40 text-xs py-10 px-4">
            No agent nodes. Click + Node to add one.
          </p>
        )}

        {agentnodes.map((node: AgentnodeView) => (
          <div key={node.id}>
            <div className="flex items-center gap-2 px-3 mb-3">
              <Server size={15} className="shrink-0 text-base-content/50" />
              <span className="text-xs font-semibold text-base-content/70 truncate uppercase tracking-wider">{node.name}</span>
              <span className={`shrink-0 badge badge-xs font-medium ${node.online ? 'badge-success' : 'badge-ghost text-base-content/40'}`}>
                {node.online ? 'online' : 'offline'}
              </span>
              <div className="flex-1 h-px bg-base-content/15" />
              <button
                className="shrink-0 btn btn-xs btn-ghost btn-circle text-base-content/40 hover:text-base-content"
                onClick={() => setSettingsAnid(node.id)}
                title="Node settings"
              ><Settings size={12} /></button>
            </div>

            <div className="flex flex-wrap gap-2 px-3">
              {node.sessions.filter((s: SessionMeta) => !s.parentSid).map((s: SessionMeta) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  selected={selectedAnid === node.id && selectedSid === s.id}
                  onSelect={() => onSelect(node.id, s.id)}
                  onKill={() => handleKill(node.id, s.id)}
                  onRename={(name) => browserSocket.rename(node.id, s.id, name)}
                />
              ))}
              {node.online && (
                <button
                  className="w-56 rounded-lg border-2 border-dashed border-base-content/25 h-8 text-base-content/40 hover:border-primary/50 hover:text-primary/60 transition-colors flex items-center justify-center"
                  onClick={() => handleNew(node.id)}
                  title="New session"
                ><Plus size={20} /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddAgentnodeModal onClose={() => setShowAdd(false)} />}
      {newSessionAnid && (
        <NewSessionModal
          anid={newSessionAnid}
          onClose={() => setNewSessionAnid(null)}
          onCreate={handleCreate}
        />
      )}
      {killTarget && (
        <ConfirmModal
          message="Kill this session?"
          onConfirm={() => browserSocket.kill(killTarget.anid, killTarget.sid)}
          onClose={() => setKillTarget(null)}
        />
      )}
      {settingsAnid && (
        <AgentnodeSettingsModal
          anid={settingsAnid}
          nodeName={agentnodes.find(n => n.id === settingsAnid)?.name ?? settingsAnid}
          onClose={() => setSettingsAnid(null)}
        />
      )}
    </div>
  );
}
