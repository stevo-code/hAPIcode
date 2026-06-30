import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Compaction } from '@shared/types'
import { useApp } from '../store'
import { useT } from '../lib/i18n'
import { ModelPicker } from './ModelPicker'
import { ReasoningPicker } from './ReasoningPicker'
import { Messages } from './Messages'
import { TargetBar } from './TargetBar'
import { ContextChip } from './ContextChip'

const PALETTE = ['#4ec07a', '#d8a657', '#3a6ea5', '#cc7a4f', '#a06ad8', '#5ec8c8', '#e0707a']

export function ConversationView({ convId }: { convId: string }): JSX.Element {
  const t = useT()
  const conv = useApp((s) => s.conversations[convId])
  const send = useApp((s) => s.send)
  const cancel = useApp((s) => s.cancel)
  const approve = useApp((s) => s.approve)
  const approveAlways = useApp((s) => s.approveAlways)
  const setConvTarget = useApp((s) => s.setConvTarget)
  const toggleAutoApprove = useApp((s) => s.toggleAutoApprove)

  const [input, setInput] = useState('')
  const [viewCp, setViewCp] = useState<Compaction | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [conv?.messages])

  // Agrandit la zone de saisie selon le contenu (Shift+Entrée), avec une limite (puis défilement).
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
  }, [input])

  if (!conv) return <div className="conversation" />

  const submit = (): void => {
    if (!input.trim()) return
    send(convId, input)
    setInput('')
  }
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const attachFile = async (): Promise<void> => {
    const path = await window.api.fs.selectFile()
    if (!path) return
    try {
      const content = await window.api.fs.readFile(path)
      const name = path.split(/[\\/]/).pop()
      setInput((prev) => `${prev}${prev ? '\n\n' : ''}--- ${name} ---\n${content}\n--- end ---\n`)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="conversation">
      <TitleBar convId={convId} onChangeTarget={conv.section === 'code' ? () => setConvTarget(convId, undefined as never) : undefined} />

      {!!conv.compactions?.length && (
        <div className="compaction-bar" title={t('compactionView')}>
          <span className="compaction-bar-ico">🗜</span>
          {conv.compactions.map((cp, i) => (
            <button
              key={cp.id}
              className="compaction-mark"
              title={`${t('compactionDone')} ${i + 1} · ${cp.title}`}
              onClick={() => setViewCp(cp)}
            >
              <span className="compaction-mark-bar" />
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {viewCp && (
        <CompactionModal
          cp={viewCp}
          index={(conv.compactions?.findIndex((x) => x.id === viewCp.id) ?? 0) + 1}
          onClose={() => setViewCp(null)}
        />
      )}

      <div className="conv-main">
          <div className="messages" ref={scrollRef}>
            {conv.compacting && (
              <div className="compacting-banner">
                <span className="spinner" /> 🗜 {t('compacting')}
              </div>
            )}
            {conv.messages.length === 0 && (
              <div className="empty-hint">
                <div className="empty-card small">
                  <div className="empty-emoji">{conv.section === 'chat' ? '💬' : '</>'}</div>
                  <p>
                    {conv.section === 'chat'
                      ? t('chatEmptyText')
                      : conv.target?.type === 'ssh'
                        ? `${conv.target.label} — ${t('codeEmptyText')}`
                        : t('codeEmptyText')}
                  </p>
                </div>
              </div>
            )}
            <Messages
              messages={conv.messages}
              onApprove={(callId, ok) => approve(convId, callId, ok)}
              onApproveAlways={(callId) => approveAlways(convId, callId)}
            />
          </div>

          <div className="composer-wrap">
            {/* Sélecteur Local/SSH + dossier : AU-DESSUS du champ, et seulement tant que le
                projet n'est pas démarré (ensuite on se reconnecte toujours au même dossier). */}
            {conv.section === 'code' && (!conv.target || conv.messages.length === 0) && <TargetBar convId={convId} />}
            {conv.compacting && (
              <div className="working-status">
                <span className="spinner" />
                <span className="working-ico">🗜</span>
                <span className="working-label">{t('compacting')}</span>
              </div>
            )}
            {conv.busy && !conv.compacting && <WorkingStatus phase={conv.phase} />}
            <div className="composer-panel">
              <div className="composer-input-row">
                <textarea
                  ref={taRef}
                  value={input}
                  placeholder={t('composerPlaceholder')}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                />
                {conv.busy ? (
                  <button className="icon-send stop" onClick={() => cancel(convId)} title={t('stop')}>
                    ■
                  </button>
                ) : (
                  <button className="icon-send" onClick={submit} disabled={!input.trim()} title={t('send')}>
                    ↵
                  </button>
                )}
              </div>
            </div>

            <div className="composer-toolbar">
              {conv.section === 'code' && (
                <button
                  className={`accept-toggle ${conv.autoApprove ? 'on' : ''}`}
                  onClick={() => toggleAutoApprove(convId)}
                  title={t('acceptChanges')}
                >
                  {t('acceptChanges')}
                </button>
              )}
              <button className="icon-btn attach-btn" onClick={attachFile} title={t('attachFile')}>
                ＋
              </button>
              <span className="titlebar-spacer" />
              <ModelPicker />
              <ReasoningPicker />
              <ContextChip convId={convId} />
            </div>
          </div>
      </div>
    </div>
  )
}

/** Indicateur « en cours » sous le texte : dit CE que l'agent fait (réflexion / analyse / outil…). */
function WorkingStatus({ phase }: { phase?: string }): JSX.Element {
  const t = useT()
  let icon = '⏳'
  let label = t('phaseStarting')
  if (phase === 'thinking') {
    icon = '💭'
    label = t('phaseThinking')
  } else if (phase === 'writing') {
    icon = '✍️'
    label = t('phaseWriting')
  } else if (phase === 'analyzing') {
    icon = '🔎'
    label = t('phaseAnalyzing')
  } else if (phase?.startsWith('tool:')) {
    icon = '🔧'
    label = `${t('phaseTool')} : ${phase.slice(5)}`
  }
  return (
    <div className="working-status">
      <span className="working-dot" />
      <span className="working-ico">{icon}</span>
      <span className="working-label">{label}</span>
    </div>
  )
}

/** Modale d'un chapitre de compactage : le résumé détaillé (les notes) de cette tranche. */
function CompactionModal({ cp, index, onClose }: { cp: Compaction; index: number; onClose: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="titlebar-title">
            🗜 {t('compactionDone')} {index} — {cp.title}
          </span>
          <div className="titlebar-spacer" />
          <button className="ghost-btn small" onClick={() => window.api.app.copyText(cp.summary)}>
            {t('copy')}
          </button>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body md compaction-summary">
          <div className="compaction-date">{new Date(cp.at).toLocaleString()}</div>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cp.summary}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

function TitleBar({ convId, onChangeTarget }: { convId: string; onChangeTarget?: () => void }): JSX.Element {
  const t = useT()
  const conv = useApp((s) => s.conversations[convId])
  const rename = useApp((s) => s.renameConversation)
  const duplicate = useApp((s) => s.duplicateConversation)
  const remove = useApp((s) => s.deleteConversation)
  const clearConv = useApp((s) => s.clearConversation)
  const archive = useApp((s) => s.archiveConversation)
  const setConvColor = useApp((s) => s.setConvColor)
  const toggleTasks = useApp((s) => s.toggleTasks)
  const running = useApp((s) => s.backgroundTasks.filter((x) => x.status === 'running').length)

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(conv?.title ?? '')
  const [menu, setMenu] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [transcript, setTranscript] = useState(false)

  useEffect(() => setValue(conv?.title ?? ''), [conv?.title])

  if (!conv) return <header className="titlebar" />

  const commit = (): void => {
    setEditing(false)
    if (value.trim() && value !== conv.title) rename(convId, value)
  }
  const close = (): void => {
    setMenu(false)
    setColorOpen(false)
  }
  const localPath = conv.target?.type === 'local' ? conv.target.path : ''
  const isLocalCode = conv.section === 'code' && !!localPath

  return (
    <header className="titlebar">
      <span className="titlebar-doc">▤</span>
      {editing ? (
        <input
          className="titlebar-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      ) : (
        <span className="titlebar-title" onDoubleClick={() => setEditing(true)} title={conv.title}>
          {conv.title}
        </span>
      )}
      {conv.target &&
        (conv.target.type === 'ssh' ? (
          <>
            <span className="titlebar-chip" title={conv.target.label}>
              🖥️ {conv.target.label}
            </span>
            <span className="titlebar-chip" title={conv.target.cwd || '~'}>
              📁 {conv.target.cwd ? conv.target.cwd.split(/[\\/]/).filter(Boolean).pop() : '~'}
            </span>
          </>
        ) : (
          <span className="titlebar-chip" title={conv.target.path}>
            📁 {conv.target.path.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        ))}
      <div className="titlebar-spacer" />

      <button className="icon-btn tasks-toggle" onClick={toggleTasks} title={t('backgroundTasks')}>
        🗂{running > 0 && <span className="task-badge">{running}</span>}
      </button>

      <div className="menu-wrap">
        <button className="icon-btn" onClick={() => setMenu((v) => !v)} title={t('options')}>
          ⋮
        </button>
        {menu && (
          <>
            <div className="menu-backdrop" onClick={close} />
            <div className="menu">
              {isLocalCode && (
                <button className="menu-item" onClick={() => { close(); window.api.app.showPath(localPath) }}>
                  📂 {t('files')}
                </button>
              )}
              <button className="menu-item" onClick={() => { close(); toggleTasks() }}>
                {t('backgroundTasks')}
              </button>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { close(); setEditing(true) }}>
                {t('rename')}
              </button>
              <button className="menu-item" onClick={() => setColorOpen((v) => !v)}>
                {t('color')} ›
              </button>
              {colorOpen && (
                <div className="color-row">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`color-swatch ${conv.color === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => { setConvColor(convId, c); close() }}
                    />
                  ))}
                </div>
              )}
              <button className="menu-item" onClick={() => { close(); setTranscript(true) }}>
                {t('transcript')}
              </button>
              <button className="menu-item" onClick={() => { close(); duplicate(convId) }}>
                {t('duplicate')}
              </button>
              {onChangeTarget && (
                <button className="menu-item" onClick={() => { close(); onChangeTarget() }}>
                  {t('changeTarget')}
                </button>
              )}
              <button className="menu-item" onClick={() => { close(); clearConv(convId) }}>
                {t('clearMessages')}
              </button>
              <button className="menu-item" onClick={() => { close(); archive(convId) }}>
                {t('archive')}
              </button>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => { close(); remove(convId) }}>
                {t('delete')}
              </button>
            </div>
          </>
        )}
      </div>

      {transcript && <TranscriptModal title={conv.title} text={transcriptText(conv.messages, t('you').toUpperCase(), t('assistantRole').toUpperCase())} onClose={() => setTranscript(false)} />}
    </header>
  )
}

function transcriptText(messages: { role: string; content: string }[], youLabel: string, assistantLabel: string): string {
  return messages.map((m) => `### ${m.role === 'user' ? youLabel : assistantLabel}\n${m.content}`).join('\n\n')
}

function TranscriptModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="titlebar-title">{title}</span>
          <div className="titlebar-spacer" />
          <button className="ghost-btn small" onClick={() => window.api.app.copyText(text)}>
            {t('copy')}
          </button>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <pre className="modal-body">{text}</pre>
      </div>
    </div>
  )
}
