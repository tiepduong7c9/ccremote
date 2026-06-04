import { useEffect, useState } from 'react';
import { Wand2, Plus, Trash2 } from 'lucide-react';
import { useSkillStore } from '../skill-store';
import type { Skill } from '../lib/protocol';

const SKILL_TEMPLATE = `---
name: my-skill
description: One line describing when to use this skill.
---

# My Skill

Steps or guidance for Claude here.
`;

export default function SkillsManagerModal({ onClose }: { onClose: () => void }) {
  const { skills, loading, error, loadSkills, createSkill, updateSkill, deleteSkill } = useSkillStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const selected = skills.find(s => s.id === selectedId) || null;

  function loadIntoForm(s: Skill | null) {
    setName(s?.name ?? '');
    setDescription(s?.description ?? '');
    setContent(s?.content ?? '');
    setDirty(false);
  }

  function selectSkill(s: Skill) {
    setSelectedId(s.id);
    loadIntoForm(s);
  }

  function newSkill() {
    setSelectedId(null);
    setName('');
    setDescription('');
    setContent(SKILL_TEMPLATE);
    setDirty(true);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    if (selectedId) {
      await updateSkill(selectedId, { name, description, content });
    } else {
      const created = await createSkill({ name, description, content });
      if (created) setSelectedId(created.id);
    }
    setSaving(false);
    setDirty(false);
  }

  async function remove() {
    if (!selectedId) return;
    await deleteSkill(selectedId);
    setSelectedId(null);
    loadIntoForm(null);
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-4xl w-full p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-base-300">
          <Wand2 size={18} />
          <h3 className="font-bold text-lg">Skill Library</h3>
          <div className="flex-1" />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="flex h-[60vh]">
          {/* List */}
          <div className="w-56 shrink-0 border-r border-base-300 flex flex-col">
            <div className="p-2">
              <button className="btn btn-xs btn-primary gap-1 w-full" onClick={newSkill}>
                <Plus size={13} /> New skill
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && <div className="p-3 text-xs text-base-content/50">Loading…</div>}
              {!loading && skills.length === 0 && (
                <div className="p-3 text-xs text-base-content/50">No skills yet.</div>
              )}
              {skills.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectSkill(s)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-base-300/50 ${selectedId === s.id ? 'bg-base-300' : 'hover:bg-base-200'}`}
                >
                  <div className="font-medium truncate">{s.name}</div>
                  {s.description && <div className="text-xs text-base-content/50 truncate">{s.description}</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
            {selectedId === null && !dirty ? (
              <div className="m-auto text-sm text-base-content/50">Select a skill or create a new one.</div>
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="form-control flex-1">
                    <label className="label py-1"><span className="label-text text-xs">Name</span></label>
                    <input
                      className="input input-bordered input-sm"
                      value={name}
                      onChange={e => { setName(e.target.value); setDirty(true); }}
                      placeholder="e.g. code-review"
                    />
                  </div>
                  <div className="form-control flex-[2]">
                    <label className="label py-1"><span className="label-text text-xs">Description</span></label>
                    <input
                      className="input input-bordered input-sm"
                      value={description}
                      onChange={e => { setDescription(e.target.value); setDirty(true); }}
                      placeholder="When should Claude use this?"
                    />
                  </div>
                </div>
                <div className="form-control flex-1">
                  <label className="label py-1"><span className="label-text text-xs">SKILL.md</span></label>
                  <textarea
                    className="textarea textarea-bordered w-full font-mono text-xs flex-1 resize-none min-h-64"
                    value={content}
                    onChange={e => { setContent(e.target.value); setDirty(true); }}
                  />
                </div>
                {error && <div className="text-xs text-error">{error}</div>}
                <div className="flex items-center gap-2">
                  {selectedId && (
                    <button className="btn btn-sm btn-ghost text-error gap-1" onClick={remove}>
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={save}
                    disabled={saving || !name.trim() || !dirty}
                  >
                    {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
