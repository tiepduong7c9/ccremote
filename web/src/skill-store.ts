import { create } from 'zustand';
import type { Skill } from './lib/protocol';

export interface SkillInput {
  name: string;
  description: string;
  content: string;
}

interface SkillState {
  skills: Skill[];
  loading: boolean;
  error?: string;
  loadSkills: () => Promise<void>;
  createSkill: (input: SkillInput) => Promise<Skill | null>;
  updateSkill: (id: string, input: Partial<SkillInput>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  loading: false,
  loadSkills: async () => {
    set({ loading: true, error: undefined });
    try {
      const res = await fetch('/api/skills', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const skills: Skill[] = await res.json();
      set({ skills, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },
  createSkill: async (input) => {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) { set({ error: `HTTP ${res.status}` }); return null; }
    const skill: Skill = await res.json();
    await get().loadSkills();
    return skill;
  },
  updateSkill: async (id, input) => {
    const res = await fetch(`/api/skills/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) { set({ error: `HTTP ${res.status}` }); return; }
    await get().loadSkills();
  },
  deleteSkill: async (id) => {
    const res = await fetch(`/api/skills/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { set({ error: `HTTP ${res.status}` }); return; }
    await get().loadSkills();
  },
}));
