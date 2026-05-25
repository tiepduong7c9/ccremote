import type { GitFileChange } from '../lib/protocol';
import GitStatusBadge from './GitStatusBadge';

interface Props {
  files: GitFileChange[];
  selectedFile: string | null;
  onOpen: (path: string) => void;
}

export default function GitFileList({ files, selectedFile, onOpen }: Props) {
  return (
    <ul className="py-1">
      {files.map(f => (
        <li key={f.path}>
          <button
            className={`w-full flex items-center gap-1.5 px-3 py-0.5 text-left min-w-0 group
              ${f.path === selectedFile
                ? 'bg-primary/15 hover:bg-primary/20'
                : 'hover:bg-base-300'}`}
            onClick={() => onOpen(f.path)}
          >
            <GitStatusBadge indexStatus={f.indexStatus} worktreeStatus={f.worktreeStatus} untracked={f.untracked} />
            <span className="font-mono text-xs truncate min-w-0 text-base-content/80 group-hover:text-base-content">
              {f.oldPath ? (
                <><span className="line-through text-base-content/40">{f.oldPath}</span>{' → '}{basename(f.path)}</>
              ) : (
                <>
                  <span className="text-base-content/40">{dirname(f.path)}</span>
                  <span>{basename(f.path)}</span>
                </>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function basename(p: string) {
  return p.split('/').pop() ?? p;
}

function dirname(p: string) {
  const parts = p.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/') + '/';
}
