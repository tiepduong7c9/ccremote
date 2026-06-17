import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Square, CircleSlash, Wrench, ListTodo, ShieldQuestion, BrainCircuit, AlertTriangle, ChevronRight, ChevronDown, Zap, Check, Clock, SquarePen, Cpu, ImagePlus, X } from 'lucide-react';
import { browserSocket } from '../ws';
import { useTerminalStore } from '../store';
import { useAcpStore } from '../acp-store';
import UsageModal, { type UsageDetail } from './UsageModal';
import type { AcpCommand, AcpContentBlock, AcpConversation, AcpEvent, AcpModeState, AcpModelState, AcpPlanEntry, AcpPermissionRequest, AcpToolContent } from '../lib/protocol';

// Claude brand coral, used for the focus ring and send button (matches the
// Claude Code GUI). Kept as a literal so Tailwind's JIT emits the classes.
const CORAL = '#c96442';

function ClaudeMark({ size = 28 }: { size?: number }) {
  return (
    <svg height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path clipRule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill={CORAL} fillRule="evenodd" />
    </svg>
  );
}

interface Props {
  anid: string;
  sid: string;
  visible?: boolean;
}

type ThreadItem =
  | { kind: 'user'; id: string; text: string; images?: string[] }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | { kind: 'tool'; id: string; toolCallId: string; title: string; status: string; toolKind?: string; content: AcpToolContent[] }
  | { kind: 'plan'; id: string; entries: AcpPlanEntry[] }
  | { kind: 'permission'; id: string; requestId: string; request: AcpPermissionRequest; resolved?: string }
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'interrupted'; id: string }
  | { kind: 'error'; id: string; message: string };

// Theme-aware markdown. Colors are pinned to DaisyUI tokens (not prose's gray
// palette / dark:invert) so it renders correctly under any DaisyUI theme.
// Memoized: re-parsing markdown to an AST is expensive, and with a long thread
// the parent re-renders on every keystroke in the composer. memo keeps each
// rendered message stable so typing doesn't re-parse the entire history.
const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words leading-relaxed
      text-base-content
      prose-headings:text-base-content prose-p:text-base-content prose-li:text-base-content
      prose-strong:text-base-content prose-em:text-base-content prose-blockquote:text-base-content/70
      prose-a:text-primary prose-hr:border-base-300
      prose-code:text-base-content prose-code:bg-base-content/10 prose-code:border prose-code:border-base-content/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:text-[0.85em] prose-code:before:content-[''] prose-code:after:content-['']
      prose-pre:bg-base-300 prose-pre:text-base-content prose-pre:text-xs prose-pre:my-2
      [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-inherit">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
});

function textOf(c: AcpContentBlock | undefined): string {
  if (!c) return '';
  if (typeof (c as { text?: unknown }).text === 'string') return (c as { text: string }).text;
  return '';
}

// Pull data-URL previews out of any ACP image blocks ({ type: 'image', data, mimeType }).
function imagesOf(blocks: AcpContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const block = b as { type?: string; data?: unknown; mimeType?: unknown };
    if (block.type === 'image' && typeof block.data === 'string') {
      const mime = typeof block.mimeType === 'string' ? block.mimeType : 'image/png';
      out.push(`data:${mime};base64,${block.data}`);
    }
  }
  return out;
}

