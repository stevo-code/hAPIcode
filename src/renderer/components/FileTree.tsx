import { useEffect, useState } from 'react'
import type { DirEntry } from '@shared/types'

interface Props {
  root: string
  onOpen: (entry: DirEntry) => void
  activePath?: string
}

export function FileTree({ root, onOpen, activePath }: Props): JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    window.api.fs
      .listDir(root)
      .then(setEntries)
      .catch((e) => setError(String(e)))
  }, [root])

  if (error) return <div className="tree-error">{error}</div>
  return (
    <div className="file-tree">
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} onOpen={onOpen} activePath={activePath} />
      ))}
    </div>
  )
}

function TreeNode({
  entry,
  depth,
  onOpen,
  activePath
}: {
  entry: DirEntry
  depth: number
  onOpen: (e: DirEntry) => void
  activePath?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)

  const toggle = async (): Promise<void> => {
    if (entry.isDir) {
      if (!children) {
        try {
          setChildren(await window.api.fs.listDir(entry.path))
        } catch {
          setChildren([])
        }
      }
      setOpen(!open)
    } else {
      onOpen(entry)
    }
  }

  return (
    <div>
      <div
        className={`tree-row ${activePath === entry.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        title={entry.name}
      >
        <span className="tree-caret">{entry.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{entry.isDir ? '📁' : '📄'}</span>
        <span className="tree-name">{entry.name}</span>
      </div>
      {open && children && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} activePath={activePath} />
          ))}
        </div>
      )}
    </div>
  )
}
