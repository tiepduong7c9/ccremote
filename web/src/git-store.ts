import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { GitCommit, GitFileChange } from './lib/protocol';
import { browserSocket } from './ws';

export interface GitStatusEntry {
  branch: string;
  files: GitFileChange[];
  loading: boolean;
  pulling: boolean;
  pullError?: string;
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
  pull: (anid: string, sid: string, cwd: string) => void;
  fetchDiff: (anid: string, cwd: string, filePath: string) => Promise<GitDiffResult>;
  revertFiles: (anid: string, sid: string, cwd: string, paths: string[], includeUntracked: boolean) => Promise<void>;
  listBranches: (anid: string, cwd: string) => Promise<string[]>;
  checkout: (anid: string, sid: string, cwd: string, branch: string) => Promise<void>;
  fetchLog: (anid: string, cwd: string, limit?: number) => Promise<GitCommit[]>;
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
      map.set(sid, { branch: existing?.branch ?? '', files: existing?.files ?? [], loading: true, pulling: existing?.pulling ?? false, error: undefined });
      return { statusBySid: map };
    });
    const aid = nanoid();
    browserSocket.gitStatus(anid, aid, cwd, (result, error) => {
      set(state => {
        const map = new Map(state.statusBySid);
        const existing = map.get(sid);
        if (error || !result) {
          map.set(sid, { branch: '', files: [], loading: false, pulling: existing?.pulling ?? false, error: error ?? 'Unknown error' });
        } else {
          map.set(sid, { branch: result.branch, files: result.files, loading: false, pulling: existing?.pulling ?? false });
        }
        return { statusBySid: map };
      });
    });
  },

  pull: (anid, sid, cwd) => {
    set(state => {
      const map = new Map(state.statusBySid);
      const existing = map.get(sid);
      map.set(sid, { branch: existing?.branch ?? '', files: existing?.files ?? [], loading: existing?.loading ?? false, pulling: true, pullError: undefined });
      return { statusBySid: map };
    });
    const aid = nanoid();
    browserSocket.gitPull(anid, aid, cwd, (result, error) => {
      set(state => {
        const map = new Map(state.statusBySid);
        const existing = map.get(sid);
        if (error || !result) {
          map.set(sid, { ...(existing ?? { branch: '', files: [], loading: false }), pulling: false, pullError: error ?? 'Pull failed' });
        } else {
          map.set(sid, { ...(existing ?? { branch: '', files: [], loading: false }), pulling: false, pullError: undefined });
          get().loadStatus(anid, sid, cwd);
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

  revertFiles: (anid, sid, cwd, paths, includeUntracked) => {
    return new Promise<void>((resolve, reject) => {
      const aid = nanoid();
      browserSocket.gitRevert(anid, aid, cwd, paths, includeUntracked, (error) => {
        if (error) reject(new Error(error));
        else {
          get().loadStatus(anid, sid, cwd);
          resolve();
        }
      });
    });
  },

  listBranches: (anid, cwd) => {
    return new Promise<string[]>((resolve, reject) => {
      const aid = nanoid();
      browserSocket.gitListBranches(anid, aid, cwd, (branches, error) => {
        if (error || !branches) reject(new Error(error ?? 'Unknown error'));
        else resolve(branches);
      });
    });
  },

  checkout: (anid, sid, cwd, branch) => {
    return new Promise<void>((resolve, reject) => {
      const aid = nanoid();
      browserSocket.gitCheckout(anid, aid, cwd, branch, (error) => {
        if (error) reject(new Error(error));
        else {
          get().loadStatus(anid, sid, cwd);
          resolve();
        }
      });
    });
  },

  fetchLog: (anid, cwd, limit = 30) => {
    return new Promise<GitCommit[]>((resolve, reject) => {
      const aid = nanoid();
      const t = setTimeout(() => reject(new Error('Request timed out')), 15000);
      browserSocket.gitLog(anid, aid, cwd, limit, (commits, error) => {
        clearTimeout(t);
        if (error || !commits) reject(new Error(error ?? 'Unknown error'));
        else resolve(commits);
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
