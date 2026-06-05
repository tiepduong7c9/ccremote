import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Square, Wrench, ListTodo, ShieldQuestion, BrainCircuit, AlertTriangle, ChevronRight } from 'lucide-react';
import { browserSocket } from '../ws';
import { useTerminalStore } from '../store';
import { useAcpStore } from '../acp-store';
import type { AcpContentBlock, AcpEvent, AcpPlanEntry, AcpPermissionRequest, AcpToolContent } from '../lib/protocol';

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
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {items.length === 0 && (
          <div className="text-center text-base-content/40 text-sm py-10">
            Send a message to start the conversation.
          </div>
        )}
        {items.map(item => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-content px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
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

      {/* Composer */}
      <div className="shrink-0 border-t border-base-300 bg-base-200 p-3">
        {waiting && (
          <div className="text-[11px] text-warning mb-2 flex items-center gap-1">
            <ShieldQuestion size={12} /> Claude is waiting for your permission above.
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            className="textarea textarea-bordered flex-1 resize-none text-sm min-h-[2.5rem] max-h-40"
            rows={1}
            value={draft}
            placeholder="Message Claude…"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          {working ? (
            <button className="btn btn-square btn-error" title="Stop" onClick={() => browserSocket.acpCancel(anid, aidRef.current)}>
              <Square size={16} />
            </button>
          ) : (
            <button className="btn btn-square btn-primary" title="Send" disabled={!draft.trim()} onClick={send}>
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
