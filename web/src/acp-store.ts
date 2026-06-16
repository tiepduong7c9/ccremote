import { create } from 'zustand';
import type { AcpCommand, AcpEvent, AcpModeState, AcpModelState } from './lib/protocol';

export interface AcpThreadState {
  events: AcpEvent[];
  claudeStatus?: 'working' | 'waiting' | 'idle';
  acpSessionId: string | null;
  modeState?: AcpModeState | null;
  availableCommands?: AcpCommand[];
  model?: string | null;
  modelState?: AcpModelState | null;
  pendingModelId?: string | null; // model the user picked, awaiting backend confirmation
  lastSeq: number; // highest event seq applied — used to dedupe fan-out
  historyLoaded?: boolean; // true once the acp_history snapshot has been applied
  historyLoading?: boolean; // snapshot was empty because a resume is still replaying history
}

interface AcpStore {
  // keyed by session id (sid)
  threads: Map<string, AcpThreadState>;
  setHistory: (sid: string, events: AcpEvent[], claudeStatus: AcpThreadState['claudeStatus'], acpSessionId: string | null, modeState?: AcpModeState | null, availableCommands?: AcpCommand[], model?: string | null, modelState?: AcpModelState | null, loading?: boolean) => void;
  appendEvent: (sid: string, event: AcpEvent) => void;
  resolvePermissionLocal: (sid: string, requestId: string, optionId: string | null) => void;
  setModeLocal: (sid: string, modeId: string) => void;
  setModelLocal: (sid: string, modelId: string) => void;
  clearPendingModel: (sid: string) => void;
  clear: (sid: string) => void;
}

export const useAcpStore = create<AcpStore>((set) => ({
  threads: new Map(),

  setHistory: (sid, events, claudeStatus, acpSessionId, modeState, availableCommands, model, modelState, loading) => set((s) => {
    const threads = new Map(s.threads);
    const lastSeq = events.reduce((m, e) => (typeof e.seq === 'number' && e.seq > m ? e.seq : m), -1);
    threads.set(sid, { events: [...events], claudeStatus, acpSessionId, modeState: modeState ?? null, availableCommands: availableCommands ?? [], model: model ?? null, modelState: modelState ?? null, lastSeq, historyLoaded: true, historyLoading: !!loading });
    return { threads };
  }),

  appendEvent: (sid, event) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid) ?? { events: [], claudeStatus: undefined, acpSessionId: null, modeState: null, lastSeq: -1 };
    // Status & mode updates carry no seq and are idempotent.
    if (event.type === 'acp_status') {
      threads.set(sid, { ...prev, claudeStatus: event.claudeStatus });
      return { threads };
    }
    if (event.type === 'acp_mode') {
      threads.set(sid, { ...prev, modeState: event.modeState });
      return { threads };
    }
    if (event.type === 'acp_commands') {
      threads.set(sid, { ...prev, availableCommands: event.commands });
      return { threads };
    }
    if (event.type === 'acp_model') {
      // Authoritative model state from the agentnode — clears any pending switch.
      threads.set(sid, { ...prev, model: event.model, modelState: event.modelState ?? prev.modelState ?? null, pendingModelId: null });
      return { threads };
    }
    // Conversation switched (new/resume): wipe the thread and start fresh.
    if (event.type === 'acp_reset') {
      threads.set(sid, { ...prev, events: [], lastSeq: -1, claudeStatus: undefined, acpSessionId: event.acpSessionId, model: null });
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

  setModeLocal: (sid, modeId) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid);
    if (!prev || !prev.modeState) return {};
    threads.set(sid, { ...prev, modeState: { ...prev.modeState, currentModeId: modeId } });
    return { threads };
  }),

  // Record the user's pick as pending; the confirmed currentModelId is only
  // updated when the agentnode echoes back an acp_model event.
  setModelLocal: (sid, modelId) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid);
    if (!prev) return {};
    threads.set(sid, { ...prev, pendingModelId: modelId });
    return { threads };
  }),

  clearPendingModel: (sid) => set((s) => {
    const threads = new Map(s.threads);
    const prev = threads.get(sid);
    if (!prev || prev.pendingModelId == null) return {};
    threads.set(sid, { ...prev, pendingModelId: null });
    return { threads };
  }),

  clear: (sid) => set((s) => {
    const threads = new Map(s.threads);
    threads.delete(sid);
    return { threads };
  }),
}));
