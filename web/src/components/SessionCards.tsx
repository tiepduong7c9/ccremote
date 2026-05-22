import { useState, useRef, useEffect } from 'react';
import { useRegistryStore } from '../store';
import { browserSocket } from '../ws';
import { nanoid } from 'nanoid';
import type { AgentnodeView, SessionMeta } from '../lib/protocol';
import { Plus, X, Server, Copy, Check, Cable, ChevronDown } from 'lucide-react';

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

function NewSessionModal({ onClose, onCreate }: { onClose: () => void; onCreate: (cwd: string, name: string) => void }) {
  const [cwd, setCwd] = useState('~');
  const [name, setName] = useState('');

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
          <div className="form-control mt-4">
            <label className="label"><span className="label-text">Working directory</span></label>
            <CwdCombobox value={cwd} onChange={setCwd} />
          </div>
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
      className={`relative group w-56 rounded-lg border p-2 transition-colors select-none
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
            {s.status === 'running' && (!s.claudeStatus || s.claudeStatus === 'idle') && <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">idle</span>
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
    <div className="w-1/3 bg-base-200 flex flex-col border-r border-base-300 h-full">
      <div className="flex items-center justify-between px-4 h-12 border-b border-base-300 bg-base-100 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-sm">
          <Cable size={15} />
          Claude Code Remote
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
          <div key={node.id} className="border-t border-base-content/10 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-2 px-3 mb-3">
              <Server size={15} className="shrink-0 text-base-content/50" />
              <span className="text-xs font-semibold text-base-content/70 truncate uppercase tracking-wider">{node.name}</span>
              <span className={`shrink-0 badge badge-xs font-medium ${node.online ? 'badge-success' : 'badge-ghost text-base-content/40'}`}>
                {node.online ? 'online' : 'offline'}
              </span>
              <div className="flex-1 h-px bg-base-content/15" />
            </div>

            <div className="flex flex-wrap gap-2 px-3">
              {node.sessions.map((s: SessionMeta) => (
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
                  className="w-56 rounded-lg border-2 border-dashed border-base-content/25 h-[4.5rem] text-base-content/40 hover:border-primary/50 hover:text-primary/60 transition-colors flex items-center justify-center"
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
    </div>
  );
}
