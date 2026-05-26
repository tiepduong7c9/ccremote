import { useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useGitStore } from '../git-store';
import GitChangesTab from './GitChangesTab';
import FileTreePanel from './FileTreePanel';

interface Props {
  anid: string;
  sid: string;
  cwd: string;
}

type Tab = 'changes' | 'files';

export default function RightPanel({ anid, sid, cwd }: Props) {
  const { panelCollapsed, setPanelCollapsed } = useGitStore();
  const [activeTab, setActiveTab] = useState<Tab>('changes');

  if (panelCollapsed) {
    return (
      <div className="w-8 shrink-0 border-l border-base-300 bg-base-200 flex flex-col items-center pt-2">
        <button
          className="btn btn-xs btn-ghost p-0 w-6 h-6"
          onClick={() => setPanelCollapsed(false)}
          title="Show panel"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0 border-l border-base-300 bg-base-200 flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 h-10 border-b border-base-300 shrink-0">
        <button
          className={`text-xs font-semibold px-1.5 py-0.5 rounded transition-colors ${activeTab === 'changes' ? 'bg-base-300 text-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
          onClick={() => setActiveTab('changes')}
        >
          Changes
        </button>
        <button
          className={`text-xs font-semibold px-1.5 py-0.5 rounded transition-colors ${activeTab === 'files' ? 'bg-base-300 text-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
          onClick={() => setActiveTab('files')}
        >
          Files
        </button>
        <div className="flex-1" />
        <button
          className="btn btn-xs btn-ghost p-0 w-6 h-6"
          onClick={() => setPanelCollapsed(true)}
          title="Collapse"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'changes' && <GitChangesTab anid={anid} sid={sid} cwd={cwd} />}
      {activeTab === 'files' && <FileTreePanel anid={anid} cwd={cwd} />}
    </div>
  );
}
