import { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, List, FolderTree, ChevronRight, ChevronLeft, CloudDownload } from 'lucide-react';
import { useGitStore } from '../git-store';
import GitFileList from './GitFileList';
import GitFileTree from './GitFileTree';
import DiffModal from './DiffModal';

interface Props {
  anid: string;
  sid: string;
  cwd: string;
}

export default function GitChangesPanel({ anid, sid, cwd }: Props) {
  const { statusBySid, viewMode, panelCollapsed, setViewMode, setPanelCollapsed, loadStatus, pull } = useGitStore();
  const status = statusBySid.get(sid);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleRefresh = () => { if (cwd) loadStatus(anid, sid, cwd); };
  const handlePull = () => { if (cwd) pull(anid, sid, cwd); };

  const handleOpenFile = (p: string) => {
    setSelectedFile(p);
    setDiffFile(p);
  };

  useEffect(() => {
    if (cwd && !panelCollapsed) loadStatus(anid, sid, cwd);
  }, [anid, sid, cwd]);

  // Collapsed rail
  if (panelCollapsed) {
    return (
      <div className="w-8 shrink-0 border-l border-base-300 bg-base-200 flex flex-col items-center pt-2">
        <button
          className="btn btn-xs btn-ghost p-0 w-6 h-6"
          onClick={() => setPanelCollapsed(false)}
          title="Show changes"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="w-72 shrink-0 border-l border-base-300 bg-base-200 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1 px-2 h-10 border-b border-base-300 shrink-0">
          <span className="text-xs font-semibold text-base-content/60 flex-1 min-w-0">Changes</span>
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={handleRefresh}
            title="Refresh"
            disabled={status?.loading}
          >
            <RefreshCw size={12} className={status?.loading ? 'animate-spin' : ''} />
          </button>
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
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={() => setPanelCollapsed(true)}
            title="Collapse"
          >
            <ChevronRight size={14} />
          </button>
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
            <div className="px-3 py-2 text-xs text-error">{status.error}</div>
          )}
          {status && !status.loading && !status.error && status.files.length === 0 && (
            <div className="flex items-center justify-center h-full text-xs text-base-content/40">
              Working tree clean
            </div>
          )}
          {status && !status.loading && !status.error && status.files.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-base-content/40 border-b border-base-300">
                {status.files.length} file{status.files.length !== 1 ? 's' : ''} changed
              </div>
              {viewMode === 'flat' ? (
                <GitFileList files={status.files} selectedFile={selectedFile} onOpen={handleOpenFile} />
              ) : (
                <GitFileTree files={status.files} selectedFile={selectedFile} onOpen={handleOpenFile} />
              )}
            </>
          )}
        </div>

        {/* Footer: branch + pull */}
        <div className="flex items-center gap-1 px-2 h-9 border-t border-base-300 shrink-0">
          <GitBranch size={12} className="text-base-content/40 shrink-0" />
          <span className="text-xs font-mono text-base-content/60 truncate flex-1 min-w-0">
            {status?.branch || '—'}
          </span>
          {status?.pullError && (
            <span className="text-xs text-error truncate max-w-[6rem]" title={status.pullError}>
              {status.pullError}
            </span>
          )}
          <button
            className="btn btn-xs btn-ghost p-0 w-6 h-6"
            onClick={handlePull}
            title="Pull from remote"
            disabled={!cwd || status?.pulling || status?.loading}
          >
            <CloudDownload size={13} className={status?.pulling ? 'animate-pulse' : ''} />
          </button>
        </div>
      </div>

      {diffFile && (
        <DiffModal
          anid={anid}
          cwd={cwd}
          filePath={diffFile}
          onClose={() => setDiffFile(null)}
        />
      )}

    </>
  );
}
