import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Square, Wrench, ListTodo, ShieldQuestion, BrainCircuit, AlertTriangle, ChevronRight, ChevronDown, Zap, Check } from 'lucide-react';
import { browserSocket } from '../ws';
import { useTerminalStore } from '../store';
import { useAcpStore } from '../acp-store';
import type { AcpContentBlock, AcpEvent, AcpModeState, AcpPlanEntry, AcpPermissionRequest, AcpToolContent } from '../lib/protocol';

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
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | { kind: 'tool'; id: string; toolCallId: string; title: string; status: string; toolKind?: string; content: AcpToolContent[] }
  | { kind: 'plan'; id: string; entries: AcpPlanEntry[] }
  | { kind: 'permission'; id: string; requestId: string; request: AcpPermissionRequest; resolved?: string }
  | { kind: 'error'; id: string; message: string };

// Theme-aware markdown. Colors are pinned to DaisyUI tokens (not prose's gray
// palette / dark:invert) so it renders correctly under any DaisyUI theme.
function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words leading-relaxed
      text-base-content
      prose-headings:text-base-content prose-p:text-base-content prose-li:text-base-content
      prose-strong:text-base-content prose-em:text-base-content prose-blockquote:text-base-content/70
      prose-a:text-primary prose-hr:border-base-300
      prose-code:text-base-content prose-code:bg-base-300 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-[''] prose-code:after:content-['']
      prose-pre:bg-base-300 prose-pre:text-base-content prose-pre:text-xs prose-pre:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function textOf(c: AcpContentBlock | undefined): string {
  if (!c) return '';
  if (typeof (c as { text?: unknown }).text === 'string') return (c as { text: string }).text;
  return '';
}

function buildThread(events: AcpEvent[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const toolIndex = new Map<string, number>();
  let planIndex = -1;

  events.forEach((e, i) => {
    if (e.type === 'acp_user') {
      items.push({ kind: 'user', id: `u${i}`, text: e.blocks.map(textOf).join('') });
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
        title="Change permission mode"
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

function ToolCard({ item }: { item: Extract<ThreadItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const statusColor = item.status === 'completed' ? 'text-success'
    : item.status === 'failed' || item.status === 'cancelled' ? 'text-error'
    : 'text-warning';
  const hasContent = item.content.some(c => c.type === 'diff' || textOf(c.content));
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 text-sm">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => hasContent && setOpen(o => !o)}
      >
        {hasContent && <ChevronRight size={13} className={`shrink-0 text-base-content/40 transition-transform ${open ? 'rotate-90' : ''}`} />}
        <Wrench size={13} className="shrink-0 text-base-content/50" />
        <span className="font-medium truncate flex-1">{item.title}</span>
        <span className={`text-[11px] font-medium ${statusColor}`}>{item.status}</span>
      </button>
      {open && hasContent && <div className="px-3 pb-2"><ToolContentView content={item.content} /></div>}
    </div>
  );
}

export default function AcpThread({ anid, sid, visible = true }: Props) {
  const aidRef = useRef<string>(nanoid(8));
  const setAttachment = useTerminalStore(s => s.setAttachment);
  const removeAttachment = useTerminalStore(s => s.removeAttachment);
  const thread = useAcpStore(s => s.threads.get(sid));
  const resolvePermissionLocal = useAcpStore(s => s.resolvePermissionLocal);
  const setModeLocal = useAcpStore(s => s.setModeLocal);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
  const working = thread?.claudeStatus === 'working';
  const waiting = thread?.claudeStatus === 'waiting';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items.length, working]);

  useEffect(() => {
    if (visible) taRef.current?.focus();
  }, [visible]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    browserSocket.acpPrompt(anid, aidRef.current, [{ type: 'text', text }]);
    setDraft('');
  };

  const answerPermission = (requestId: string, optionId: string | null) => {
    browserSocket.acpPermissionResponse(anid, aidRef.current, requestId, optionId);
    resolvePermissionLocal(sid, requestId, optionId);
  };

  return (
    <div
      className="w-full h-full flex flex-col bg-base-100"
      style={visible ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
    >
      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
            <ClaudeMark size={30} />
            <div className="text-lg font-medium text-base-content/80">You've come to the absolutely right place!</div>
            <div className="text-sm text-base-content/45 max-w-sm">
              Ask Claude to edit, run, or explain anything in this repo. Tool calls and
              permission requests appear inline.
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
        {items.map(item => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-base-200 border border-base-300 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
                  {item.text}
                </div>
              );
            case 'assistant':
              return (
                <div key={item.id} className="self-start max-w-[85%] text-sm">
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
                      {item.request.options.map(opt => (
                        <button
                          key={opt.optionId}
                          className={`btn btn-xs ${opt.kind === 'allow_always' || opt.kind === 'allow_once' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => answerPermission(item.requestId, opt.optionId)}
                        >
                          {opt.name}
                        </button>
                      ))}
                      <button className="btn btn-xs btn-ghost text-error" onClick={() => answerPermission(item.requestId, null)}>
                        Reject
                      </button>
                    </div>
                  )}
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
            className="rounded-2xl border border-base-300 bg-base-100 transition-shadow"
            style={focused ? { borderColor: CORAL, boxShadow: `0 0 0 3px ${CORAL}22` } : undefined}
          >
            <textarea
              ref={taRef}
              className="w-full bg-transparent resize-none outline-none text-sm px-4 pt-3 pb-1.5 leading-relaxed"
              rows={1}
              style={{ minHeight: '2.75rem', maxHeight: '200px' }}
              value={draft}
              placeholder="Reply to Claude…"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={e => { setDraft(e.target.value); autoGrow(e.target); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <ModeSelector
                modeState={thread?.modeState ?? null}
                onSelect={(id) => { browserSocket.acpSetMode(anid, aidRef.current, id); setModeLocal(sid, id); }}
              />
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
                  disabled={!draft.trim()}
                  onClick={send}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
