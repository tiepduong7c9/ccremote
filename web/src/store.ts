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

// Focus view shows only "pinned" sessions in a flat list (no agentnode sections),
// for when many cards exist across nodes but you only actively work on a few.
// Both the toggle and the pin set are persisted to localStorage.
const FOCUS_MODE_KEY = 'ccremote:focus-mode';
const PINNED_KEY = 'ccremote:pinned-sessions';

// Pins are keyed by agentnode + session so the same sid on different nodes
// can't collide.
export function pinKey(anid: string, sid: string): string {
  return `${anid}:${sid}`;
}

function loadFocusMode(): boolean {
  try { return localStorage.getItem(FOCUS_MODE_KEY) === 'true'; } catch { return false; }
}

function loadPinned(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(PINNED_KEY) || '[]')); } catch { return new Set(); }
}

interface RegistryState {
  agentnodes: Map<string, AgentnodeView>;
  selectedAnid: string | null;
  selectedSid: string | null;
  activeTabBySid: Map<string, string>; // parentSid -> active tab sid
  focusMode: boolean;
  pinned: Set<string>; // pinKey(anid, sid)
  select: (anid: string, sid: string | null) => void;
  setActiveTab: (parentSid: string, tabSid: string) => void;
  setFocusMode: (on: boolean) => void;
  togglePin: (anid: string, sid: string) => void;
  applySnapshot: (nodes: AgentnodeView[]) => void;
  setOnline: (node: { anid: string; name: string }) => void;
  setOffline: (anid: string) => void;
  setSessions: (anid: string, sessions: SessionMeta[]) => void;
  setUsage: (anid: string, usage: AgentnodeView['usage']) => void;
}

export const useRegistryStore = create<RegistryState>((set, get) => ({
  agentnodes: new Map(),
  selectedAnid: null,
  selectedSid: null,
  activeTabBySid: new Map(),
  focusMode: loadFocusMode(),
  pinned: loadPinned(),
  select: (anid, sid) => set({ selectedAnid: anid, selectedSid: sid }),
  setFocusMode: (on) => {
    try { localStorage.setItem(FOCUS_MODE_KEY, String(on)); } catch {}
    set({ focusMode: on });
  },
  togglePin: (anid, sid) => {
    set(state => {
      const key = pinKey(anid, sid);
      const next = new Set(state.pinned);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(PINNED_KEY, JSON.stringify([...next])); } catch {}
      return { pinned: next };
    });
  },
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
  setUsage: (anid, usage) => {
    set(state => {
      const map = new Map(state.agentnodes);
      const existing = map.get(anid);
      if (existing) map.set(anid, { ...existing, usage });
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

// ── Toasts ────────────────────────────────────────────────────────────────────
export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  kind: 'done' | 'waiting' | 'progress';
  percent?: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (t: Omit<ToastItem, 'id'>) => string;
  updateToast: (id: string, patch: Partial<Omit<ToastItem, 'id'>>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (t) => {
    const id = Math.random().toString(36).slice(2, 9);
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (t.kind !== 'progress') {
      setTimeout(() => {
        set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }));
      }, 5000);
    }
    return id;
  },
  updateToast: (id, patch) => set(s => ({
    toasts: s.toasts.map(t => t.id === id ? { ...t, ...patch } : t),
  })),
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
}));
