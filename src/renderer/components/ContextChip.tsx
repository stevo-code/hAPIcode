import { useState } from 'react'
import { useApp } from '../store'
import { useT } from '../lib/i18n'

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return n % 1_000_000 === 0 ? `${n / 1_000_000}M` : `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function ringColor(pct: number): string {
  if (pct >= 75) return '#e0707a' // rouge : seuil de compactage atteint (compacte au prochain message)
  if (pct >= 50) return '#d8a657' // jaune : se remplit
  return '#4ec07a' // vert : large
}

/** Anneau SVG qui se remplit selon le pourcentage et change de couleur. */
function Ring({ pct }: { pct: number }): JSX.Element {
  const r = 7
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(100, pct) / 100)
  const color = ringColor(pct)
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" className="ctx-ring">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="2.4" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

/** Affiche une roue d'usage du contexte + la fenetre du modele ; clic = popover. */
export function ContextChip({ convId }: { convId: string }): JSX.Element | null {
  const t = useT()
  const conv = useApp((s) => s.conversations[convId])
  const selected = useApp((s) => s.selected)
  const contextUsage = useApp((s) => s.contextUsage)
  const [open, setOpen] = useState(false)
  if (!conv || !selected) return null

  // Source UNIQUE de vérité : même calcul que le store (jauge = seuil de compactage).
  const { used, window, pct, modelWindow } = contextUsage(convId)
  const remaining = Math.max(0, window - used)
  const color = ringColor(pct)

  return (
    <div className="picker">
      <button className="picker-btn ctx-chip-btn" onClick={() => setOpen((v) => !v)} title={`${t('contextWindow')} : ${used} / ${window}`}>
        <Ring pct={pct} />
        <span className="window-txt">{fmtTokens(window)}</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu picker-menu up ctx-popover">
            <div className="ctx-pop-title">{t('contextWindow')}</div>
            <div className="ctx-pop-stats">
              <span className="ctx-pop-used" style={{ color }}>
                {fmtTokens(used)}
              </span>
              <span className="ctx-pop-total">/ {fmtTokens(window)}</span>
              <span className="ctx-pop-pct" style={{ color }}>
                {pct}%
              </span>
            </div>
            <div className="ctx-bar">
              <div className="ctx-bar-fill" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
            </div>
            <div className="ctx-pop-foot muted">
              {fmtTokens(remaining)} {t('remaining')}
              {modelWindow > window ? ` · ${t('modelWindowLabel')} ${fmtTokens(modelWindow)}` : ''}
            </div>
            {modelWindow > window && <div className="ctx-pop-foot muted">{t('effectiveNote')}</div>}
          </div>
        </>
      )}
    </div>
  )
}
