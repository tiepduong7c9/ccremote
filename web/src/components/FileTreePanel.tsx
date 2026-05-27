import { useState, useEffect, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { ChevronRight, ChevronDown, Folder, File, RefreshCw, ChevronsUp, Trash2 } from 'lucide-react';
import { browserSocket } from '../ws';
import FileModal from './FileModal';

interface Props {
  anid: string;
  cwd: string;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
}

interface ContextMenu {
  x: number;
  y: number;
  node: TreeNode;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', isDir: true, children: new Map() };
  for (const f of files) {
    const parts = f.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        const isDir = i < parts.length - 1;
        node.children.set(part, { name: part, fullPath: parts.slice(0, i + 1).join('/'), isDir, children: new Map() });
      }
      node = node.children.get(part)!;
    }
  }
  return root;
}

function TreeNodeRow({ node, depth, selectedFile, onOpen, onContextMenu, collapseRevision }: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  collapseRevision?: number;
}) {
  const [open, setOpen] = useState(depth < 2);

  useEffect(() => {
    if (collapseRevision && collapseRevision > 0) setOpen(false);
  }, [collapseRevision]);

  if (node.isDir) {
    return (
      <>
        <button
          className="w-full flex items-center gap-1 py-0.5 hover:bg-base-300 text-left min-w-0"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen(o => !o)}
          onContextMenu={e => onContextMenu(e, node)}
        >
          {open ? <ChevronDown size={12} className="shrink-0 text-base-content/40" /> : <ChevronRight size={12} className="shrink-0 text-base-content/40" />}
          <Folder size={12} className="shrink-0 text-base-content/40" />
          <span className="font-mono text-xs text-base-content/60 truncate">{node.name}/</span>
        </button>
        {open && Array.from(node.children.values()).map(child => (
          <TreeNodeRow key={child.fullPath} node={child} depth={depth + 1} selectedFile={selectedFile} onOpen={onOpen} onContextMenu={onContextMenu} collapseRevision={collapseRevision} />
        ))}
      </>
    );
  }

  const isSelected = node.fullPath === selectedFile;
  return (
    <button
      className={`w-full flex items-center gap-1.5 py-0.5 text-left min-w-0 group ${isSelected ? 'bg-primary/15 hover:bg-primary/20' : 'hover:bg-base-300'}`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onOpen(node.fullPath)}
      onContextMenu={e => onContextMenu(e, node)}
    >
      <File size={11} className="shrink-0 text-base-content/30" />
      <span className="font-mono text-xs truncate text-base-content/80 group-hover:text-base-content">{node.name}</span>
    </button>
  );
}

export default function FileTreePanel({ anid, cwd }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [collapseRevision, setCollapseRevision] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    const aid = nanoid();
    browserSocket.fileList(anid, aid, cwd, (result, err) => {
      setLoading(false);
      if (err || !result) { setError(err ?? 'Failed to list files'); return; }
      setFiles(result);
    });
  }, [anid, cwd]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const handleOpen = (path: string) => {
    setSelectedFile(path);
    setOpenFile(path);
  };

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleDeleteConfirm = () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const aid = nanoid();
    browserSocket.fileDelete(anid, aid, cwd, confirmDelete.fullPath, (err) => {
      setDeleting(false);
      setConfirmDelete(null);
      if (err) { setError(err); return; }
      if (selectedFile === confirmDelete.fullPath || selectedFile?.startsWith(confirmDelete.fullPath + '/')) {
        setSelectedFile(null);
      }
      load();
    });
  };

  if (!cwd) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-base-content/40 px-3 text-center">
        No working directory
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 h-8 border-b border-base-300 shrink-0">
          <span className="text-xs text-base-content/40 flex-1">
            {files !== null ? `${files.length} files` : ''}
          </span>
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={() => setCollapseRevision(r => r + 1)}
            title="Collapse all folders"
            disabled={!files || files.length === 0}
          >
            <ChevronsUp size={12} />
          </button>
          <button className="btn btn-xs btn-ghost p-0 w-6 h-6" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-16">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-2 text-xs text-error">{error}</div>
          )}
          {!loading && !error && files !== null && (
            <ul className="py-1">
              {Array.from(buildTree(files).children.values()).map(child => (
                <li key={child.fullPath}>
                  <TreeNodeRow node={child} depth={0} selectedFile={selectedFile} onOpen={handleOpen} onContextMenu={handleContextMenu} collapseRevision={collapseRevision} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-32 rounded-md border border-base-300 bg-base-100 shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error/10"
            onClick={() => { setConfirmDelete(contextMenu.node); setContextMenu(null); }}
          >
            <Trash2 size={11} />
            Delete {contextMenu.node.isDir ? 'folder' : 'file'}
          </button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-base-100 rounded-lg shadow-xl border border-base-300 p-5 w-80 max-w-full">
            <h3 className="font-semibold text-sm mb-2">Delete {confirmDelete.isDir ? 'folder' : 'file'}?</h3>
            <p className="text-xs text-base-content/70 mb-4 break-all">
              <span className="font-mono">{confirmDelete.fullPath}</span>
              {confirmDelete.isDir && <span className="block mt-1 text-warning">This will delete all contents inside.</span>}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-xs btn-ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-xs btn-error" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? <span className="loading loading-spinner loading-xs" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {openFile && (
        <FileModal
          anid={anid}
          cwd={cwd}
          filePath={openFile}
          onClose={() => setOpenFile(null)}
        />
      )}
    </>
  );
}
