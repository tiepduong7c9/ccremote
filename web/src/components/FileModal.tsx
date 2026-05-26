import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, BinaryIcon, FileWarning, Save, Check } from 'lucide-react';
import { Editor, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { nanoid } from 'nanoid';
import { browserSocket } from '../ws';

interface Props {
  anid: string;
  cwd: string;
  filePath: string;
  onClose: () => void;
}

function getMonacoTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
}

const HEADER_H = 40;

export default function FileModal({ anid, cwd, filePath, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState('plaintext');
  const [isBinary, setIsBinary] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState(getMonacoTheme);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    setLoading(true);
    setContent(null);
    setError(null);
    setSaveError(null);
    setSaved(false);
    const aid = nanoid();
    browserSocket.fileRead(anid, aid, cwd, filePath, (result, err) => {
      setLoading(false);
      if (err || !result) { setError(err ?? 'Unknown error'); return; }
      setIsBinary(result.isBinary);
      setTooLarge(result.tooLarge);
      setContent(result.content);
      setLanguage(result.language);
    });
  }, [anid, cwd, filePath]);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(getMonacoTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const doSave = () => {
    if (!editorRef.current) return;
    const value = editorRef.current.getValue();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const aid = nanoid();
    browserSocket.fileWrite(anid, aid, cwd, filePath, value, (err) => {
      setSaving(false);
      if (err) { setSaveError(err); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, anid, cwd, filePath]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const ready = !loading && !error && !isBinary && !tooLarge && content !== null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex flex-col bg-base-100 overflow-hidden">
        <div
          className="flex items-center justify-between px-4 border-b border-base-300 bg-base-200 shrink-0"
          style={{ height: HEADER_H }}
        >
          <span className="font-mono text-sm truncate text-base-content/80">{filePath}</span>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            {saveError && (
              <span className="text-xs text-error truncate max-w-xs" title={saveError}>{saveError}</span>
            )}
            {saved && (
              <span className="flex items-center gap-1 text-xs text-success"><Check size={12} />Saved</span>
            )}
            {ready && (
              <button
                className="btn btn-xs btn-ghost gap-1"
                onClick={doSave}
                disabled={saving}
                title="Save (Ctrl+S)"
              >
                <Save size={12} className={saving ? 'animate-pulse' : ''} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button className="btn btn-xs btn-ghost" onClick={onClose} title="Close (Esc)">
              <X size={14} />
            </button>
          </div>
        </div>

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
              <BinaryIcon size={16} /><span className="text-sm">Binary file — cannot edit</span>
            </div>
          )}
          {!loading && !error && tooLarge && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-base-content/50">
              <FileWarning size={16} /><span className="text-sm">File too large to display</span>
            </div>
          )}
          {ready && (
            <Editor
              height="100%"
              width="100%"
              language={language}
              value={content}
              theme={theme}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                wordWrap: 'off',
                scrollbar: { vertical: 'auto', horizontal: 'auto' },
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
