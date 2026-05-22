import { create } from 'zustand';
import type { AgentnodeView, SessionMeta } from './lib/protocol';

// ── Auth ─────────────────────────────────────────────────────────────────────
interface AuthState {
  authed: boolean | null;
  check: () => Promise<void>;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  authed: null,
  check: async () => {
    try {
      const res = await fetch('/api/me');
      set({ authed: res.ok });
    } catch {
      set({ authed: false });
    }
  },
  login: async (password: string) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) set({ authed: true });
    return res.ok;
  },
  logout: async () => {
    await fetch('/api/logout', { method: 'POST' });
    set({ authed: false });
  },
}));

// ── Registry ─────────────────────────────────────────────────────────────────
interface RegistryState {
  agentnodes: Map<string, AgentnodeView>;
  selectedAnid: string | null;
  selectedSid: string | null;
  activeTabBySid: Map<string, string>; // parentSid -> active tab sid
  select: (anid: string, sid: string | null) => void;
  setActiveTab: (parentSid: string, tabSid: string) => void;
  applySnapshot: (nodes: AgentnodeView[]) => void;
  setOnline: (node: { anid: string; name: string }) => void;
  setOffline: (anid: string) => void;
  setSessions: (anid: string, sessions: SessionMeta[]) => void;
}

export const useRegistryStore = create<RegistryState>((set, get) => ({
  agentnodes: new Map(),
  selectedAnid: null,
  selectedSid: null,
  activeTabBySid: new Map(),
  select: (anid, sid) => set({ selectedAnid: anid, selectedSid: sid }),
  setActiveTab: (parentSid, tabSid) => {
    set(state => {
      const map = new Map(state.activeTabBySid);
      map.set(parentSid, tabSid);
      return { activeTabBySid: map };
    });
  },
  applySnapshot: (nodes) => {
    const map = new Map(nodes.map(n => [n.id, n]));
    set({ agentnodes: map });
  },
  setOnline: ({ anid, name }) => {
    set(state => {
      const map = new Map(state.agentnodes);
      const existing = map.get(anid);
      map.set(anid, { id: anid, name, hostname: null, platform: null, sessions: [], ...existing, online: true });
      return { agentnodes: map };
    });
  },
  setOffline: (anid) => {
    set(state => {
      const map = new Map(state.agentnodes);
      const existing = map.get(anid);
      if (existing) map.set(anid, { ...existing, online: false });
      return { agentnodes: map };
    });
  },
  setSessions: (anid, sessions) => {
    set(state => {
      const map = new Map(state.agentnodes);
      const existing = map.get(anid);
      if (existing) map.set(anid, { ...existing, sessions });
      return { agentnodes: map };
    });
  },
}));

// ── Terminals ─────────────────────────────────────────────────────────────────
export interface AttachmentState {
  anid: string;
  sid: string | null;
  session: SessionMeta | null;
  status: 'attaching' | 'attached' | 'detached';
}

interface TerminalState {
  attachments: Map<string, AttachmentState>;
  setAttachment: (aid: string, state: AttachmentState) => void;
  removeAttachment: (aid: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  attachments: new Map(),
  setAttachment: (aid, state) => {
    set(s => {
      const map = new Map(s.attachments);
      map.set(aid, state);
      return { attachments: map };
    });
  },
  removeAttachment: (aid) => {
    set(s => {
      const map = new Map(s.attachments);
      map.delete(aid);
      return { attachments: map };
    });
  },
}));
