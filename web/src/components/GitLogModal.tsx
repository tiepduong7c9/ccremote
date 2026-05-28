import { useEffect } from 'react';
import { X, GitCommit as GitCommitIcon } from 'lucide-react';
import type { GitCommit } from '../lib/protocol';

interface Props {
  branch: string;
  commits: GitCommit[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

export default function GitLogModal({ branch, commits, loading, error, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="bg-base-100 border border-base-300 rounded-lg shadow-2xl flex flex-col w-[640px] max-w-[92vw] max-h-[80vh]"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-base-300 shrink-0">
          <GitCommitIcon size={14} className="text-base-content/40 shrink-0" />
          <span className="text-sm font-medium flex-1">Commit History</span>
          {branch && <span className="text-xs font-mono text-base-content/40">{branch}</span>}
          <button className="btn btn-xs btn-ghost p-0 w-6 h-6" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
          {error && !loading && (
            <div className="px-4 py-3 text-sm text-error">{error}</div>
          )}
          {!loading && !error && commits.length === 0 && (
            <div className="flex items-center justify-center h-32 text-sm text-base-content/40">
              No commits found
            </div>
          )}
          {!loading && !error && commits.map((c, i) => (
            <div key={c.hash} className={`flex items-start gap-3 px-4 py-3 ${i < commits.length - 1 ? 'border-b border-base-200' : ''} hover:bg-base-200`}>
              <span className="font-mono text-xs text-primary/80 shrink-0 pt-0.5 w-14">{c.shortHash}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-base-content break-words">{c.subject}</p>
                <p className="text-xs text-base-content/50 mt-0.5">{c.author} · {relativeTime(c.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
