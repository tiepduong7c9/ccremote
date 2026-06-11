import { useEffect, useRef, useState } from 'react';
import { useAuthStore, useRegistryStore, useToastStore } from './store';
import { browserSocket } from './ws';
import LoginScreen from './components/LoginScreen';
import SessionCards from './components/SessionCards';
import TerminalTabs from './components/TerminalTabs';
import ThemeToggle from './components/ThemeToggle';
import NotificationToggle from './components/NotificationToggle';
import RightPanel from './components/RightPanel';
import FileSearchModal from './components/FileSearchModal';
import SkillsManagerModal from './components/SkillsManagerModal';
import UsageModal from './components/UsageModal';
import { Folder, TerminalSquare, ChevronRight, Wand2, Zap } from 'lucide-react';

export default function App() {
  const { authed, check } = useAuthStore();
  const { selectedAnid, selectedSid, select, agentnodes } = useRegistryStore();
  const { toasts, removeToast } = useToastStore();
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showUsage, setShowUsage] = useState(false);

  // Usage is per-agentnode; show the selected node's (or the first node with data).
  const usageNode = (selectedAnid ? agentnodes.get(selectedAnid) : null) || [...agentnodes.values()].find(n => n.usage?.usage);
  const usageData = usageNode?.usage ?? null;
  const openUsage = () => { setShowUsage(true); if (usageNode) browserSocket.usageRefresh(usageNode.id); };

  const session = selectedAnid && selectedSid
    ? agentnodes.get(selectedAnid)?.sessions.find(s => s.id === selectedSid)
    : null;

  const folder = session?.cwd
    ? session.cwd.split('/').filter(Boolean).pop() || '/'
    : null;

  // done → viewed → idle: while the selected session is "done" (claudeStatus
  // 'idle'), tell the agentnode it's been viewed so the card reverts to plain
  // idle. Fires both when you open a done session and when it finishes while
  // you're already viewing it; the agentnode clears it, so this won't re-fire.
  useEffect(() => {
    if (selectedAnid && selectedSid && session?.claudeStatus === 'idle') {
      browserSocket.markViewed(selectedAnid, selectedSid);
    }
  }, [selectedAnid, selectedSid, session?.claudeStatus]);

  // Ref so the keydown handler always sees current session without re-registering
  const fileSearchContextRef = useRef<{ anid: string; cwd: string } | null>(null);
  useEffect(() => {
    fileSearchContextRef.current = (selectedAnid && session?.cwd)
      ? { anid: selectedAnid, cwd: session.cwd }
      : null;
  }, [selectedAnid, session?.cwd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        if (fileSearchContextRef.current) setShowFileSearch(s => !s);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  useEffect(() => {
    check();
  }, []);

  useEffect(() => {
    if (authed) browserSocket.connect();
  }, [authed]);

  if (authed === null) return <div className="flex items-center justify-center h-screen"><span className="loading loading-spinner loading-lg" /></div>;
  if (!authed) return <LoginScreen />;

  return (
    <div className="flex h-screen bg-base-100">
      <SessionCards
        selectedAnid={selectedAnid}
        selectedSid={selectedSid}
        onSelect={(anid, sid) => select(anid, sid)}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between px-4 h-12 border-b border-base-300 bg-base-100 shrink-0">
          {session ? (
            <div className="flex items-center gap-2 min-w-0">
              <Folder size={15} className="shrink-0 text-base-content/40" />
              <span className="text-sm font-semibold truncate">{folder}</span>
              <ChevronRight size={13} className="shrink-0 text-base-content/30" />
              <TerminalSquare size={13} className="shrink-0 text-base-content/40" />
              <span className="text-sm text-base-content/70 truncate">{session.name}</span>
              <span
                className="text-xs text-base-content/70 font-mono truncate hidden sm:block translate-y-0.5"
                title={session.cwd}
              >{session.cwd}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-base-content/50">
              <TerminalSquare size={16} />
              <span className="text-sm font-semibold">ccremote</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            {usageData?.usage && (
              <button
                className="btn btn-ghost btn-sm gap-1.5 font-normal"
                onClick={openUsage}
                title="Account & usage"
              >
                <Zap size={13} style={{ color: '#c96442' }} />
                <span className="text-xs tabular-nums">5h {Math.round(usageData.usage.five_hour?.utilization ?? 0)}%</span>
                <span className="text-xs text-base-content/60 tabular-nums">7d {Math.round(usageData.usage.seven_day?.utilization ?? 0)}%</span>
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm gap-1"
              onClick={() => setShowSkills(true)}
              title="Skill library"
            >
              <Wand2 size={15} /> Skills
            </button>
            <NotificationToggle />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {selectedAnid && selectedSid ? (
            <TerminalTabs anid={selectedAnid} parentSid={selectedSid} />
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
              Select or create a session
            </div>
          )}
        </main>
      </div>
      {selectedAnid && selectedSid && (
        <RightPanel anid={selectedAnid} sid={selectedSid} cwd={session?.cwd ?? ''} />
      )}
      {showFileSearch && fileSearchContextRef.current && (
        <FileSearchModal
          anid={fileSearchContextRef.current.anid}
          cwd={fileSearchContextRef.current.cwd}
          onClose={() => setShowFileSearch(false)}
        />
      )}
      {showSkills && <SkillsManagerModal onClose={() => setShowSkills(false)} />}
      {showUsage && <UsageModal detail={usageData} onClose={() => setShowUsage(false)} />}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg shadow-lg border text-sm pointer-events-auto min-w-48
                ${t.kind === 'done'
                  ? 'bg-violet-50 border-violet-200 text-violet-900 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100'
                  : t.kind === 'progress'
                    ? 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-100'
                    : 'bg-yellow-50 border-yellow-200 text-yellow-900 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-100'
                }`}
            >
              <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${t.kind === 'done' ? 'bg-violet-500' : t.kind === 'progress' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium leading-tight">{t.title}</span>
                {t.body && <span className="text-xs opacity-60 leading-tight">{t.body}</span>}
                {t.kind === 'progress' && (
                  <div className="mt-1.5 w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1">
                    <div
                      className="bg-blue-500 h-1 rounded-full transition-all duration-150"
                      style={{ width: `${t.percent ?? 0}%` }}
                    />
                  </div>
                )}
              </div>
              <button
                className="ml-1 opacity-40 hover:opacity-80 text-xs leading-none shrink-0"
                onClick={() => removeToast(t.id)}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
