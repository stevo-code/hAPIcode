import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

/** Boutons fenetre (reduire/agrandir/fermer) flottant en haut a droite, sans barre dediee. */
export function WindowControls(): JSX.Element {
  const t = useT()
  const [max, setMax] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMax)
    return window.api.window.onMaximizeChange(setMax)
  }, [])

  return (
    <div className="win-controls">
      <button className="win-btn" onClick={() => window.api.window.minimize()} title={t('winMin')} aria-label={t('winMin')}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        className="win-btn"
        onClick={() => window.api.window.toggleMaximize()}
        title={max ? t('winRestore') : t('winMax')}
        aria-label={max ? t('winRestore') : t('winMax')}
      >
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="2" y="2.5" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M3.5 2 V1 H8.5 V6 H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button className="win-btn win-close" onClick={() => window.api.window.close()} title={t('winClose')} aria-label={t('winClose')}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.1" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  )
}
