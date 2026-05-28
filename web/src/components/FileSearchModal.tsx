import { useState, useEffect, useRef, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { Search, File } from 'lucide-react';
import { browserSocket } from '../ws';
import FileModal from './FileModal';

interface Props {
  anid: string;
  cwd: string;
  onClose: () => void;
}

export default function FileSearchModal({ anid, cwd, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const aid = nanoid();
    browserSocket.fileList(anid, aid, cwd, (files) => {
      setLoading(false);
      if (files) setAllFiles(files);
    });
  }, [anid, cwd]);

  const filtered = query
    ? (() => {
        const q = query.toLowerCase();
        return allFiles
          .filter(f => f.toLowerCase().includes(q))
          .sort((a, b) => {
            const aName = (a.split('/').pop() ?? a).toLowerCase();
            const bName = (b.split('/').pop() ?? b).toLowerCase();
            const aHit = aName.includes(q);
            const bHit = bName.includes(q);
            if (aHit && !bHit) return -1;
            if (!aHit && bHit) return 1;
            return a.localeCompare(b);
          });
      })()
    : allFiles;

  useEffect(() => { setSelected(0); }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openSelected = useCallback(() => {
    if (filtered[selected]) setOpenFile(filtered[selected]);
  }, [filtered, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filtered.length, openSelected]);

  if (openFile) {
    return <FileModal anid={anid} cwd={cwd} filePath={openFile} onClose={() => setOpenFile(null)} />;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl bg-base-200 border border-base-300 rounded-xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '60vh' }}>
        <div className="flex items-center gap-2 px-3 border-b border-base-300 h-11 shrink-0">
          <Search size={15} className="text-base-content/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none text-base-content placeholder:text-base-content/40"
            placeholder="Search files…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {loading && <span className="loading loading-spinner loading-xs shrink-0" />}
        </div>
        <div ref={listRef} className="overflow-y-auto flex-1">
          {filtered.map((file, i) => {
            const parts = file.split('/');
            const name = parts.pop() ?? file;
            const dir = parts.join('/');
            return (
              <button
                key={file}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm ${i === selected ? 'bg-base-300 text-base-content' : 'text-base-content/80 hover:bg-base-300/50'}`}
                onClick={() => setOpenFile(file)}
                onMouseEnter={() => setSelected(i)}
              >
                <File size={12} className="shrink-0 text-base-content/40" />
                <span className="font-mono truncate min-w-0">
                  <span>{name}</span>
                  {dir && <span className="text-base-content/40 ml-1">{dir}</span>}
                </span>
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-6 text-sm text-base-content/40 text-center">No files found</div>
          )}
        </div>
      </div>
    </>
  );
}
