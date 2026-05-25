import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { GitFileChange } from './lib/protocol';
import { browserSocket } from './ws';

export interface GitStatusEntry {
  branch: string;
  files: GitFileChange[];
  loading: boolean;
  error?: string;
}

export interface GitDiffResult {
  oldContent: string;
  newContent: string;
  language: string;
  isBinary: boolean;
  tooLarge: boolean;
}

interface GitState {
  statusBySid: Map<string, GitStatusEntry>;
  viewMode: 'flat' | 'tree';
  panelCollapsed: boolean;
  setViewMode: (mode: 'flat' | 'tree') => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  loadStatus: (anid: string, sid: string, cwd: string) => void;
  fetchDiff: (anid: string, cwd: string, filePath: string) => Promise<GitDiffResult>;
  clearForSession: (sid: string) => void;
}

function readLocalBool(key: string, defaultVal: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? defaultVal : v === 'true'; } catch { return defaultVal; }
}

function readLocalString<T extends string>(key: string, defaultVal: T): T {
  try { const v = localStorage.getItem(key); return (v as T) ?? defaultVal; } catch { return defaultVal; }
}

export const useGitStore = create<GitState>((set, get) => ({
  statusBySid: new Map(),
  viewMode: readLocalString<'flat' | 'tree'>('ccremote:git:viewMode', 'flat'),
  panelCollapsed: readLocalBool('ccremote:git:collapsed', false),

  setViewMode: (mode) => {
    try { localStorage.setItem('ccremote:git:viewMode', mode); } catch {}
    set({ viewMode: mode });
  },

  setPanelCollapsed: (collapsed) => {
    try { localStorage.setItem('ccremote:git:collapsed', String(collapsed)); } catch {}
    set({ panelCollapsed: collapsed });
  },

  loadStatus: (anid, sid, cwd) => {
    set(state => {
      const map = new Map(state.statusBySid);
      const existing = map.get(sid);
      map.set(sid, { branch: existing?.branch ?? '', files: existing?.files ?? [], loading: true, error: undefined });
      return { statusBySid: map };
    });
    const aid = nanoid();
    browserSocket.gitStatus(anid, aid, cwd, (result, error) => {
      set(state => {
        const map = new Map(state.statusBySid);
        if (error || !result) {
          map.set(sid, { branch: '', files: [], loading: false, error: error ?? 'Unknown error' });
        } else {
          map.set(sid, { branch: result.branch, files: result.files, loading: false });
        }
        return { statusBySid: map };
      });
    });
  },

  fetchDiff: (anid, cwd, filePath) => {
    return new Promise<GitDiffResult>((resolve, reject) => {
      const aid = nanoid();
      browserSocket.gitDiff(anid, aid, cwd, filePath, (result, error) => {
        if (error || !result) reject(new Error(error ?? 'Unknown error'));
        else resolve(result);
      });
    });
  },

  clearForSession: (sid) => {
    set(state => {
      const map = new Map(state.statusBySid);
      map.delete(sid);
      return { statusBySid: map };
    });
  },
}));
