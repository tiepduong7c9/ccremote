export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  timestamp: number;
  subject: string;
}

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
  | { type: 'scrollback'; anid: string; aid: string; sid: string; data: string; redraw?: boolean }
  | { type: 'data'; anid: string; aid: string; sid: string; data: string }
  | { type: 'session_exit'; anid: string; sid: string; code: number }
  | { type: 'image_uploaded'; anid: string; aid: string; path: string }
  | { type: 'git_repos'; anid: string; aid: string; repos: GitRepo[] }
  | { type: 'git_result'; anid: string; aid: string; success: boolean; message: string }
  | { type: 'git_branches_result'; anid: string; aid: string; branches: string[] }
  | { type: 'git_checkout_result'; anid: string; aid: string }
  | { type: 'git_status_result'; anid: string; aid: string; branch: string; files: GitFileChange[] }
  | { type: 'git_diff_result'; anid: string; aid: string; path: string; oldContent: string; newContent: string; language: string; isBinary: boolean; tooLarge: boolean }
  | { type: 'git_pull_result'; anid: string; aid: string; output: string }
  | { type: 'git_revert_result'; anid: string; aid: string }
  | { type: 'git_log_result'; anid: string; aid: string; commits: GitCommit[] }
  | { type: 'file_list_result'; anid: string; aid: string; files: string[] }
  | { type: 'file_list_dir_result'; anid: string; aid: string; entries: { name: string; isDir: boolean }[] }
  | { type: 'file_read_result'; anid: string; aid: string; path: string; content: string; language: string; isBinary: boolean; tooLarge: boolean }
  | { type: 'file_write_result'; anid: string; aid: string; path: string }
  | { type: 'file_delete_result'; anid: string; aid: string; path: string }
  | { type: 'file_download_chunk'; anid: string; aid: string; path: string; index: number; total: number; base64?: string; size?: number; error?: string }
  | { type: 'file_upload_result'; anid: string; aid: string; path: string }
  | { type: 'claude_md_read_result'; anid: string; aid: string; content: string }
  | { type: 'claude_md_write_result'; anid: string; aid: string }
  | { type: 'server_error'; anid?: string; aid?: string; message: string };

export type BrowserMsg = {
  type: 'attach' | 'detach' | 'input' | 'resize' | 'create' | 'kill' | 'rename' | 'upload_image' | 'git_status' | 'git_diff' | 'git_pull' | 'git_revert' | 'git_log' | 'git_list_branches' | 'git_checkout' | 'file_list' | 'file_list_dir' | 'file_read' | 'file_write' | 'file_delete' | 'file_download' | 'file_upload_chunk' | 'claude_md_read' | 'claude_md_write';
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
  paths?: string[];
  includeUntracked?: boolean;
  content?: string;
  parentSid?: string;
  ext?: string;
  subPath?: string;
  branch?: string;
  limit?: number;
  index?: number;
  total?: number;
  size?: number;
  base64?: string;
};
