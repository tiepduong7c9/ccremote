import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { Wand2, Check } from 'lucide-react';
import { browserSocket } from '../ws';
import { useSkillStore } from '../skill-store';

interface Props {
  anid: string;
  cwd: string;
}

export default function SkillsTab({ anid, cwd }: Props) {
  const { skills, loading, error, loadSkills } = useSkillStore();
  // skillId -> 'injecting' | 'done' | error string
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => { loadSkills(); }, [loadSkills]);

  function inject(id: string) {
    setStatus(s => ({ ...s, [id]: 'injecting' }));
    let settled = false;
    const aid = nanoid(8);
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setStatus(s => ({ ...s, [id]: 'No response from agentnode' })); }
    }, 8000);
    browserSocket.skillInject(anid, aid, cwd, id, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setStatus(s => ({ ...s, [id]: err || 'done' }));
      if (!err) setTimeout(() => setStatus(s => { const n = { ...s }; delete n[id]; return n; }), 2500);
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 text-xs text-base-content/50 border-b border-base-300">
        Inject a skill into <span className="font-mono">.claude/skills/</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-3 text-xs text-base-content/50">Loading…</div>}
        {error && <div className="p-3 text-xs text-error">{error}</div>}
        {!loading && skills.length === 0 && (
          <div className="p-3 text-xs text-base-content/50">No skills in the library yet. Add one from the Skills button in the header.</div>
        )}
        {skills.map(s => {
          const st = status[s.id];
          return (
            <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-base-300/50">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.name}</div>
                {s.description && <div className="text-xs text-base-content/50 truncate">{s.description}</div>}
                {st && st !== 'injecting' && st !== 'done' && (
                  <div className="text-xs text-error truncate">{st}</div>
                )}
              </div>
              <button
                className="btn btn-xs btn-ghost gap-1 shrink-0"
                onClick={() => inject(s.id)}
                disabled={st === 'injecting'}
                title="Inject into this project"
              >
                {st === 'injecting' ? <span className="loading loading-spinner loading-xs" />
                  : st === 'done' ? <><Check size={13} /> Done</>
                  : <><Wand2 size={13} /> Inject</>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
