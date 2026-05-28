import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, BinaryIcon, FileWarning, Save, Check, Eye, Code, ZoomIn, ZoomOut } from 'lucide-react';
import { Editor, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { nanoid } from 'nanoid';
import { browserSocket } from '../ws';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [liveContent, setLiveContent] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [isBinary, setIsBinary] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState(getMonacoTheme);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewFontSize, setPreviewFontSize] = useState(() => {
    const saved = localStorage.getItem('md-preview-font-size');
    return saved ? parseInt(saved, 10) : 15;
  });
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const isMarkdown = filePath.toLowerCase().endsWith('.md');

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
      setLiveContent(result.content);
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

  useEffect(() => {
    if (!previewMode) setTimeout(() => editorRef.current?.layout(), 10);
  }, [previewMode]);

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
            {ready && isMarkdown && previewMode && (
              <div className="flex items-center gap-0.5">
                <button
                  className="btn btn-xs btn-ghost px-1"
                  onClick={() => setPreviewFontSize(s => { const v = Math.max(11, s - 1); localStorage.setItem('md-preview-font-size', String(v)); return v; })}
                  title="Decrease font size"
                  disabled={previewFontSize <= 11}
                ><ZoomOut size={13} /></button>
                <span className="text-xs tabular-nums w-7 text-center">{previewFontSize}px</span>
                <button
                  className="btn btn-xs btn-ghost px-1"
                  onClick={() => setPreviewFontSize(s => { const v = Math.min(24, s + 1); localStorage.setItem('md-preview-font-size', String(v)); return v; })}
                  title="Increase font size"
                  disabled={previewFontSize >= 24}
                ><ZoomIn size={13} /></button>
              </div>
            )}
            {ready && isMarkdown && (
              <button
                className="btn btn-xs btn-ghost gap-1"
                onClick={() => setPreviewMode(p => !p)}
                title={previewMode ? 'Switch to editor' : 'Preview rendered markdown'}
              >
                {previewMode ? <Code size={12} /> : <Eye size={12} />}
                {previewMode ? 'Edit' : 'Preview'}
              </button>
            )}
            {ready && !previewMode && (
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
            <>
              <div className={`absolute inset-0 ${previewMode ? 'invisible pointer-events-none' : ''}`}>
                <Editor
                  height="100%"
                  width="100%"
                  language={language}
                  value={content}
                  theme={theme}
                  onMount={handleEditorMount}
                  onChange={(value) => setLiveContent(value ?? '')}
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
              </div>
              {previewMode && (
                <div className="absolute inset-0 overflow-auto bg-white">
                  <div className="md-preview" style={{ fontSize: previewFontSize }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveContent}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
