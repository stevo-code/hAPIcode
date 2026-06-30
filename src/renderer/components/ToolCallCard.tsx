import { useState } from 'react'
import type { UiToolEntry as ToolEntry } from '@shared/types'
import type { TKey } from '@shared/i18n'
import { useT } from '../lib/i18n'

const ICON: Record<string, string> = {
  list_dir: '📂',
  read_file: '📖',
  write_file: '✏️',
  run_command: '▶️',
  spawn_subagent: '🤖'
}

const STATUS_KEY: Record<ToolEntry['status'], TKey> = {
  pending: 'pendingApproval',
  running: 'running',
  denied: 'deniedLabel',
  done: 'done',
  error: 'errorLabel'
}

interface Props {
  entry: ToolEntry
  onApprove: (callId: string, approved: boolean) => void
  onApproveAlways: (callId: string) => void
}

export function ToolCallCard({ entry, onApprove, onApproveAlways }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const args = entry.args as Record<string, any>
  const summary = describe(entry.tool, args)

  return (
    <div className={`tool-card status-${entry.status}`}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-ico">{ICON[entry.tool] ?? '🔧'}</span>
        <span className="tool-name">{entry.tool}</span>
        <span className="tool-summary">{summary}</span>
        <span className={`tool-status status-${entry.status}`}>{t(STATUS_KEY[entry.status])}</span>
      </div>

      {entry.status === 'pending' && (
        <div className="tool-approve">
          <button className="ghost-btn deny-btn" onClick={() => onApprove(entry.callId, false)}>
            {t('approveDeny')}
          </button>
          <span className="approve-spacer" />
          <button className="ghost-btn" onClick={() => onApproveAlways(entry.callId)}>
            {t('approveAlways')}
          </button>
          <button className="primary-btn tiny" onClick={() => onApprove(entry.callId, true)}>
            {t('approveOnce')}
          </button>
        </div>
      )}

      {open && (
        <div className="tool-detail">
          <pre className="tool-args">{JSON.stringify(args, null, 2)}</pre>
          {entry.result && <pre className="tool-result">{entry.result}</pre>}
        </div>
      )}
    </div>
  )
}

function describe(tool: string, args: Record<string, any>): string {
  switch (tool) {
    case 'run_command':
      return args.command ?? ''
    case 'write_file':
    case 'read_file':
    case 'list_dir':
      return args.path ?? '.'
    case 'spawn_subagent':
      return args.description ?? ''
    default:
      return ''
  }
}
