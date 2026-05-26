export interface GitWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface GitFileChange {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitRepo {
  localPath: string;
  url?: string;
  worktrees: GitWorktree[];
}

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
  | { type: 'git_repos'; anid: string; aid: string; repos: GitRepo[] }
  | { type: 'git_result'; anid: string; aid: string; success: boolean; message: string }
  | { type: 'git_status_result'; anid: string; aid: string; branch: string; files: GitFileChange[] }
  | { type: 'git_diff_result'; anid: string; aid: string; path: string; oldContent: string; newContent: string; language: string; isBinary: boolean; tooLarge: boolean }
  | { type: 'git_pull_result'; anid: string; aid: string; output: string }
  | { type: 'file_list_result'; anid: string; aid: string; files: string[] }
  | { type: 'file_read_result'; anid: string; aid: string; path: string; content: string; language: string; isBinary: boolean; tooLarge: boolean }
  | { type: 'file_write_result'; anid: string; aid: string; path: string }
  | { type: 'server_error'; anid?: string; aid?: string; message: string };

export type BrowserMsg = {
  type: 'attach' | 'detach' | 'input' | 'resize' | 'create' | 'kill' | 'rename' | 'upload_image' | 'git_status' | 'git_diff' | 'git_pull' | 'file_list' | 'file_read' | 'file_write';
  anid: string;
  aid?: string;
  sid?: string;
  data?: string;
  cols?: number;
  rows?: number;
  name?: string;
  command?: string;
  cwd?: string;
  path?: string;
  content?: string;
  parentSid?: string;
  ext?: string;
};
