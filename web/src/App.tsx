import { useEffect } from 'react';
import { useAuthStore, useRegistryStore } from './store';
import { browserSocket } from './ws';
import LoginScreen from './components/LoginScreen';
import AgentnodeSidebar from './components/AgentnodeSidebar';
import SessionList from './components/SessionList';
import TerminalPanel from './components/Terminal';
import ThemeToggle from './components/ThemeToggle';

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
    <div className="flex flex-col h-screen bg-base-100">
      <header className="flex items-center justify-between px-4 py-2 border-b border-base-300 bg-base-200">
        <span className="font-bold text-lg">ccremote</span>
        <ThemeToggle />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <AgentnodeSidebar
          selectedAnid={selectedAnid}
          onSelect={(anid) => select(anid, null)}
        />
        {selectedAnid && (
          <SessionList
            anid={selectedAnid}
            selectedSid={selectedSid}
            onSelect={(sid) => select(selectedAnid, sid)}
          />
        )}
        <main className="flex-1 overflow-hidden">
          {selectedAnid && selectedSid ? (
            <TerminalPanel anid={selectedAnid} sid={selectedSid} />
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/40">
              {selectedAnid ? 'Select or create a session' : 'Select an agentnode'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
