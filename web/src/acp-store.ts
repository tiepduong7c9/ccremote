import { create } from 'zustand';
import type { AcpEvent } from './lib/protocol';

export interface AcpThreadState {
  events: AcpEvent[];
  claudeStatus?: 'working' | 'waiting' | 'idle';
  acpSessionId: string | null;
  lastSeq: number; // highest event seq applied — used to dedupe fan-out
}

interface AcpStore {
  // keyed by session id (sid)
  threads: Map<string, AcpThreadState>;
  setHistory: (sid: string, events: AcpEvent[], claudeStatus: AcpThreadState['claudeStatus'], acpSessionId: string | null) => void;
  appendEvent: (sid: string, event: AcpEvent) => void;
  resolvePermissionLocal: (sid: string, requestId: string, optionId: string | null) => void;
  clear: (sid: string) => void;
}

export const useAcpStore = create<AcpStore>((set) => ({
  threads: new Map(),

  setHistory: (sid, events, claudeStatus, acpSessionId) => set((s) => {
    const threads = new Map(s.threads);
    const lastSeq = events.reduce((m, e) => (typeof e.seq === 'number' && e.seq > m ? e.seq : m), -1);
    threads.set(sid, { events: [...events], claudeStatus, acpSessionId, lastSeq });
    return { threads };
  }),

  appendEvent: (sid, event) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid) ?? { events: [], claudeStatus: undefined, acpSessionId: null, lastSeq: -1 };
    // Status updates carry no seq and are idempotent.
    if (event.type === 'acp_status') {
      threads.set(sid, { ...prev, claudeStatus: event.claudeStatus });
      return { threads };
    }
    // Drop duplicates fanned out from multiple attachments to the same session.
    if (typeof event.seq === 'number' && event.seq <= prev.lastSeq) return {};
    const lastSeq = typeof event.seq === 'number' ? event.seq : prev.lastSeq;
    threads.set(sid, { ...prev, events: [...prev.events, event], lastSeq });
    return { threads };
  }),

  resolvePermissionLocal: (sid, requestId, optionId) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid);
    if (!prev) return {};
    const events = prev.events.map((e) =>
      e.type === 'acp_permission' && e.requestId === requestId
        ? { ...e, resolved: optionId ?? '__cancelled__' }
        : e
    );
    threads.set(sid, { ...prev, events });
    return { threads };
  }),

  clear: (sid) => set((s) => {
    const threads = new Map(s.threads);
    threads.delete(sid);
    return { threads };
  }),
}));
