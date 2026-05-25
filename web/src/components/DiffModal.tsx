import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, BinaryIcon, FileWarning } from 'lucide-react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useGitStore } from '../git-store';

interface Props {
  anid: string;
  cwd: string;
  filePath: string;
  onClose: () => void;
}

function getMonacoTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
}

const HEADER_H = 40; // px — must match the h-10 header below

export default function DiffModal({ anid, cwd, filePath, onClose }: Props) {
  const fetchDiff = useGitStore(s => s.fetchDiff);
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [language, setLanguage] = useState('plaintext');
  const [isBinary, setIsBinary] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(getMonacoTheme);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    setLoading(true);
    setOldContent(null);
    setNewContent(null);
    setError(null);
    setIsBinary(false);
    setTooLarge(false);
    fetchDiff(anid, cwd, filePath)
      .then(result => {
        setIsBinary(result.isBinary);
        setTooLarge(result.tooLarge);
        setOldContent(result.oldContent);
        setNewContent(result.newContent);
        setLanguage(result.language);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [anid, cwd, filePath]);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(getMonacoTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleEditorMount: DiffOnMount = (editor) => {
    editorRef.current = editor;
  };

  const ready = !loading && !error && !isBinary && !tooLarge && oldContent !== null && newContent !== null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Full-viewport panel — bypasses DaisyUI modal-box constraints */}
      <div className="fixed inset-0 z-50 flex flex-col bg-base-100 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 border-b border-base-300 bg-base-200 shrink-0"
          style={{ height: HEADER_H }}
        >
          <span className="font-mono text-sm truncate text-base-content/80">{filePath}</span>
          <button className="btn btn-xs btn-ghost ml-2 shrink-0" onClick={onClose} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        {/* Body — explicit pixel height so Monaco height="100%" works */}
        <div className="relative flex-1 overflow-hidden" style={{ height: `calc(100vh - ${HEADER_H}px)` }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="loading loading-spinner loading-md" />
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-error">
              <AlertCircle size={16} /><span className="text-sm">{error}</span>
            </div>
          )}
          {!loading && !error && isBinary && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-base-content/50">
              <BinaryIcon size={16} /><span className="text-sm">Binary file — diff not available</span>
            </div>
          )}
          {!loading && !error && tooLarge && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-base-content/50">
              <FileWarning size={16} /><span className="text-sm">File too large to display</span>
            </div>
          )}
          {ready && (
            <DiffEditor
              height="100%"
              width="100%"
              language={language}
              original={oldContent}
              modified={newContent}
              theme={theme}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                wordWrap: 'off',
                diffWordWrap: 'off',
                renderOverviewRuler: false,
                hideUnchangedRegions: { enabled: true },
                scrollbar: { vertical: 'auto', horizontal: 'auto' },
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
