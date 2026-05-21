import { useEffect } from 'react';
import { useAuthStore, useRegistryStore } from './store';
import { browserSocket } from './ws';
import LoginScreen from './components/LoginScreen';
import SessionCards from './components/SessionCards';
import TerminalPanel from './components/Terminal';
import ThemeToggle from './components/ThemeToggle';
import { TerminalSquare } from 'lucide-react';

export default function App() {
  const { authed, check } = useAuthStore();
  const { selectedAnid, selectedSid, select } = useRegistryStore();

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
        <header className="flex items-center justify-between px-4 py-2 border-b border-base-300 bg-base-200 shrink-0">
          <div className="flex items-center gap-2 text-base-content/50">
            <TerminalSquare size={16} />
            <span className="text-sm font-semibold">ccremote</span>
          </div>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-hidden">
          {selectedAnid && selectedSid ? (
            <TerminalPanel anid={selectedAnid} sid={selectedSid} />
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
              Select or create a session
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
