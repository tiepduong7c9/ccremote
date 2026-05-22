export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  command: string;
  status: 'running' | 'suspended' | 'exited';
  claudeStatus?: 'working' | 'waiting' | 'idle';
  parentSid?: string;
  createdAt: string;
  lastAttachedAt: string | null;
}

export interface AgentnodeView {
  id: string;
  name: string;
  hostname: string | null;
  platform: string | null;
  sessions: SessionMeta[];
  online: boolean;
}

export type ServerMsg =
  | { type: 'snapshot'; agentnodes: AgentnodeView[] }
  | { type: 'agentnode_online'; agentnode: { anid: string; name: string } }
  | { type: 'agentnode_offline'; anid: string }
  | { type: 'sessions'; anid: string; sessions: SessionMeta[] }
  | { type: 'attached'; anid: string; aid: string; sid: string; session: SessionMeta }
  | { type: 'scrollback'; anid: string; aid: string; sid: string; data: string }
  | { type: 'data'; anid: string; aid: string; sid: string; data: string }
  | { type: 'session_exit'; anid: string; sid: string; code: number }
  | { type: 'image_uploaded'; anid: string; aid: string; path: string }
  | { type: 'server_error'; anid?: string; aid?: string; message: string };

export type BrowserMsg = {
  type: 'attach' | 'detach' | 'input' | 'resize' | 'create' | 'kill' | 'rename' | 'upload_image';
  anid: string;
  aid?: string;
  sid?: string;
  data?: string;
  cols?: number;
  rows?: number;
  name?: string;
  command?: string;
  cwd?: string;
  parentSid?: string;
  ext?: string;
};
