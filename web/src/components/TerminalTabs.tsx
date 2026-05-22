import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'react';
import { Plus, X, TerminalSquare, Image as ImageIcon } from 'lucide-react';
import { useRegistryStore, useTerminalStore } from '../store';
import { browserSocket } from '../ws';
import TerminalPanel from './Terminal';
import type { SessionMeta } from '../lib/protocol';

interface Props {
  anid: string;
  parentSid: string;
}

export default function TerminalTabs({ anid, parentSid }: Props) {
  const { agentnodes, activeTabBySid, setActiveTab } = useRegistryStore();

  const node = agentnodes.get(anid);
  const allSessions = node?.sessions ?? [];

  const parent = allSessions.find((s: SessionMeta) => s.id === parentSid);
  const children = allSessions.filter((s: SessionMeta) => s.parentSid === parentSid);

  const tabs: SessionMeta[] = parent ? [parent, ...children] : [];
  const activeTabSid = activeTabBySid.get(parentSid) ?? parentSid;

  // If the active tab was killed, fall back to the parent
  const resolvedActive = tabs.find(t => t.id === activeTabSid) ? activeTabSid : parentSid;

  // Auto-select newly created bash tabs
  const prevChildrenLengthRef = useRef(children.length);
  useEffect(() => {
    if (children.length > prevChildrenLengthRef.current) {
      const newest = children[children.length - 1];
      if (newest) setActiveTab(parentSid, newest.id);
    }
    prevChildrenLengthRef.current = children.length;
  }, [children.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePasteImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t: string) => t.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const ext = imageType.split('/')[1] || 'png';
          const atts = useTerminalStore.getState().attachments;
          let foundAid: string | null = null;
          for (const [aid, att] of atts) {
            if (att.anid === anid && att.sid === resolvedActive) { foundAid = aid; break; }
          }
          if (foundAid) browserSocket.uploadImage(anid, foundAid, resolvedActive, base64, ext);
        };
        reader.readAsDataURL(blob);
        break;
      }
    } catch {
      // clipboard read denied or no image — silently ignore
    }
  }, [anid, resolvedActive]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        handlePasteImage();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlePasteImage]);

  const handleAddTab = () => {
    const aid = nanoid(8);
    const cols = Math.floor(window.innerWidth * 0.7 / 8);
    const rows = Math.floor(window.innerHeight / 20);
    browserSocket.create(anid, aid, {
      cwd: parent?.cwd,
      parentSid,
      cols,
      rows,
    });
  };

  const handleCloseTab = (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    browserSocket.kill(anid, sid);
    // If we're closing the active tab, switch to parent
    if (resolvedActive === sid) {
      setActiveTab(parentSid, parentSid);
    }
  };

  if (!parent) return null;

  return (
    <div className="flex flex-col w-full h-full">
      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-base-300 bg-base-200 shrink-0 overflow-x-auto">
        {tabs.map((tab, i) => {
          const isActive = tab.id === resolvedActive;
          const isParent = tab.id === parentSid;
          const label = isParent ? tab.name : `terminal${i > 1 ? `-${i}` : ''}`;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(parentSid, tab.id)}
              className={`
                group flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-r border-base-300 transition-colors shrink-0
                ${isActive
                  ? 'bg-base-100 text-base-content border-b-2 border-b-primary -mb-px'
                  : 'text-base-content/60 hover:text-base-content hover:bg-base-100/50'}
              `}
            >
              <TerminalSquare size={12} className="shrink-0" />
              <span>{label}</span>
              {!isParent && (
                <span
                  role="button"
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-error transition-opacity"
                >
                  <X size={11} />
                </span>
              )}
            </button>
          );
        })}

        {/* Add bash tab button */}
        <button
          onClick={handleAddTab}
          className="flex items-center gap-1 px-3 py-2 text-xs text-base-content/40 hover:text-base-content/70 hover:bg-base-100/50 transition-colors shrink-0"
          title="Open a new terminal"
        >
          <Plus size={13} />
        </button>

        {/* Paste image button */}
        <button
          onClick={handlePasteImage}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center gap-1 px-3 py-2 text-xs text-base-content/40 hover:text-base-content/70 hover:bg-base-100/50 transition-colors shrink-0"
          title="Paste image from clipboard (Ctrl+Shift+V)"
        >
          <ImageIcon size={13} />
        </button>
      </div>

      {/* Stacked terminal panels — all mounted, only active one visible */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={tab.id === resolvedActive ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
          >
            <TerminalPanel
              anid={anid}
              sid={tab.id}
              visible={tab.id === resolvedActive}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
