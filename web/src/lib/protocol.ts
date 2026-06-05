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
  mode?: 'pty' | 'acp';
  status: 'running' | 'suspended' | 'exited';
  claudeStatus?: 'working' | 'waiting' | 'idle';
  parentSid?: string;
  createdAt: string;
  lastAttachedAt: string | null;
}

// ── ACP (Agent Client Protocol) thread types ────────────────────────────────
export type AcpContentBlock = { type: 'text'; text: string } | { type: string; [k: string]: unknown };

export interface AcpToolContent {
  type: string; // 'content' | 'diff' | ...
  content?: AcpContentBlock;
  path?: string;
  oldText?: string | null;
  newText?: string;
  [k: string]: unknown;
}

export interface AcpPlanEntry { content: string; priority?: string; status?: string }

export type AcpUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: AcpContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: AcpContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content: AcpContentBlock }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title?: string; kind?: string; status?: string; content?: AcpToolContent[] }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status?: string; title?: string; content?: AcpToolContent[] }
  | { sessionUpdate: 'plan'; entries: AcpPlanEntry[] }
  | { sessionUpdate: string; [k: string]: unknown };

export interface AcpPermissionOption { optionId: string; name: string; kind?: string }
export interface AcpPermissionRequest { options: AcpPermissionOption[]; toolCall?: { title?: string; kind?: string; content?: AcpToolContent[]; [k: string]: unknown }; [k: string]: unknown }

export type AcpEvent = (
  | { type: 'acp_user'; blocks: AcpContentBlock[] }
  | { type: 'acp_update'; update: AcpUpdate }
  | { type: 'acp_permission'; requestId: string; request: AcpPermissionRequest; resolved?: string }
  | { type: 'acp_stop'; stopReason: string }
  | { type: 'acp_error'; message: string }
  | { type: 'acp_status'; claudeStatus?: 'working' | 'waiting' | 'idle' }
) & { seq?: number };

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
  | { type: 'acp_history'; anid: string; aid: string; sid: string; events: AcpEvent[]; claudeStatus?: 'working' | 'waiting' | 'idle'; acpSessionId: string | null }
  | { type: 'acp_event'; anid: string; aid: string; sid: string; event: AcpEvent }
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
  | { type: 'skill_inject_result'; anid: string; aid: string; name: string }
  | { type: 'server_error'; anid?: string; aid?: string; message: string };

export type BrowserMsg = {
  type: 'attach' | 'detach' | 'input' | 'resize' | 'create' | 'kill' | 'rename' | 'upload_image' | 'acp_prompt' | 'acp_cancel' | 'acp_permission_response' | 'git_status' | 'git_diff' | 'git_pull' | 'git_revert' | 'git_log' | 'git_list_branches' | 'git_checkout' | 'file_list' | 'file_list_dir' | 'file_read' | 'file_write' | 'file_delete' | 'file_download' | 'file_upload_chunk' | 'claude_md_read' | 'claude_md_write' | 'skill_inject';
  anid: string;
  aid?: string;
  sid?: string;
  data?: string;
  cols?: number;
  rows?: number;
  name?: string;
  command?: string;
  cwd?: string;
  mode?: 'pty' | 'acp';
  blocks?: AcpContentBlock[];
  requestId?: string;
  optionId?: string | null;
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
  skillId?: string;
};
