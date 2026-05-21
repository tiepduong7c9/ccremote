import { useState, useRef, useEffect } from 'react';
import { useRegistryStore } from '../store';
import { browserSocket } from '../ws';
import { nanoid } from 'nanoid';
import type { AgentnodeView, SessionMeta } from '../lib/protocol';
import { Plus, X, Server, SquareTerminal, Circle, Copy, Check, Cable, ChevronDown } from 'lucide-react';

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
          <Server size={18} /> Add Agentnode
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
              Agentnode <strong>{result.name}</strong> created. Copy this token — it's shown only once:
            </p>
            <div className="mockup-code mt-2 relative">
              <div className="absolute top-2 right-2">
                <CopyButton text={result.token} />
              </div>
              <pre><code>{result.token}</code></pre>
            </div>
            <p className="mt-3 text-xs text-base-content/50">Run on the agentnode machine:</p>
            <div className="mockup-code mt-1 relative">
              <div className="absolute top-2 right-2">
                <CopyButton text={`ccremote config set-token ${result.token}`} />
              </div>
              <pre><code>ccremote config set-token {result.token}</code></pre>
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

  const commitRename = () => {
    if (draft.trim()) onRename(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={`relative group w-36 rounded-lg border p-2 transition-colors select-none
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

      {editing ? (
        <input
          className="input input-xs input-bordered w-full"
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
        <div
          className="flex items-center gap-1 pr-4"
          title={s.name || s.id}
          onDoubleClick={e => {
            e.stopPropagation();
            if (!isExited) { setDraft(s.name); setEditing(true); }
          }}
        >
          <SquareTerminal size={11} className="shrink-0 text-base-content/40" />
          <span className="text-xs font-medium truncate">{s.name || s.id.slice(0, 8)}</span>
        </div>
      )}

      <div className="mt-1.5 space-y-1">
        {s.status === 'running' && <span className="badge badge-success badge-xs">running</span>}
        {s.status === 'suspended' && <span className="badge badge-warning badge-xs">suspended</span>}
        {s.status === 'exited' && <span className="badge badge-error badge-xs">exited</span>}
        {s.cwd && (
          <div className="text-[10px] text-base-content/40 truncate font-mono" title={s.cwd}>
            {s.cwd.replace(/^\/home\/[^/]+/, '~')}
          </div>
        )}
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
    if (confirm('Kill this session?')) browserSocket.kill(anid, sid);
  };

  return (
    <div className="w-1/3 bg-base-200 flex flex-col border-r border-base-300 h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-sm">
          <Cable size={15} />
          Claude Code Remote
        </div>
        <button className="btn btn-xs btn-ghost gap-1" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Node
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-4">
        {agentnodes.length === 0 && (
          <p className="text-center text-base-content/40 text-xs py-10 px-4">
            No agentnodes. Click + Node to add one.
          </p>
        )}

        {agentnodes.map((node: AgentnodeView) => (
          <div key={node.id}>
            <div className="flex items-center gap-2 px-3 mb-2">
              <Server size={12} className="shrink-0 text-base-content/40" />
              <Circle
                size={7}
                className={`shrink-0 fill-current ${node.online ? 'text-success' : 'text-base-content/25'}`}
              />
              <span className="text-xs font-semibold text-base-content/60 truncate">{node.name}</span>
              <div className="flex-1 h-px bg-base-300" />
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
                  className="w-36 h-[3.75rem] rounded-lg border-2 border-dashed border-base-300 text-base-content/30 hover:border-primary/50 hover:text-primary/60 transition-colors flex items-center justify-center"
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
    </div>
  );
}
