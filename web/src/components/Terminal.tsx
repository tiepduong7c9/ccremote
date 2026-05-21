import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { nanoid } from 'nanoid';
import { browserSocket } from '../ws';
import { useTerminalStore } from '../store';
import '@xterm/xterm/css/xterm.css';

interface Props {
  anid: string;
  sid: string;
}

export default function TerminalPanel({ anid, sid }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aidRef = useRef<string>(nanoid(8));
  const setAttachment = useTerminalStore(s => s.setAttachment);
  const removeAttachment = useTerminalStore(s => s.removeAttachment);

  useEffect(() => {
    if (!containerRef.current) return;

    const aid = aidRef.current;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      theme: { background: '#1e1e2e', foreground: '#cdd6f4' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    browserSocket.registerTerm(aid, term);
    setAttachment(aid, { anid, sid, session: null, status: 'attaching' });
    browserSocket.attach(anid, aid, sid);

    term.onData((data) => {
      // encode input as base64 for the wire protocol
      browserSocket.input(anid, aid, btoa(unescape(encodeURIComponent(data))));
    });

    const onResize = () => {
      fitAddon.fit();
      browserSocket.resize(anid, aid, term.cols, term.rows);
    };
    window.addEventListener('resize', onResize);

    // After attached event: nudge resize to trigger Claude TUI redraw (mirrors bin/ccremote.js:254-265)
    const unsub = useTerminalStore.subscribe((state) => {
      const att = state.attachments.get(aid);
      if (att?.status === 'attached') {
        const { cols, rows } = term;
        browserSocket.resize(anid, aid, cols, rows + 1);
        setTimeout(() => browserSocket.resize(anid, aid, cols, rows), 50);
        unsub();
      }
    });

    return () => {
      window.removeEventListener('resize', onResize);
      unsub();
      browserSocket.detach(anid, aid);
      browserSocket.unregisterTerm(aid);
      removeAttachment(aid);
      term.dispose();
    };
  }, [anid, sid]);

  return <div ref={containerRef} className="w-full h-full bg-[#1e1e2e]" />;
}
