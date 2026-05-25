interface Props { indexStatus: string; worktreeStatus: string; untracked: boolean }

const LABEL: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'U', '?': '?',
};

const COLOR: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-error',
  R: 'text-info',
  C: 'text-info',
  U: 'text-error',
  '?': 'text-base-content/50',
};

export default function GitStatusBadge({ indexStatus, worktreeStatus, untracked }: Props) {
  const char = untracked ? '?' : (indexStatus !== ' ' ? indexStatus : worktreeStatus);
  const label = LABEL[char] ?? char;
  const color = COLOR[char] ?? 'text-base-content/50';
  return (
    <span className={`font-mono text-xs font-bold w-4 shrink-0 text-center ${color}`} title={label}>
      {label}
    </span>
  );
}
