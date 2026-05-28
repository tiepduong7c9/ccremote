import { useState, useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import type { GitFileChange } from '../lib/protocol';
import GitStatusBadge from './GitStatusBadge';

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

interface Props {
  files: GitFileChange[];
  selectedFiles: Set<string>;
  selectedCount: number;
  onFileClick: (path: string, shiftKey: boolean) => void;
  onRevert: (path: string, isFolder: boolean) => void;
}

export default function GitFileList({ files, selectedFiles, selectedCount, onFileClick, onRevert }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  const isMultiRevert = contextMenu !== null && selectedCount > 1 && selectedFiles.has(contextMenu.path);

  return (
    <>
      <ul className="py-1">
        {files.map(f => (
          <li key={f.path}>
            <button
              className={`w-full flex items-center gap-1.5 px-3 py-0.5 text-left min-w-0 group
                ${selectedFiles.has(f.path)
                  ? 'bg-primary/15 hover:bg-primary/20'
                  : 'hover:bg-base-300'}`}
              onClick={e => onFileClick(f.path, e.shiftKey)}
              onContextMenu={e => handleContextMenu(e, f.path)}
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

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-36 rounded-md border border-base-300 bg-base-100 shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-warning hover:bg-warning/10"
            onClick={() => { onRevert(contextMenu.path, false); setContextMenu(null); }}
          >
            <RotateCcw size={11} />
            {isMultiRevert ? `Revert ${selectedCount} files` : 'Revert file'}
          </button>
        </div>
      )}
    </>
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
