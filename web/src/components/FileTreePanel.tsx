import { useState, useEffect, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { ChevronRight, ChevronDown, File, RefreshCw, ChevronsUp, Trash2, Download, Upload } from 'lucide-react';
import { browserSocket } from '../ws';
import { useToastStore } from '../store';
import FileModal from './FileModal';

interface Props {
  anid: string;
  cwd: string;
}

interface DirEntry {
  name: string;
  isDir: boolean;
  fullPath: string;
}

// Map from directory fullPath → its children ('loading' while in-flight, undefined = not yet requested)
type DirCache = Map<string, DirEntry[] | 'loading'>;

interface ContextMenu {
  x: number;
  y: number;
  entry: DirEntry;
}

function TreeNodeRow({ entry, depth, cache, onExpand, collapseRevision, selectedFile, onOpen, onContextMenu, dropTargetDir, onDirDragEnter }: {
  entry: DirEntry;
  depth: number;
  cache: DirCache;
  onExpand: (path: string) => void;
  collapseRevision: number;
  selectedFile: string | null;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  dropTargetDir?: string | null;
  onDirDragEnter?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (collapseRevision > 0) setOpen(false);
  }, [collapseRevision]);

  // Trigger load when opened and children not yet fetched
  useEffect(() => {
    if (open && entry.isDir && cache.get(entry.fullPath) === undefined) {
      onExpand(entry.fullPath);
    }
  }, [open, entry.isDir, entry.fullPath, cache, onExpand]);

  if (entry.isDir) {
    const children = cache.get(entry.fullPath);
    const isDragTarget = dropTargetDir === entry.fullPath;
    return (
      <>
        <button
          className={`w-full flex items-center gap-1 py-0.5 text-left min-w-0 ${isDragTarget ? 'bg-primary/20 outline outline-1 outline-primary/40 outline-offset-[-1px]' : 'hover:bg-base-300'}`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen(o => !o)}
          onContextMenu={e => onContextMenu(e, entry)}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); onDirDragEnter?.(entry.fullPath); }}
        >
          {open ? <ChevronDown size={12} className="shrink-0 text-base-content/40" /> : <ChevronRight size={12} className="shrink-0 text-base-content/40" />}
          <span className="font-mono text-xs text-base-content/80 truncate">{entry.name}/</span>
        </button>
        {open && children === 'loading' && (
          <div style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }} className="py-1">
            <span className="loading loading-spinner loading-xs text-base-content/30" />
          </div>
        )}
        {open && Array.isArray(children) && children.map(child => (
          <TreeNodeRow
            key={child.fullPath}
            entry={child}
            depth={depth + 1}
            cache={cache}
            onExpand={onExpand}
            collapseRevision={collapseRevision}
            selectedFile={selectedFile}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            dropTargetDir={dropTargetDir}
            onDirDragEnter={onDirDragEnter}
          />
        ))}
      </>
    );
  }

  const isSelected = entry.fullPath === selectedFile;
  return (
    <button
      className={`w-full flex items-center gap-1.5 py-0.5 text-left min-w-0 group ${isSelected ? 'bg-primary/15 hover:bg-primary/20' : 'hover:bg-base-300'}`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onOpen(entry.fullPath)}
      onContextMenu={e => onContextMenu(e, entry)}
    >
      <File size={11} className="shrink-0 text-base-content/30" />
      <span className="font-mono text-xs truncate text-base-content/80 group-hover:text-base-content">{entry.name}</span>
    </button>
  );
}

