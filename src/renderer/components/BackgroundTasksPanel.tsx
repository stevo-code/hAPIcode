import { useEffect, useRef, useState } from 'react'
import type { BgTask } from '@shared/types'
import { useApp } from '../store'
import { useT } from '../lib/i18n'
import type { TKey } from '@shared/i18n'

function duration(t: BgTask): string {
  const end = t.endedAt ?? Date.now()
  const s = Math.max(0, Math.round((end - t.startedAt) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : `${s}s`
}

function TaskCard({ tk, t }: { tk: BgTask; t: (k: TKey) => string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4)
  }, [tk.detail, open])

  return (
    <div className={`task-card status-${tk.status}`}>
      <div className="task-row">
        <span className="task-ico">{tk.kind === 'subagent' ? '🤖' : '▶️'}</span>
        <span className="task-title">{tk.title || (tk.kind === 'subagent' ? t('subAgent') : t('command'))}</span>
        <span className={`task-state status-${tk.status}`}>
          {tk.status === 'running' ? t('running') : tk.status === 'done' ? t('done') : t('errorLabel')}
        </span>
      </div>
      <div className="task-meta">
        <span>{tk.kind === 'subagent' ? t('subAgent') : 'Bash'}</span>
        <span>·</span>
        <span>{duration(tk)}</span>
        {tk.agentCount ? (
          <>
            <span>·</span>
            <span>
              {tk.agentCount} agent{tk.agentCount > 1 ? 's' : ''}
            </span>
          </>
        ) : null}
      </div>
      {tk.detail && (
        <>
          <div ref={ref} className={`task-detail ${open ? 'expanded' : ''}`}>
            {tk.detail}
          </div>
          {(overflows || open) && (
            <button className="task-more" onClick={() => setOpen((o) => !o)}>
              {open ? `▴ ${t('showLess')}` : `▾ ${t('showMore')}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function BackgroundTasksPanel(): JSX.Element {
  const t = useT()
  const tasks = useApp((s) => s.backgroundTasks)
  const toggle = useApp((s) => s.toggleTasks)
  const clear = useApp((s) => s.clearTasks)
  const width = useApp((s) => s.tasksWidth)
  const [, setTick] = useState(0)

  // Tâches EN COURS toujours en haut ; au sein de chaque groupe, la plus récente d'abord.
  const sorted = [...tasks].sort((a, b) => {
    const ra = a.status === 'running' ? 0 : 1
    const rb = b.status === 'running' ? 0 : 1
    return ra - rb || b.startedAt - a.startedAt
  })

  // Met à jour le chrono des tâches en cours en TEMPS RÉEL (re-render chaque seconde).
  const hasRunning = tasks.some((tk) => tk.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [hasRunning])

  return (
    <aside className="tasks-panel" style={{ width }}>
      <div className="tasks-head">
        <span className="tasks-title">{t('backgroundTasks')}</span>
        <div className="titlebar-spacer" />
        <button className="ghost-btn small" onClick={clear}>
          {t('clearDone')}
        </button>
        <button className="icon-btn" onClick={toggle} title="✕">
          ✕
        </button>
      </div>
      <div className="tasks-list">
        {sorted.length === 0 && <div className="recents-empty">{t('noBgTasks')}</div>}
        {sorted.map((tk) => (
          <TaskCard key={tk.id} tk={tk} t={t} />
        ))}
      </div>
    </aside>
  )
}
