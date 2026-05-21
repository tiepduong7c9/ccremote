import { useState } from 'react';
import { useRegistryStore } from '../store';
import { browserSocket } from '../ws';
import { nanoid } from 'nanoid';
import type { SessionMeta } from '../lib/protocol';

interface Props {
  anid: string;
  selectedSid: string | null;
  onSelect: (sid: string) => void;
}

export default function SessionList({ anid, selectedSid, onSelect }: Props) {
  const node = useRegistryStore(s => s.agentnodes.get(anid));
  const sessions = node?.sessions || [];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const handleNew = () => {
    const aid = nanoid(8);
    const cols = Math.floor(window.innerWidth * 0.6 / 8);
    const rows = Math.floor(window.innerHeight / 20);
    browserSocket.create(anid, aid, { cols, rows });
  };

  const handleKill = (sid: string) => {
    if (confirm('Kill this session?')) browserSocket.kill(anid, sid);
  };

  const handleRename = (sid: string) => {
    if (newName.trim()) {
      browserSocket.rename(anid, sid, newName.trim());
    }
    setRenaming(null);
    setNewName('');
  };

  const statusBadge = (s: SessionMeta) => {
    if (s.status === 'running') return <span className="badge badge-success badge-xs">running</span>;
    if (s.status === 'suspended') return <span className="badge badge-warning badge-xs">suspended</span>;
    return <span className="badge badge-error badge-xs">exited</span>;
  };

  return (
    <div className="w-60 bg-base-100 flex flex-col border-r border-base-300 h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
        <span className="font-semibold text-sm truncate">{node?.name || anid}</span>
        <button className="btn btn-xs btn-primary" onClick={handleNew}>New</button>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-base-200">
        {sessions.map((s: SessionMeta) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 ${selectedSid === s.id ? 'bg-base-200' : ''}`}
            onClick={() => s.status !== 'exited' && onSelect(s.id)}
          >
            {renaming === s.id ? (
              <input
                className="input input-xs input-bordered flex-1"
                value={newName}
                autoFocus
                onChange={e => setNewName(e.target.value)}
                onBlur={() => handleRename(s.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(s.id); if (e.key === 'Escape') setRenaming(null); }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 text-sm truncate" onDoubleClick={e => { e.stopPropagation(); setRenaming(s.id); setNewName(s.name); }}>
                {s.name}
              </span>
            )}
            <div className="flex flex-col items-end gap-1">
              {statusBadge(s)}
              <button
                className="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100"
                onClick={e => { e.stopPropagation(); handleKill(s.id); }}
                title="Kill"
              >✕</button>
            </div>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="text-center text-base-content/40 text-xs py-8">No sessions</li>
        )}
      </ul>
    </div>
  );
}