export default function FileTreePanel({ anid, cwd }: Props) {
  const [cache, setCache] = useState<DirCache>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [collapseRevision, setCollapseRevision] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DirEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadDir = useCallback((subPath: string) => {
    setCache(prev => new Map(prev).set(subPath, 'loading'));
    const aid = nanoid();
    browserSocket.fileDir(anid, aid, cwd, subPath, (entries, err) => {
      if (err || !entries) {
        setCache(prev => { const next = new Map(prev); next.delete(subPath); return next; });
        if (subPath === '') setError(err ?? 'Failed to list files');
      } else {
        const mapped: DirEntry[] = entries.map(e => ({
          name: e.name,
          isDir: e.isDir,
          fullPath: subPath ? `${subPath}/${e.name}` : e.name,
        }));
        setCache(prev => new Map(prev).set(subPath, mapped));
      }
    });
  }, [anid, cwd]);

  const load = useCallback(() => {
    setCache(new Map());
    setError(null);
    loadDir('');
  }, [loadDir]);

  useEffect(() => { load(); }, [load]);

  const handleFileDrop = useCallback((files: FileList, targetDir: string) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const destPath = targetDir ? `${targetDir}/${file.name}` : file.name;
      const aid = nanoid();
      const { addToast, updateToast, removeToast } = useToastStore.getState();
      const toastId = addToast({ title: `Uploading ${file.name}`, kind: 'progress', percent: 0 });
      browserSocket.fileUpload(anid, aid, cwd, destPath, file, (err) => {
        if (err) {
          removeToast(toastId);
          setError(err);
          return;
        }
        updateToast(toastId, { kind: 'done', title: `Uploaded ${file.name}`, percent: undefined });
        setTimeout(() => removeToast(toastId), 3000);
        setCache(prev => { const next = new Map(prev); next.delete(targetDir); return next; });
        loadDir(targetDir);
      }, (percent) => {
        updateToast(toastId, { percent });
      });
    }
  }, [anid, cwd, loadDir]);

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

  const handleContextMenu = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleDownload = (entry: DirEntry) => {
    setContextMenu(null);
    const aid = nanoid();
    const { addToast, updateToast, removeToast } = useToastStore.getState();
    const toastId = addToast({ title: `Downloading ${entry.name}`, kind: 'progress', percent: 0 });
    browserSocket.fileDownload(anid, aid, cwd, entry.fullPath, (result, err) => {
      if (err || !result) {
        removeToast(toastId);
        setError(err ?? 'Download failed');
        return;
      }
      const blobParts = result.chunks.map(chunk => Uint8Array.from(atob(chunk), c => c.charCodeAt(0)));
      const blob = new Blob(blobParts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      updateToast(toastId, { kind: 'done', title: `Downloaded ${entry.name}`, percent: undefined });
      setTimeout(() => removeToast(toastId), 3000);
    }, (percent) => {
      updateToast(toastId, { percent });
    });
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
      // Invalidate the parent directory so it reloads
      const parentPath = confirmDelete.fullPath.includes('/')
        ? confirmDelete.fullPath.split('/').slice(0, -1).join('/')
        : '';
      setCache(prev => { const next = new Map(prev); next.delete(parentPath); return next; });
      if (parentPath === '') loadDir('');
    });
  };

  if (!cwd) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-base-content/40 px-3 text-center">
        No working directory
      </div>
    );
  }

  const rootEntries = cache.get('');
  const loading = (rootEntries === 'loading' || rootEntries === undefined) && !error;

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 h-8 border-b border-base-300 shrink-0">
          <span className="flex-1" />
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={() => setCollapseRevision(r => r + 1)}
            title="Collapse all folders"
            disabled={loading}
          >
            <ChevronsUp size={12} />
          </button>
          <button className="btn btn-xs btn-ghost p-0 w-6 h-6" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Body / drop zone */}
        <div
          className={`flex-1 overflow-y-auto overflow-x-hidden min-h-0 relative${isDragOver ? ' ring-2 ring-primary ring-inset' : ''}`}
          onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true); }}
          onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) { setIsDragOver(false); setDropDir(null); } }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDragOver(false);
            const targetDir = dropDir ?? '';
            setDropDir(null);
            if (e.dataTransfer.files.length > 0) handleFileDrop(e.dataTransfer.files, targetDir);
          }}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-end justify-center pointer-events-none pb-4">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-content text-xs font-medium shadow-lg">
                <Upload size={12} />
                {dropDir ? `Upload to ${dropDir.split('/').pop()}/` : 'Upload to root'}
              </div>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-16">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-2 text-xs text-error">{error}</div>
          )}
          {!loading && !error && Array.isArray(rootEntries) && (
            <ul className="py-1">
              {rootEntries.map(entry => (
                <li key={entry.fullPath}>
                  <TreeNodeRow
                    entry={entry}
                    depth={0}
                    cache={cache}
                    onExpand={loadDir}
                    collapseRevision={collapseRevision}
                    selectedFile={selectedFile}
                    onOpen={handleOpen}
                    onContextMenu={handleContextMenu}
                    dropTargetDir={dropDir}
                    onDirDragEnter={setDropDir}
                  />
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
          {!contextMenu.entry.isDir && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-base-200"
              onClick={() => handleDownload(contextMenu.entry)}
            >
              <Download size={11} />
              Download file
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error/10"
            onClick={() => { setConfirmDelete(contextMenu.entry); setContextMenu(null); }}
          >
            <Trash2 size={11} />
            Delete {contextMenu.entry.isDir ? 'folder' : 'file'}
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
