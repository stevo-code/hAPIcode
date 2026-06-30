import { contextWindowFor, estimateTokens } from '@shared/providers'
import { useApp } from '../store'
import { useT } from '../lib/i18n'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function ContextMeter({ convId }: { convId: string }): JSX.Element | null {
  const t = useT()
  const conv = useApp((s) => s.conversations[convId])
  const selected = useApp((s) => s.selected)
  if (!conv || !selected) return null
  const window = contextWindowFor(selected.model)
  const chars = conv.messages.reduce((s, m) => s + m.content.length + (m.reasoning?.length ?? 0), 0)
  const used = estimateTokens(chars)
  const pct = Math.min(100, Math.round((used / window) * 100))
  return (
    <span className={`ctx-meter ${pct >= 85 ? 'warn' : ''}`} title={`${t('context')} : ${used} / ${window} tokens`}>
      {t('context')} {fmt(used)}/{fmt(window)} ({pct}%)
    </span>
  )
}
