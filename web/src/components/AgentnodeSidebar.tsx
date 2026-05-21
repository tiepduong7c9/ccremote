import { useState } from 'react';
import { useRegistryStore } from '../store';
import type { AgentnodeView } from '../lib/protocol';

interface AddModalProps {
  onClose: () => void;
}

function AddAgentnodeModal({ onClose }: AddModalProps) {
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
        <h3 className="font-bold text-lg">Add Agentnode</h3>
        {!result ? (
          <form onSubmit={submit}>
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Name</span></label>
              <input className="input input-bordered" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. my-laptop" autoFocus />
            </div>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : 'Create'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mt-4 text-sm text-base-content/70">Agentnode <strong>{result.name}</strong> created. Copy this token — it's shown only once:</p>
            <div className="mockup-code mt-2">
              <pre><code>{result.token}</code></pre>
            </div>
            <p className="mt-2 text-xs text-base-content/50">Run on the agentnode machine:</p>
            <div className="mockup-code mt-1">
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

interface Props {
  onSelect: (anid: string) => void;
  selectedAnid: string | null;
}

export default function AgentnodeSidebar({ onSelect, selectedAnid }: Props) {
  const agentnodes = useRegistryStore(s => [...s.agentnodes.values()]);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <aside className="w-56 bg-base-200 flex flex-col border-r border-base-300 h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
        <span className="font-semibold text-sm">Agentnodes</span>
        <button className="btn btn-xs btn-ghost" onClick={() => setShowAdd(true)}>+</button>
      </div>
      <ul className="menu menu-vertical flex-1 overflow-y-auto p-2">
        {agentnodes.map((node: AgentnodeView) => (
          <li key={node.id}>
            <button
              className={`flex items-center gap-2 text-left text-sm w-full ${selectedAnid === node.id ? 'active' : ''}`}
              onClick={() => onSelect(node.id)}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${node.online ? 'bg-success' : 'bg-error'}`} />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        ))}
        {agentnodes.length === 0 && (
          <li className="text-base-content/40 text-xs px-2 py-1">No agentnodes</li>
        )}
      </ul>
      {showAdd && <AddAgentnodeModal onClose={() => setShowAdd(false)} />}
    </aside>
  );
}
