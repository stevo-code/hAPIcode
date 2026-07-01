import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UiMessage } from '@shared/types'
import { ToolCallCard } from './ToolCallCard'
import { useT } from '../lib/i18n'

interface Props {
  messages: UiMessage[]
  onApprove: (callId: string, approved: boolean) => void
  onApproveAlways: (callId: string) => void
}

export function Messages({ messages, onApprove, onApproveAlways }: Props): JSX.Element {
  return (
    <>
      {messages.map((m, i) => (
        <Bubble key={i} m={m} onApprove={onApprove} onApproveAlways={onApproveAlways} />
      ))}
    </>
  )
}

function Bubble({
  m,
  onApprove,
  onApproveAlways
}: {
  m: UiMessage
  onApprove: (id: string, ok: boolean) => void
  onApproveAlways: (id: string) => void
}): JSX.Element {
  const t = useT()
  const hasBlocks = !!m.blocks?.length
  const lastIsText = !hasBlocks || m.blocks![m.blocks!.length - 1].type === 'text'
  return (
    <div className={`msg msg-${m.role} ${m.error ? 'msg-error' : ''}`}>
      <div className="msg-role">{m.role === 'user' ? t('you') : t('assistantRole')}</div>
      <div className="msg-body">
        {m.attachments?.length ? (
          <div className="msg-attachments">
            {m.attachments.map((a, i) =>
              a.kind === 'image' && a.dataUrl ? (
                <img key={i} src={a.dataUrl} alt={a.name} className="msg-attach-img" title={a.name} />
              ) : (
                <span key={i} className="msg-attach-file" title={a.name}>
                  📄 {a.name}
                </span>
              )
            )}
          </div>
        ) : null}
        {m.reasoning && <ReasoningBlock text={m.reasoning} streaming={m.streaming && !m.content} />}
        {hasBlocks ? (
          // Texte et commandes ENTRELACÉS dans l'ordre chronologique.
          m.blocks!.map((b, i) =>
            b.type === 'text' ? (
              b.text ? <Content key={i} content={b.text} /> : null
            ) : (
              <ToolCallCard key={b.tool.callId} entry={b.tool} onApprove={onApprove} onApproveAlways={onApproveAlways} />
            )
          )
        ) : (
          // Anciennes conversations (avant les blocs) : outils puis texte.
          <>
            {m.tools?.map((t2) => (
              <ToolCallCard key={t2.callId} entry={t2} onApprove={onApprove} onApproveAlways={onApproveAlways} />
            ))}
            {m.content && <Content content={m.content} />}
          </>
        )}
        {m.streaming && lastIsText && <span className="cursor">▋</span>}
      </div>
    </div>
  )
}

function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="reasoning-block">
      <div className="reasoning-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span> 💭 Réflexion {streaming && <span className="cursor">▋</span>}
      </div>
      {open && <pre className="reasoning-text">{text}</pre>}
    </div>
  )
}

function Content({ content }: { content: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) window.api.app.openExternal(href)
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Bloc de code avec bouton « Copier tout ». */
function CodeBlock({ children }: { children?: React.ReactNode }): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    const text = ref.current?.innerText ?? ''
    await window.api.app.copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="code-wrap">
      <button className={`code-copy ${copied ? 'done' : ''}`} onClick={copy} title={t('copy')}>
        {copied ? `✓ ${t('copied')}` : `⧉ ${t('copy')}`}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}
