import { useEffect, useRef, useState } from 'react';
import { GitBranch, RefreshCw, List, FolderTree, CloudDownload, ChevronsUp, RotateCcw, Check, History, FolderGit2 } from 'lucide-react';
import { useGitStore } from '../git-store';
import type { GitCommit, GitFileChange } from '../lib/protocol';
import GitFileList from './GitFileList';
import GitFileTree from './GitFileTree';
import GitStatusBadge from './GitStatusBadge';
import DiffModal from './DiffModal';
import GitLogModal from './GitLogModal';

interface Props {
  anid: string;
  sid: string;
  cwd: string;
}

interface ConfirmRevert {
  paths: string[];
  label: string;
  scopedFiles: GitFileChange[];
}

export default function GitChangesTab({ anid, sid, cwd }: Props) {
  const { statusBySid, viewMode, setViewMode, loadStatus, pull, revertFiles, listBranches, checkout, fetchLog } = useGitStore();
  const status = statusBySid.get(sid);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const lastClickedIndex = useRef<number | null>(null);
  const [collapseRevision, setCollapseRevision] = useState(0);
  const [confirmRevert, setConfirmRevert] = useState<ConfirmRevert | null>(null);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logCommits, setLogCommits] = useState<GitCommit[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cwd) loadStatus(anid, sid, cwd);
  }, [anid, sid, cwd]);

  useEffect(() => {
    setSelectedFiles(new Set());
    lastClickedIndex.current = null;
  }, [sid]);

  useEffect(() => {
    if (!branchMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false);
        setCheckoutError(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [branchMenuOpen]);

  const handleRefresh = () => { if (cwd) loadStatus(anid, sid, cwd); };
  const handlePull = () => { if (cwd) pull(anid, sid, cwd); };

  const handleHistoryOpen = async () => {
    setLogOpen(true);
    setLogLoading(true);
    setLogError(null);
    setLogCommits([]);
    try {
      const commits = await fetchLog(anid, cwd);
      setLogCommits(commits);
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLogLoading(false);
    }
  };

  const handleBranchClick = async () => {
    if (!cwd) return;
    setBranchMenuOpen(v => !v);
    setCheckoutError(null);
    if (!branchMenuOpen) {
      setBranchesLoading(true);
      try {
        const list = await listBranches(anid, cwd);
        setBranches(list);
      } catch {
        setBranches([]);
      } finally {
        setBranchesLoading(false);
      }
    }
  };

  const handleCheckout = async (branch: string) => {
    if (!cwd || branch === status?.branch) { setBranchMenuOpen(false); return; }
    setCheckingOut(branch);
    setCheckoutError(null);
    try {
      await checkout(anid, sid, cwd, branch);
      setBranchMenuOpen(false);
    } catch (e: unknown) {
      setCheckoutError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setCheckingOut(null);
    }
  };

  const handleFileClick = (path: string, shiftKey: boolean) => {
    if (!status) return;
    const idx = status.files.findIndex(f => f.path === path);
    if (shiftKey && lastClickedIndex.current !== null) {
      const lo = Math.min(lastClickedIndex.current, idx);
      const hi = Math.max(lastClickedIndex.current, idx);
      const range = status.files.slice(lo, hi + 1).map(f => f.path);
      setSelectedFiles(prev => new Set([...prev, ...range]));
    } else {
      setSelectedFiles(new Set([path]));
      lastClickedIndex.current = idx;
      setDiffFile(path);
    }
  };

  const handleRevert = (path: string, isFolder: boolean) => {
    if (!status) return;
    if (!isFolder && selectedFiles.size > 1 && selectedFiles.has(path)) {
      const paths = [...selectedFiles];
      const scopedFiles = status.files.filter(f => paths.includes(f.path));
      setIncludeUntracked(false);
      setRevertError(null);
      setConfirmRevert({ paths, label: `${paths.length} files`, scopedFiles });
      return;
    }
    let scopedFiles: GitFileChange[];
    if (isFolder) {
      const prefix = path + '/';
      scopedFiles = status.files.filter(f => f.path.startsWith(prefix));
    } else {
      scopedFiles = status.files.filter(f => f.path === path);
    }
    setIncludeUntracked(false);
    setRevertError(null);
    setConfirmRevert({ paths: [path], label: isFolder ? 'folder' : 'file', scopedFiles });
  };

  const handleMultiRevert = () => {
    if (!status || selectedFiles.size === 0) return;
    const paths = [...selectedFiles];
    const scopedFiles = status.files.filter(f => paths.includes(f.path));
    setIncludeUntracked(false);
    setRevertError(null);
    setConfirmRevert({ paths, label: `${paths.length} files`, scopedFiles });
  };

  const handleRevertConfirm = async () => {
    if (!confirmRevert) return;
    setReverting(true);
    setRevertError(null);
    try {
      await revertFiles(anid, sid, cwd, confirmRevert.paths, includeUntracked);
      setConfirmRevert(null);
      setSelectedFiles(new Set());
      lastClickedIndex.current = null;
    } catch (e: unknown) {
      setRevertError(e instanceof Error ? e.message : 'Revert failed');
    } finally {
      setReverting(false);
    }
  };

  const trackedCount = confirmRevert ? confirmRevert.scopedFiles.filter(f => !f.untracked).length : 0;
  const untrackedCount = confirmRevert ? confirmRevert.scopedFiles.filter(f => f.untracked).length : 0;

  const notGit = !!status?.error && /not a git repository/i.test(status.error);

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 h-8 border-b border-base-300 shrink-0">
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-xs text-base-content/40 truncate">
              {status && !status.loading && !status.error && status.files.length > 0
                ? `${status.files.length} file${status.files.length !== 1 ? 's' : ''} changed`
                : ''}
            </span>
            {selectedFiles.size > 1 && (
              <button
                className="btn btn-xs btn-warning h-5 min-h-0 px-1.5 gap-0.5 shrink-0"
                onClick={handleMultiRevert}
                title={`Revert ${selectedFiles.size} selected files`}
              >
                <RotateCcw size={9} />
                <span>{selectedFiles.size}</span>
              </button>
            )}
          </span>
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={handleRefresh}
            title="Refresh"
            disabled={status?.loading}
          >
            <RefreshCw size={12} className={status?.loading ? 'animate-spin' : ''} />
          </button>
          {!notGit && <>
            <button
              className={`btn btn-xs btn-ghost p-0 w-6 h-6 ${viewMode === 'flat' ? 'btn-active' : ''}`}
              onClick={() => setViewMode('flat')}
              title="Flat list"
            >
              <List size={12} />
            </button>
            <button
              className={`btn btn-xs btn-ghost p-0 w-6 h-6 ${viewMode === 'tree' ? 'btn-active' : ''}`}
              onClick={() => setViewMode('tree')}
              title="Tree view"
            >
              <FolderTree size={12} />
            </button>
            {viewMode === 'tree' && (
              <button
                className="btn btn-xs btn-ghost p-0 w-6 h-6"
                onClick={() => setCollapseRevision(r => r + 1)}
                title="Collapse all folders"
              >
                <ChevronsUp size={12} />
              </button>
            )}
          </>}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {!cwd && (
            <div className="flex items-center justify-center h-full text-xs text-base-content/40 px-3 text-center">
              No working directory
            </div>
          )}
          {cwd && !status && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-base-content/40">
              <GitBranch size={20} />
              <button className="btn btn-xs btn-ghost" onClick={handleRefresh}>Load changes</button>
            </div>
          )}
          {status?.loading && (
            <div className="flex items-center justify-center h-16">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
          {status?.error && !status.loading && (
            /not a git repository/i.test(status.error) ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-base-content/40">
                <FolderGit2 size={28} className="opacity-60" />
                <p className="text-sm font-medium text-base-content/60">Not a git repository</p>
                <p className="text-xs">This folder isn't tracked by git, so there are no changes to show.</p>
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-error">{status.error}</div>
            )
          )}
          {status && !status.loading && !status.error && status.files.length === 0 && (
            <div className="flex items-center justify-center h-full text-xs text-base-content/40">
              Working tree clean
            </div>
          )}
          {status && !status.loading && !status.error && status.files.length > 0 && (
            <>
              {viewMode === 'flat' ? (
                <GitFileList files={status.files} selectedFiles={selectedFiles} selectedCount={selectedFiles.size} onFileClick={handleFileClick} onRevert={handleRevert} />
              ) : (
                <GitFileTree files={status.files} selectedFiles={selectedFiles} selectedCount={selectedFiles.size} onFileClick={handleFileClick} onRevert={handleRevert} collapseRevision={collapseRevision} />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!notGit && (
        <div className="relative flex items-center gap-1 px-2 h-9 border-t border-base-300 shrink-0" ref={branchMenuRef}>
          {branchMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 mx-1 bg-base-100 border border-base-300 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
              {branchesLoading && (
                <div className="flex items-center justify-center py-3">
                  <span className="loading loading-spinner loading-xs" />
                </div>
              )}
              {!branchesLoading && branches.length === 0 && (
                <div className="px-3 py-2 text-xs text-base-content/40">No branches found</div>
              )}
              {!branchesLoading && branches.map(b => (
                <button
                  key={b}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left hover:bg-base-200 disabled:opacity-50 ${b === status?.branch ? 'text-primary' : 'text-base-content'}`}
                  onClick={() => handleCheckout(b)}
                  disabled={checkingOut !== null}
                >
                  {b === status?.branch
                    ? <Check size={11} className="shrink-0" />
                    : <span className="w-[11px] shrink-0" />
                  }
                  <span className="truncate">{b}</span>
                  {checkingOut === b && <span className="loading loading-spinner loading-xs ml-auto" />}
                </button>
              ))}
              {checkoutError && (
                <div className="px-3 py-2 text-xs text-error border-t border-base-300">{checkoutError}</div>
              )}
            </div>
          )}
          <button
            className="flex items-center gap-1 min-w-0 flex-1 hover:text-base-content text-base-content/60 disabled:cursor-default disabled:hover:text-base-content/60"
            onClick={handleBranchClick}
            disabled={!cwd || !status || notGit}
            title="Switch branch"
          >
            <GitBranch size={12} className="text-base-content/40 shrink-0" />
            <span className="text-xs font-mono truncate flex-1 min-w-0 text-left">
              {status?.branch || '—'}
            </span>
          </button>
          {status?.pullError && (
            <span className="text-xs text-error truncate max-w-[6rem]" title={status.pullError}>
              {status.pullError}
            </span>
          )}
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={handleHistoryOpen}
            title="Commit history"
            disabled={!cwd || notGit}
          >
            <History size={13} />
          </button>
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={handlePull}
            title="Pull from remote"
            disabled={!cwd || status?.pulling || status?.loading || notGit}
          >
            <CloudDownload size={13} className={status?.pulling ? 'animate-pulse' : ''} />
          </button>
        </div>
        )}
      </div>

      {diffFile && (
        <DiffModal
          anid={anid}
          cwd={cwd}
          filePath={diffFile}
          onClose={() => setDiffFile(null)}
        />
      )}

      {logOpen && (
        <GitLogModal
          branch={status?.branch ?? ''}
          commits={logCommits}
          loading={logLoading}
          error={logError}
          onClose={() => setLogOpen(false)}
        />
      )}

      {/* Revert confirmation dialog */}
      {confirmRevert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-base-100 rounded-lg shadow-xl border border-base-300 p-5 w-96 max-w-full">
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw size={15} className="text-warning shrink-0" />
              <h3 className="font-semibold text-sm">
                Revert {confirmRevert.label}?
              </h3>
            </div>
            <div className="rounded-md border border-base-300 bg-base-200/40 divide-y divide-base-300/50 max-h-44 overflow-y-auto mb-3">
              {confirmRevert.scopedFiles.slice(0, 100).map(f => {
                const slash = f.path.lastIndexOf('/');
                const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '';
                const base = slash >= 0 ? f.path.slice(slash + 1) : f.path;
                return (
                  <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5">
                    <GitStatusBadge indexStatus={f.indexStatus} worktreeStatus={f.worktreeStatus} untracked={f.untracked} />
                    <span className="font-mono text-xs truncate flex-1 min-w-0">
                      {dir && <span className="text-base-content/40">{dir}</span>}
                      <span className="text-base-content/90">{base}</span>
                    </span>
                    {f.untracked && <span className="badge badge-xs badge-ghost shrink-0">new</span>}
                  </div>
                );
              })}
              {confirmRevert.scopedFiles.length > 100 && (
                <div className="px-2.5 py-1.5 text-xs text-base-content/40">
                  …and {confirmRevert.scopedFiles.length - 100} more
                </div>
              )}
            </div>
            {trackedCount > 0 && (
              <p className="text-xs text-base-content/60 mb-3">
                {trackedCount} tracked file{trackedCount !== 1 ? 's' : ''} will be restored to the last commit. This cannot be undone.
              </p>
            )}
            {untrackedCount > 0 && (
              <label className="flex items-start gap-2.5 mb-3 p-2.5 rounded-md border border-warning/40 bg-warning/10 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-warning mt-0.5 shrink-0"
                  checked={includeUntracked}
                  onChange={e => setIncludeUntracked(e.target.checked)}
                  disabled={reverting}
                />
                <span className="text-xs text-base-content/80 leading-snug">
                  Also delete {untrackedCount} untracked file{untrackedCount !== 1 ? 's' : ''}
                  <span className="block text-base-content/50">Not committed — permanently removed, cannot be undone.</span>
                </span>
              </label>
            )}
            {revertError && (
              <p className="text-xs text-error mb-3">{revertError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => setConfirmRevert(null)}
                disabled={reverting}
              >
                Cancel
              </button>
              <button
                className="btn btn-xs btn-warning"
                onClick={handleRevertConfirm}
                disabled={reverting || (trackedCount === 0 && !includeUntracked)}
              >
                {reverting ? <span className="loading loading-spinner loading-xs" /> : 'Revert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