function buildThread(events: AcpEvent[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const toolIndex = new Map<string, number>();
  let planIndex = -1;

  events.forEach((e, i) => {
    if (e.type === 'acp_user') {
      items.push({ kind: 'user', id: `u${i}`, text: e.blocks.map(textOf).join(''), images: imagesOf(e.blocks) });
    } else if (e.type === 'acp_update') {
      const u = e.update;
      const su = u.sessionUpdate;
      if (su === 'agent_message_chunk') {
        const last = items[items.length - 1];
        if (last && last.kind === 'assistant') last.text += textOf((u as { content: AcpContentBlock }).content);
        else items.push({ kind: 'assistant', id: `a${i}`, text: textOf((u as { content: AcpContentBlock }).content) });
      } else if (su === 'agent_thought_chunk') {
        const last = items[items.length - 1];
        if (last && last.kind === 'thought') last.text += textOf((u as { content: AcpContentBlock }).content);
        else items.push({ kind: 'thought', id: `t${i}`, text: textOf((u as { content: AcpContentBlock }).content) });
      } else if (su === 'user_message_chunk') {
        const last = items[items.length - 1];
        if (last && last.kind === 'user') last.text += textOf((u as { content: AcpContentBlock }).content);
        else items.push({ kind: 'user', id: `uc${i}`, text: textOf((u as { content: AcpContentBlock }).content) });
      } else if (su === 'tool_call') {
        const tu = u as { toolCallId: string; title?: string; kind?: string; status?: string; content?: AcpToolContent[] };
        toolIndex.set(tu.toolCallId, items.length);
        items.push({ kind: 'tool', id: `tool${i}`, toolCallId: tu.toolCallId, title: tu.title || 'Tool', status: tu.status || 'pending', toolKind: tu.kind, content: tu.content || [] });
      } else if (su === 'tool_call_update') {
        const tu = u as { toolCallId: string; title?: string; status?: string; content?: AcpToolContent[] };
        const idx = toolIndex.get(tu.toolCallId);
        if (idx != null) {
          const it = items[idx] as Extract<ThreadItem, { kind: 'tool' }>;
          if (tu.status) it.status = tu.status;
          if (tu.title) it.title = tu.title;
          if (tu.content && tu.content.length) it.content = tu.content;
        } else {
          toolIndex.set(tu.toolCallId, items.length);
          items.push({ kind: 'tool', id: `tool${i}`, toolCallId: tu.toolCallId, title: tu.title || 'Tool', status: tu.status || 'pending', content: tu.content || [] });
        }
      } else if (su === 'plan') {
        const pu = u as { entries: AcpPlanEntry[] };
        if (planIndex >= 0) (items[planIndex] as Extract<ThreadItem, { kind: 'plan' }>).entries = pu.entries;
        else { planIndex = items.length; items.push({ kind: 'plan', id: `plan${i}`, entries: pu.entries }); }
      }
    } else if (e.type === 'acp_permission') {
      items.push({ kind: 'permission', id: `perm${i}`, requestId: e.requestId, request: e.request, resolved: e.resolved });
    } else if (e.type === 'acp_stop') {
      if (e.stopReason && /cancel/i.test(e.stopReason)) items.push({ kind: 'interrupted', id: `stop${i}` });
    } else if (e.type === 'acp_notice') {
      items.push({ kind: 'notice', id: `notice${i}`, text: e.text });
    } else if (e.type === 'acp_error') {
      items.push({ kind: 'error', id: `err${i}`, message: e.message });
    }
  });
  return items;
}

function ToolContentView({ content }: { content: AcpToolContent[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {content.map((c, i) => {
        if (c.type === 'diff') {
          return (
            <div key={i} className="rounded bg-base-300/50 overflow-hidden">
              {c.path && <div className="px-2 py-1 text-[11px] font-mono text-base-content/60 border-b border-base-300">{c.path}</div>}
              <pre className="text-[11px] font-mono p-2 overflow-x-auto whitespace-pre-wrap break-words">{c.newText ?? ''}</pre>
            </div>
          );
        }
        const t = textOf(c.content);
        if (!t) return null;
        return (
          <pre key={i} className="text-[11px] font-mono bg-base-300/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{t}</pre>
        );
      })}
    </div>
  );
}

function ModeSelector({ modeState, onSelect }: { modeState: AcpModeState | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  if (!modeState) return null;
  const current = modeState.availableModes.find(m => m.id === modeState.currentModeId);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-base-content/70 hover:text-base-content px-2 py-1 rounded-lg hover:bg-base-200 transition-colors"
        onClick={() => setOpen(o => !o)}
        title="Change permission mode (Shift+Tab to cycle)"
      >
        <Zap size={13} style={{ color: CORAL }} />
        <span className="font-medium">{current?.name ?? modeState.currentModeId}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-hidden z-50 py-1">
          {modeState.availableModes.map(m => {
            const active = m.id === modeState.currentModeId;
            return (
              <button
                key={m.id}
                type="button"
                className={`w-full text-left px-3 py-2 transition-colors ${active ? 'bg-base-200' : 'hover:bg-base-200'}`}
                onClick={() => { if (!active) onSelect(m.id); setOpen(false); }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  {active && <Check size={13} style={{ color: CORAL }} className="ml-auto shrink-0" />}
                </div>
                {m.description && <div className="text-[11px] text-base-content/50 mt-0.5 leading-snug">{m.description}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModelSelector({ modelState, pendingModelId, onSelect }: { modelState: AcpModelState; pendingModelId?: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  // While a switch is in flight show the target model + spinner; once the
  // agentnode confirms (pendingModelId cleared) fall back to the live value.
  const switching = pendingModelId != null && pendingModelId !== modelState.currentModelId;
  const shownId = switching ? pendingModelId : modelState.currentModelId;
  const shown = modelState.availableModels.find(m => m.id === shownId);
  const label = shown?.name ?? modelLabel(shownId) ?? shownId;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] text-base-content/60 hover:text-base-content px-1.5 py-1 rounded-lg hover:bg-base-200 transition-colors whitespace-nowrap"
        onClick={() => setOpen(o => !o)}
        title="Change model"
      >
        {switching
          ? <span className="loading loading-spinner loading-xs" style={{ color: CORAL, width: 12, height: 12 }} />
          : <Cpu size={12} className="text-base-content/50" />}
        <span>{switching ? `Switching to ${label}…` : label}</span>
        {!switching && <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-hidden z-50 py-1">
          {modelState.availableModels.map(m => {
            const active = m.id === modelState.currentModelId;
            const isPending = pendingModelId === m.id && switching;
            return (
              <button
                key={m.id}
                type="button"
                className={`w-full text-left px-3 py-2 transition-colors ${active ? 'bg-base-200' : 'hover:bg-base-200'}`}
                onClick={() => { if (!active) onSelect(m.id); setOpen(false); }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  {active && <Check size={13} style={{ color: CORAL }} className="ml-auto shrink-0" />}
                  {isPending && <span className="loading loading-spinner loading-xs ml-auto shrink-0" style={{ color: CORAL }} />}
                </div>
                {m.description && <div className="text-[11px] text-base-content/50 mt-0.5 leading-snug">{m.description}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToolCard({ item }: { item: Extract<ThreadItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const statusColor = item.status === 'completed' ? 'text-success'
    : item.status === 'failed' || item.status === 'cancelled' ? 'text-error'
    : 'text-warning';
  const hasContent = item.content.some(c => c.type === 'diff' || textOf(c.content));
  return (
    <div className="rounded-md bg-base-200/40 font-mono text-xs">
      <button
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left focus:outline-none rounded-md hover:bg-base-200/70 transition-colors"
        onClick={() => hasContent && setOpen(o => !o)}
      >
        {hasContent
          ? <ChevronRight size={12} className={`shrink-0 text-base-content/30 transition-transform ${open ? 'rotate-90' : ''}`} />
          : <span className="shrink-0 w-3" />}
        <Wrench size={12} className="shrink-0 text-base-content/40" />
        <span className="truncate flex-1 text-base-content/70">{item.title}</span>
        <span className={`text-[10px] ${statusColor} opacity-70`}>{item.status}</span>
      </button>
      {open && hasContent && <div className="px-2.5 pb-2"><ToolContentView content={item.content} /></div>}
    </div>
  );
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

// Heading bar across the top of the chat panel. Shows the session name and a
// short recap (the conversation's opening prompt) on the left, and the chat
// controls on the right (like the Claude Code GUI): a "resume conversation"
// picker (like `claude --resume`) and a "new conversation" button. Both act on
// the underlying Claude conversation within this same ccremote session.
function ChatHeader({ anid, sid, aid, recap, onResume }: { anid: string; sid: string; aid: string; recap: string | null; onResume: () => void }) {
  const currentConvId = useAcpStore(s => s.threads.get(sid)?.acpSessionId ?? null);
  // Claude generates the AI title asynchronously after a turn finishes, so
  // refetch on every status change (turn boundary) to pick it up once written.
  const claudeStatus = useAcpStore(s => s.threads.get(sid)?.claudeStatus);
  const [open, setOpen] = useState(false);
  const [convs, setConvs] = useState<AcpConversation[] | null>(null);
  // Claude's own AI-generated title for the active conversation (the same one
  // its TUI / VS Code pickers show). Falls back to the local recap until it's
  // available.
  const [title, setTitle] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Clear the stale title immediately when the conversation switches (new/resume).
  useEffect(() => { setTitle(null); }, [currentConvId]);

  useEffect(() => {
    if (!currentConvId) return;
    let cancelled = false;
    browserSocket.acpListConversations(anid, aid, (list) => {
      if (cancelled) return;
      const t = list.find(c => c.sessionId === currentConvId)?.title ?? null;
      if (t) setTitle(t);
    });
    return () => { cancelled = true; };
  }, [anid, aid, currentConvId, claudeStatus]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setConvs(null); browserSocket.acpListConversations(anid, aid, setConvs); }
  };

  return (
    <div className="shrink-0 z-20 flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-base-content truncate leading-tight">{title || recap || 'New conversation'}</div>
      </div>
      <div ref={ref} className="relative flex items-center gap-0.5 shrink-0">
        <button className="btn btn-ghost btn-sm btn-square" title="Resume a conversation" onClick={toggle}>
          <Clock size={16} />
        </button>
        <button
          className="btn btn-ghost btn-sm btn-square"
          title="New conversation"
          onClick={() => browserSocket.acpNewConversation(anid, aid)}
        >
          <SquarePen size={16} />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-base-100 border border-base-300 rounded-xl shadow-lg z-50 py-1">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-base-content/40 font-semibold">Resume conversation</div>
            {convs === null && <div className="px-3 py-4 flex justify-center"><span className="loading loading-spinner loading-sm" /></div>}
            {convs && convs.length === 0 && <div className="px-3 py-3 text-sm text-base-content/40">No past conversations</div>}
            {convs && convs.map(c => {
              const active = c.sessionId === currentConvId;
              return (
                <button
                  key={c.sessionId}
                  className={`w-full text-left px-3 py-2 transition-colors ${active ? 'bg-base-200' : 'hover:bg-base-200'}`}
                  onClick={() => { if (!active) { onResume(); browserSocket.acpResumeConversation(anid, aid, c.sessionId); } setOpen(false); }}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1 text-sm">{c.title || 'Untitled conversation'}</span>
                    {active && <Check size={13} style={{ color: CORAL }} className="shrink-0" />}
                  </div>
                  <div className="text-[11px] text-base-content/40">{relTime(c.mtime)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function modelLabel(id?: string | null): string | null {
  if (!id) return null;
  const lower = id.toLowerCase();
  const fam = lower.includes('opus') ? 'Opus' : lower.includes('sonnet') ? 'Sonnet' : lower.includes('haiku') ? 'Haiku' : null;
  if (!fam) return id;
  const ver = id.match(/(\d+)-(\d+)/);
  return ver ? `${fam} ${ver[1]}.${ver[2]}` : fam;
}

// Per-session scroll offset, kept outside the component so it survives the
// unmount/remount that happens when switching between session cards.
const scrollMemory = new Map<string, number>();

// Most-recently-used slash commands, newest first, persisted across reloads so
// the palette surfaces what you actually reach for instead of alphabetical order.
const RECENT_CMDS_KEY = 'ccremote.recentCommands';
const RECENT_CMDS_MAX = 20;
function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CMDS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function recordRecentCommand(name: string) {
  const next = [name, ...loadRecentCommands().filter(n => n !== name)].slice(0, RECENT_CMDS_MAX);
  try { localStorage.setItem(RECENT_CMDS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

// Unsent composer drafts, keyed by session id. AcpThread unmounts when you
// switch to another session, so its local draft state would be lost; this
// module-level map preserves the in-progress prompt across that remount.
const draftBySid = new Map<string, string>();

// The thread message list, split out and memoized so that composer keystrokes
// (which re-render AcpThread to track the draft) don't re-render — and re-parse
// the markdown of — every message in a long history. It re-renders only when
// `items`, `working`, or the permission handler actually change.
const MessageList = memo(function MessageList({
  items,
  working,
  onAnswerPermission,
}: {
  items: ThreadItem[];
  working: boolean;
  onAnswerPermission: (requestId: string, optionId: string | null) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
        <ClaudeMark size={30} />
        <div className="text-lg font-medium text-base-content/80">You've come to the absolutely right place!</div>
        <div className="text-sm text-base-content/45 max-w-sm">
          Ask Claude to edit, run, or explain anything in this repo. Tool calls and
          permission requests appear inline.
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
      {items.map(item => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-base-200 border border-base-300 px-3.5 py-2 text-sm break-words">
                {item.images && item.images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {item.images.map((src, k) => (
                      <img key={k} src={src} alt="attachment" className="max-h-40 rounded-lg border border-base-300" />
                    ))}
                  </div>
                )}
                {item.text && <span className="whitespace-pre-wrap">{item.text}</span>}
              </div>
            );
          case 'assistant':
            return (
              <div key={item.id} className="self-start w-full text-sm text-justify">
                <Markdown>{item.text}</Markdown>
              </div>
            );
          case 'thought':
            return (
              <div key={item.id} className="self-start max-w-[85%] flex items-start gap-1.5 text-xs text-base-content/50 italic whitespace-pre-wrap break-words">
                <BrainCircuit size={13} className="shrink-0 mt-0.5" />
                <span>{item.text}</span>
              </div>
            );
          case 'tool':
            return <div key={item.id} className="self-start w-[85%]"><ToolCard item={item} /></div>;
          case 'plan':
            return (
              <div key={item.id} className="self-start w-[85%] rounded-lg border border-base-300 bg-base-100 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-base-content/70 mb-2"><ListTodo size={14} /> Plan</div>
                <ul className="flex flex-col gap-1">
                  {item.entries.map((en, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 shrink-0 ${en.status === 'completed' ? 'text-success' : en.status === 'in_progress' ? 'text-warning' : 'text-base-content/30'}`}>
                        {en.status === 'completed' ? '✓' : '○'}
                      </span>
                      <span className={en.status === 'completed' ? 'line-through text-base-content/40' : ''}>{en.content}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          case 'permission':
            return (
              <div key={item.id} className="self-start w-[85%] rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-warning mb-2">
                  <ShieldQuestion size={15} /> Permission required
                </div>
                {item.request.toolCall?.title && (
                  <div className="text-xs text-base-content/60 mb-2 font-mono break-words">{item.request.toolCall.title}</div>
                )}
                {item.resolved ? (
                  <div className="text-xs text-base-content/50">
                    {item.resolved === '__cancelled__'
                      ? 'Cancelled'
                      : `Answered: ${item.request.options.find(o => o.optionId === item.resolved)?.name ?? item.resolved}`}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {item.request.options.map(opt => {
                      const isReject = opt.kind === 'reject_once' || opt.kind === 'reject_always';
                      const isAllow = opt.kind === 'allow_always' || opt.kind === 'allow_once';
                      return (
                        <button
                          key={opt.optionId}
                          className={`btn btn-xs ${isAllow ? 'btn-primary' : isReject ? 'btn-ghost text-error' : 'btn-ghost'}`}
                          onClick={() => onAnswerPermission(item.requestId, opt.optionId)}
                        >
                          {opt.name}
                        </button>
                      );
                    })}
                    {/* Fallback reject only when the agent didn't offer one; sends null to cancel. */}
                    {!item.request.options.some(o => o.kind === 'reject_once' || o.kind === 'reject_always') && (
                      <button className="btn btn-xs btn-ghost text-error" onClick={() => onAnswerPermission(item.requestId, null)}>
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          case 'notice':
            return (
              <div key={item.id} className="self-center flex items-center gap-1.5 text-[11px] text-base-content/45 my-0.5">
                <Cpu size={12} className="shrink-0" />
                <span>{item.text}</span>
              </div>
            );
          case 'interrupted':
            return (
              <div key={item.id} className="self-center flex items-center gap-1.5 text-[11px] my-0.5" style={{ color: CORAL }}>
                <CircleSlash size={11} className="shrink-0" />
                <span>Interrupted by user</span>
              </div>
            );
          case 'error':
            return (
              <div key={item.id} className="self-start w-[85%] alert alert-error py-2 text-xs">
                <AlertTriangle size={14} />
                <span className="break-words">{item.message}</span>
              </div>
            );
        }
      })}
      {working && (
        <div className="self-start flex items-center gap-2 text-xs text-base-content/40">
          <span className="loading loading-dots loading-sm" /> working…
        </div>
      )}
    </div>
  );
});

export default function AcpThread({ anid, sid, visible = true }: Props) {
  const aidRef = useRef<string>(nanoid(8));
  const setAttachment = useTerminalStore(s => s.setAttachment);
  const removeAttachment = useTerminalStore(s => s.removeAttachment);
  const thread = useAcpStore(s => s.threads.get(sid));
  const resolvePermissionLocal = useAcpStore(s => s.resolvePermissionLocal);
  const setModeLocal = useAcpStore(s => s.setModeLocal);
  const setModelLocal = useAcpStore(s => s.setModelLocal);
  const clearPendingModel = useAcpStore(s => s.clearPendingModel);
  const [draft, setDraft] = useState(() => draftBySid.get(sid) ?? '');
  const [focused, setFocused] = useState(false);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState(false);
  const [recentCmds, setRecentCmds] = useState<string[]>(loadRecentCommands);
  // Shell-style prompt history recall (ArrowUp/ArrowDown). -1 = not navigating;
  // the unsent draft is stashed so ArrowDown past the newest restores it.
  const [histIndex, setHistIndex] = useState(-1);
  const histStashRef = useRef('');
  const [showUsage, setShowUsage] = useState(false);
  const [usageDetail, setUsageDetail] = useState<UsageDetail | null>(null);
  // Pending image attachments: base64 data (no data: prefix) + mime, sent as
  // ACP image content blocks alongside the text on the next send.
  const [images, setImages] = useState<{ id: string; mimeType: string; data: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preserve the unsent draft across session switches (this component unmounts
  // when another session is selected). Cleared by send()/newConversation()
  // setting draft to ''.
  useEffect(() => {
    if (draft) draftBySid.set(sid, draft);
    else draftBySid.delete(sid);
  }, [sid, draft]);

  const addImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const data = dataUrl.split(',')[1];
      if (!data) return;
      setImages(prev => [...prev, { id: nanoid(6), mimeType: file.type || 'image/png', data }]);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (id: string) => setImages(prev => prev.filter(im => im.id !== id));

  const openUsage = () => {
    setUsageDetail(null);
    setShowUsage(true);
    browserSocket.acpUsageDetail(anid, aidRef.current, setUsageDetail);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Slash-command palette: active only while the draft is a bare "/word" token.
  // Inject the local-only commands that mirror the header button, skipping any
  // the agent already advertises so we don't show duplicates.
  const commands = useMemo(() => {
    const backend = thread?.availableCommands ?? [];
    const have = new Set(backend.map(c => c.name));
    const local: AcpCommand[] = [
      { name: 'clear', description: 'Start a new conversation', input: null },
      { name: 'new', description: 'Start a new conversation', input: null },
    ].filter(c => !have.has(c.name));
    return [...backend, ...local];
  }, [thread?.availableCommands]);
  const slashQuery = /^\/([^\s]*)$/.exec(draft)?.[1];
  const cmdMatches = useMemo(() => {
    if (slashQuery === undefined) return [];
    const q = slashQuery.toLowerCase();
    // Recently-used commands float to the top (newest first); everything else
    // keeps the order the agent advertised them in.
    const rank = (name: string) => {
      const i = recentCmds.indexOf(name);
      return i === -1 ? Infinity : i;
    };
    return commands
      .filter(c => c.name.toLowerCase().startsWith(q))
      .sort((a, b) => rank(a.name) - rank(b.name))
      .slice(0, 8);
  }, [slashQuery, commands, recentCmds]);
  const showPalette = cmdMatches.length > 0 && !cmdDismissed;

  // Grow the textarea with its content (up to a cap), like the Claude Code GUI.
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    const aid = aidRef.current;
    setAttachment(aid, { anid, sid, session: null, status: 'attaching' });
    browserSocket.attach(anid, aid, sid);
    return () => {
      browserSocket.detach(anid, aid);
      removeAttachment(aid);
    };
  }, [anid, sid, setAttachment, removeAttachment]);

  const items = useMemo(() => buildThread(thread?.events ?? []), [thread?.events]);
  // Short recap shown in the heading bar: the conversation's opening prompt,
  // collapsed to a single line. Gives a glanceable "what is this about". Mirrors
  // the agentnode's title derivation — skip synthetic context blocks the harness
  // injects (<ide_opened_file>, <command-message>, …) and use the first real
  // human text block, so the heading agrees with the resume picker's titles.
  const recap = useMemo(() => {
    const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
    for (const e of thread?.events ?? []) {
      if (e.type !== 'acp_user') continue;
      for (const b of e.blocks) {
        const t = (b as { text?: unknown }).text;
        if (typeof t === 'string' && t.trim() && !t.trim().startsWith('<')) return clean(t);
      }
    }
    // Fallback for resumed history that arrives as user_message_chunk items.
    const firstUser = items.find((it): it is Extract<ThreadItem, { kind: 'user' }> => it.kind === 'user');
    const t = firstUser?.text.trim();
    return t && !t.startsWith('<') ? clean(t) : null;
  }, [thread?.events, items]);
  // Oldest→newest list of previously sent prompt texts, for ArrowUp/ArrowDown recall.
  const promptHistory = useMemo(() => {
    const out: string[] = [];
    for (const e of thread?.events ?? []) {
      if (e.type === 'acp_user') {
        const t = e.blocks.map(textOf).join('').trim();
        if (t) out.push(t);
      }
    }
    return out;
  }, [thread?.events]);
  const working = thread?.claudeStatus === 'working';
  const waiting = thread?.claudeStatus === 'waiting';
  const model = modelLabel(thread?.model);
  const modelState = thread?.modelState ?? null;
  const pendingModelId = thread?.pendingModelId ?? null;
  const modelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (modelTimerRef.current) clearTimeout(modelTimerRef.current); }, []);

  const selectModel = (id: string) => {
    browserSocket.acpSetModel(anid, aidRef.current, id);
    setModelLocal(sid, id);
    // Fallback so the selector never spins forever if no confirmation arrives.
    if (modelTimerRef.current) clearTimeout(modelTimerRef.current);
    modelTimerRef.current = setTimeout(() => clearPendingModel(sid), 12000);
  };

  // Context-window usage % from the latest usage_update.
  const contextPct = useMemo(() => {
    const evs = thread?.events ?? [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      if (e.type === 'acp_update' && (e.update as { sessionUpdate?: string }).sessionUpdate === 'usage_update') {
        const u = e.update as unknown as { used?: number; size?: number };
        if (u.size) return Math.round(((u.used ?? 0) / u.size) * 100);
      }
    }
    return null;
  }, [thread?.events]);

  // Auto-scroll only when the user is parked at the bottom. If they've
  // scrolled up to read history, new content won't yank them down. The
  // offset is remembered per session (see scrollMemory) so switching away
  // to another session card and back restores exactly where they left off.
  const prevLenRef = useRef(0);
  const stickRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    scrollMemory.set(sid, el.scrollTop);
  };
  // On mount, restore the saved offset (or jump to the bottom on first visit).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollMemory.get(sid);
    el.scrollTop = saved ?? el.scrollHeight;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    prevLenRef.current = items.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stick to the bottom while the user is parked there. Pin in a layout
  // effect (synchronously, before the browser paints) so the view is already
  // at the bottom on the first frame — no visible scroll. Content can arrive
  // over many frames (streaming replies, a resumed conversation's history);
  // each one re-pins before paint, so it never jitters or animates.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) { prevLenRef.current = items.length; return; }
    el.scrollTop = el.scrollHeight;
    scrollMemory.set(sid, el.scrollTop);
    prevLenRef.current = items.length;
  }, [items.length, working, sid]);

  // Follow the bottom as content *grows in place*. A streaming reply appends to
  // the same assistant item (see buildThread), so items.length never changes and
  // the effect above can't fire — and late layout (markdown, code blocks, images)
  // grows the content after any render. Watch the content's actual size and
  // re-pin on every growth while the user is parked at the bottom, so the view
  // tracks the reply as it streams; the moment they scroll up, stickRef goes
  // false and we leave them where they are.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (!stickRef.current) return;
      el.scrollTop = el.scrollHeight;
      scrollMemory.set(sid, el.scrollTop);
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [sid]);

  // Resuming a conversation from the history menu swaps the thread's contents
  // in place (same sid, no remount) via a single setHistory. Re-arm stick so
  // the layout effect above pins the new content to the bottom before paint,
  // even if the user had scrolled up in the previous conversation.
  const convId = thread?.acpSessionId ?? null;
  const prevConvRef = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (prevConvRef.current === undefined) { prevConvRef.current = convId; return; }
    if (prevConvRef.current === convId) return;
    prevConvRef.current = convId;
    stickRef.current = true;
    scrollMemory.delete(sid);
    const el = scrollRef.current;
    if (el) { el.scrollTop = el.scrollHeight; prevLenRef.current = items.length; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, sid]);

  // While a resumed/loaded conversation's content settles, cover the thread with
  // a loading overlay so the user never sees it grow or re-pin. The tricky part
  // is that the layout keeps changing *after* the items are in the DOM: markdown
  // highlights, code blocks lay out, and <img> attachments finish loading — each
  // grows scrollHeight asynchronously, well after any fixed timer would expire.
  // So instead of a fixed delay we watch the content's actual size with a
  // ResizeObserver: re-pin to the bottom on every change and only lift the
  // overlay once the size has held steady for a short beat (with a hard cap so
  // it can never get stuck).
  const [resuming, setResuming] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginResume = () => {
    stickRef.current = true;
    scrollMemory.delete(sid);
    setResuming(true);
  };
  useEffect(() => {
    if (!resuming) return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) { setResuming(false); return; }
    // After an agentnode restart, attaching resumes the conversation and the
    // history replays as a stream of acp_event frames *after* an empty initial
    // snapshot (historyLoading). In that case there may be a multi-second gap
    // before the first message lands, so we must not start the settle countdown
    // on the still-empty thread — it would lift the overlay right before the
    // history streams in and scrolls.
    const loading = thread?.historyLoading ?? false;
    // Cap only guards the window *before* the first message arrives — e.g. an
    // empty or failed resume that never streams anything. A large conversation
    // can take far longer than this to replay, so once content starts arriving
    // the cap is cleared and only the quiet-for-a-beat settle below lifts the
    // overlay — otherwise the cap would fire mid-stream and expose the scroll.
    let cap: ReturnType<typeof setTimeout> | null = setTimeout(() => setResuming(false), 12000);
    const arm = () => {
      if (stickRef.current) {
        el.scrollTop = el.scrollHeight;
        scrollMemory.set(sid, el.scrollTop);
      }
      const hasContent = !!content.querySelector('[class*="self-"]');
      if (loading && !hasContent) return; // resume in flight, no messages yet — hold (cap still armed)
      if (cap) { clearTimeout(cap); cap = null; }
      if (settleTimer.current) clearTimeout(settleTimer.current);
      // Quiet for ~300ms (tolerant of inter-chunk gaps on slow/remote streams)
      // → the thread has stopped growing, lift the overlay.
      settleTimer.current = setTimeout(() => setResuming(false), 300);
    };
    const ro = new ResizeObserver(arm);
    ro.observe(content); // fires once immediately with the current size
    return () => {
      ro.disconnect();
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (cap) clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, sid]);

  // Cover the thread with the loading overlay whenever a history snapshot
  // (re)loads — keyed off historyEpoch, which the store bumps on every
  // setHistory: the first attach AND every re-attach (e.g. after an agentnode
  // restart, including when you switch away and back to a session). A plain
  // tab switch with no re-attach doesn't bump the epoch, so an already-loaded
  // session keeps its restored scroll and gets no overlay.
  //
  // - First load into this panel (epoch goes undefined -> N): cover if there's
  //   content to settle or a resume is still streaming in.
  // - A later re-attach (epoch bumps again): only cover when the snapshot is a
  //   resume that will re-stream (historyLoading) — a full one-shot snapshot
  //   replaces content without the incremental scroll and should keep position.
  const prevEpochRef = useRef(thread?.historyEpoch);
  useLayoutEffect(() => {
    const epoch = thread?.historyEpoch;
    if (epoch === undefined) return;            // no snapshot received yet
    const firstForPanel = prevEpochRef.current === undefined;
    if (prevEpochRef.current === epoch) return; // not a new snapshot (e.g. tab switch)
    prevEpochRef.current = epoch;
    if (firstForPanel) {
      if (items.length > 0 || thread?.historyLoading) beginResume();
    } else if (thread?.historyLoading) {
      beginResume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.historyEpoch, items.length]);

  useEffect(() => {
    if (visible) taRef.current?.focus();
  }, [visible]);

  useEffect(() => { setCmdIndex(0); }, [slashQuery]);

  // /clear and /new mirror the "New conversation" button in the header.
  const newConversation = () => {
    browserSocket.acpNewConversation(anid, aidRef.current);
    setDraft('');
    setImages([]);
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.focus(); } });
  };

  const send = () => {
    const text = draft.trim();
    if (!text && images.length === 0) return;
    // /usage has no chat output over ACP — show the rich popup instead.
    if (text === '/usage' && images.length === 0) { openUsage(); setDraft(''); return; }
    // /clear and /new start a fresh conversation, just like the header button.
    if ((text === '/clear' || text === '/new') && images.length === 0) { newConversation(); return; }
    const blocks: AcpContentBlock[] = [];
    if (text) blocks.push({ type: 'text', text });
    for (const im of images) blocks.push({ type: 'image', data: im.data, mimeType: im.mimeType });
    browserSocket.acpPrompt(anid, aidRef.current, blocks);
    setDraft('');
    setImages([]);
    // Submitting a prompt always returns the view to the bottom.
    stickRef.current = true;
    setHistIndex(-1);
  };

  // Walk the sent-prompt history. dir = -1 goes to older entries, +1 to newer;
  // stepping newer past the most recent restores the stashed in-progress draft.
  const recallHistory = (dir: -1 | 1) => {
    if (promptHistory.length === 0) return;
    let next: number;
    if (histIndex === -1) {
      if (dir === 1) return; // nothing newer than the live draft
      histStashRef.current = draft;
      next = promptHistory.length - 1;
    } else {
      next = histIndex + (dir === -1 ? -1 : 1);
    }
    if (next < 0) next = 0;
    if (next >= promptHistory.length) {
      // Past the newest entry → back to the stashed draft.
      setHistIndex(-1);
      setDraft(histStashRef.current);
      moveCaretToEnd();
      return;
    }
    setHistIndex(next);
    setDraft(promptHistory[next]);
    moveCaretToEnd();
  };

  // setDraft is async (controlled textarea); defer caret + autosize a tick.
  const moveCaretToEnd = () => {
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.selectionStart = el.selectionEnd = el.value.length;
      autoGrow(el);
    }, 0);
  };

  // runIfNoArgs=false (Tab) always completes "/name " into the box so the user can
  // type arguments; runIfNoArgs=true (Enter) runs commands that take no arguments.
  const acceptCommand = (cmd: AcpCommand, runIfNoArgs = true) => {
    setCmdDismissed(true);
    recordRecentCommand(cmd.name);
    setRecentCmds(loadRecentCommands());
    if (runIfNoArgs && cmd.name === 'usage') { openUsage(); setDraft(''); return; }
    if (runIfNoArgs && (cmd.name === 'clear' || cmd.name === 'new')) { newConversation(); return; }
    if (!runIfNoArgs || cmd.input?.hint) {
      // Drop "/name " in the box so the user can type arguments before sending.
      setDraft(`/${cmd.name} `);
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); autoGrow(el); } });
    } else {
      // No arguments — run it right away.
      browserSocket.acpPrompt(anid, aidRef.current, [{ type: 'text', text: `/${cmd.name}` }]);
      setDraft('');
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.focus(); } });
    }
  };

  // Stable identity so the memoized MessageList isn't re-rendered every keystroke.
  const answerPermission = useCallback((requestId: string, optionId: string | null) => {
    browserSocket.acpPermissionResponse(anid, aidRef.current, requestId, optionId);
    resolvePermissionLocal(sid, requestId, optionId);
  }, [anid, sid, resolvePermissionLocal]);

  // Shift+Tab cycles the permission mode (mirrors the Claude Code TUI).
  const cycleMode = () => {
    const ms = thread?.modeState;
    if (!ms || !ms.availableModes.length) return;
    const idx = ms.availableModes.findIndex(m => m.id === ms.currentModeId);
    const next = ms.availableModes[(idx + 1) % ms.availableModes.length];
    browserSocket.acpSetMode(anid, aidRef.current, next.id);
    setModeLocal(sid, next.id);
  };

  return (
    <div
      className="relative w-full h-full flex flex-col bg-base-100 outline-none"
      tabIndex={-1}
      onKeyDown={(e) => {
        // Shift+Tab cycles the permission mode anywhere the panel has focus.
        if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); }
      }}
      style={visible ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
    >
      <ChatHeader anid={anid} sid={sid} aid={aidRef.current} recap={recap} onResume={beginResume} />

      {/* Thread */}
      <div className="relative flex-1 overflow-hidden">
      {/* overflow-anchor:none — when a large message block lays out in one jump
          the browser's scroll anchoring would otherwise reposition scrollTop to
          keep older content in view, firing a scroll event that flips stickRef
          false and strands the user mid-thread. Disabling it keeps growth pinned
          to the bottom (the ResizeObserver below does the following). */}
      <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto [overflow-anchor:none]">
        <div ref={contentRef} className="min-h-full flex flex-col">
          <MessageList items={items} working={working} onAnswerPermission={answerPermission} />
        </div>
      </div>
      {resuming && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100">
          {/* transform-based spinner: animates on the compositor so it stays
              smooth even while the main thread mounts the resumed thread. */}
          <span className="h-7 w-7 rounded-full border-2 border-base-content/15 border-t-base-content/50 animate-spin" />
        </div>
      )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4 pt-2 bg-base-100">
        <div className="max-w-3xl mx-auto w-full">
          {waiting && (
            <div className="text-[11px] mb-2 flex items-center gap-1" style={{ color: CORAL }}>
              <ShieldQuestion size={12} /> Claude is waiting for your permission above.
            </div>
          )}
          <div
            className="relative rounded-2xl border border-base-300 bg-base-100 transition-shadow"
            style={focused ? { borderColor: CORAL, boxShadow: `0 0 0 3px ${CORAL}22` } : undefined}
          >
            {showPalette && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-hidden py-1 max-h-72 overflow-y-auto z-30">
                <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-base-content/40 font-semibold">Commands</div>
                {cmdMatches.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    className={`w-full text-left px-3 py-1.5 transition-colors ${i === cmdIndex ? 'bg-base-200' : 'hover:bg-base-200'}`}
                    onMouseDown={e => { e.preventDefault(); acceptCommand(c); }}
                    onMouseEnter={() => setCmdIndex(i)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium" style={{ color: CORAL }}>/{c.name}</span>
                      <span className="text-xs text-base-content/50 truncate">{c.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {images.map(im => (
                  <div key={im.id} className="relative group">
                    <img
                      src={`data:${im.mimeType};base64,${im.data}`}
                      alt="attachment"
                      className="h-16 w-16 object-cover rounded-lg border border-base-300"
                    />
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-base-300 hover:bg-error hover:text-white flex items-center justify-center shadow"
                      title="Remove"
                      onClick={() => removeImage(im.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => {
                Array.from(e.target.files ?? []).forEach(addImageFile);
                e.target.value = '';
              }}
            />
            <textarea
              ref={taRef}
              className="w-full bg-transparent resize-none outline-none text-sm px-4 pt-3 pb-1.5 leading-relaxed"
              rows={1}
              style={{ minHeight: '2.75rem', maxHeight: '200px' }}
              value={draft}
              placeholder="Reply to Claude…"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={e => { setDraft(e.target.value); setCmdDismissed(false); setHistIndex(-1); autoGrow(e.target); }}
              onPaste={e => {
                const files = Array.from(e.clipboardData.items)
                  .filter(it => it.type.startsWith('image/'))
                  .map(it => it.getAsFile())
                  .filter((f): f is File => !!f);
                if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
              }}
              onKeyDown={e => {
                // Shift+Tab (mode cycle) is handled by the panel root via bubbling.
                if (e.key === 'Tab' && e.shiftKey) return;
                if (showPalette) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIndex(i => (i + 1) % cmdMatches.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIndex(i => (i - 1 + cmdMatches.length) % cmdMatches.length); return; }
                  if (e.key === 'Enter') { e.preventDefault(); acceptCommand(cmdMatches[cmdIndex] || cmdMatches[0], true); return; }
                  if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); acceptCommand(cmdMatches[cmdIndex] || cmdMatches[0], false); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setCmdDismissed(true); return; }
                }
                if (e.key === 'Escape' && working) { e.preventDefault(); browserSocket.acpCancel(anid, aidRef.current); return; }
                // Recall sent prompts when the caret is at the edge of the box (or
                // already navigating), so mid-text arrow movement still works.
                if (e.key === 'ArrowUp') {
                  const el = e.currentTarget;
                  const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
                  if (atStart || histIndex !== -1) { e.preventDefault(); recallHistory(-1); return; }
                }
                if (e.key === 'ArrowDown' && histIndex !== -1) {
                  const el = e.currentTarget;
                  if (el.selectionStart === el.value.length) { e.preventDefault(); recallHistory(1); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-base-content/50 hover:text-base-content hover:bg-base-200 transition-colors"
                  title="Attach image"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={16} />
                </button>
                <ModeSelector
                  modeState={thread?.modeState ?? null}
                  onSelect={(id) => { browserSocket.acpSetMode(anid, aidRef.current, id); setModeLocal(sid, id); }}
                />
                {modelState && modelState.availableModels.length > 0 ? (
                  <ModelSelector
                    modelState={modelState}
                    pendingModelId={pendingModelId}
                    onSelect={selectModel}
                  />
                ) : (
                  model && <span className="text-[11px] text-base-content/50 whitespace-nowrap">{model}</span>
                )}
                {contextPct != null && (
                  <span className="text-[11px] text-base-content/40 whitespace-nowrap" title="Context window used">{contextPct}% context</span>
                )}
              </div>
              {working ? (
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                  style={{ background: CORAL }}
                  title="Stop"
                  onClick={() => browserSocket.acpCancel(anid, aidRef.current)}
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white transition-opacity disabled:opacity-30"
                  style={{ background: CORAL }}
                  title="Send"
                  disabled={!draft.trim() && images.length === 0}
                  onClick={send}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showUsage && <UsageModal detail={usageDetail} onClose={() => setShowUsage(false)} />}
    </div>
  );
}
