import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder } from 'lucide-react';
import type { GitFileChange } from '../lib/protocol';
import GitStatusBadge from './GitStatusBadge';

interface Props {
  files: GitFileChange[];
  selectedFile: string | null;
  onOpen: (path: string) => void;
  collapseRevision?: number;
}

interface TreeNode {
  name: string;
  fullPath: string;
  file?: GitFileChange;
  children: Map<string, TreeNode>;
}

function buildTree(files: GitFileChange[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, fullPath: parts.slice(0, i + 1).join('/'), children: new Map() });
      }
      node = node.children.get(part)!;
      if (i === parts.length - 1) node.file = f;
    }
  }
  return root;
}

function TreeNodeRow({ node, depth, selectedFile, onOpen, collapseRevision }: { node: TreeNode; depth: number; selectedFile: string | null; onOpen: (path: string) => void; collapseRevision?: number }) {
  const [open, setOpen] = useState(true);
  const isDir = node.children.size > 0 && !node.file;

  useEffect(() => {
    if (collapseRevision && collapseRevision > 0) setOpen(false);
  }, [collapseRevision]);

  if (isDir) {
    return (
      <>
        <button
          className="w-full flex items-center gap-1 px-2 py-0.5 hover:bg-base-300 text-left min-w-0"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown size={12} className="shrink-0 text-base-content/40" /> : <ChevronRight size={12} className="shrink-0 text-base-content/40" />}
          <Folder size={12} className="shrink-0 text-base-content/40" />
          <span className="font-mono text-xs text-base-content/60 truncate">{node.name}/</span>
        </button>
        {open && Array.from(node.children.values()).map(child => (
          <TreeNodeRow key={child.fullPath} node={child} depth={depth + 1} selectedFile={selectedFile} onOpen={onOpen} collapseRevision={collapseRevision} />
        ))}
      </>
    );
  }

  const isSelected = node.file?.path === selectedFile;
  return (
    <button
      className={`w-full flex items-center gap-1.5 py-0.5 text-left min-w-0 group
        ${isSelected ? 'bg-primary/15 hover:bg-primary/20' : 'hover:bg-base-300'}`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => node.file && onOpen(node.file.path)}
    >
      {node.file && (
        <GitStatusBadge indexStatus={node.file.indexStatus} worktreeStatus={node.file.worktreeStatus} untracked={node.file.untracked} />
      )}
      <span className="font-mono text-xs truncate text-base-content/80 group-hover:text-base-content">{node.name}</span>
    </button>
  );
}

export default function GitFileTree({ files, selectedFile, onOpen, collapseRevision }: Props) {
  const root = buildTree(files);
  return (
    <ul className="py-1">
      {Array.from(root.children.values()).map(child => (
        <li key={child.fullPath}>
          <TreeNodeRow node={child} depth={0} selectedFile={selectedFile} onOpen={onOpen} collapseRevision={collapseRevision} />
        </li>
      ))}
    </ul>
  );
}
