import { useMemo, useState } from 'react'
import { contextWindowFor } from '@shared/providers'
import { useApp } from '../store'
import { useT } from '../lib/i18n'
import { fmtTokens } from './ContextChip'

export function ModelPicker(): JSX.Element {
  const t = useT()
  const models = useApp((s) => s.models)
  const selected = useApp((s) => s.selected)
  const select = useApp((s) => s.select)
  const loading = useApp((s) => s.loadingModels)
  const refreshModels = useApp((s) => s.refreshModels)
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, typeof models>()
    for (const m of models) {
      const key = `${m.providerLabel}::${m.credentialId}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries())
  }, [models])

  if (loading) return <span className="picker-btn muted">{t('loadingModels')}</span>
  if (models.length === 0) return <span className="picker-btn muted">{t('noModels')}</span>

  return (
    <div className="picker">
      <button className="picker-btn" onClick={() => setOpen((v) => !v)} title={selected?.model}>
        {selected?.model ?? '—'}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu picker-menu up models-menu">
            <button className="menu-item refresh" onClick={() => refreshModels()}>
              ⟳ {t('refresh')}
            </button>
            <div className="menu-sep" />
            {groups.map(([key, list]) => (
              <div key={key}>
                <div className="menu-group">{list[0].providerLabel}</div>
                {list.map((m) => {
                  const isSel = selected?.credentialId === m.credentialId && selected?.model === m.id
                  return (
                    <button
                      key={`${m.credentialId}::${m.id}`}
                      className={`menu-item model-item ${isSel ? 'active' : ''}`}
                      onClick={() => {
                        select({ credentialId: m.credentialId, model: m.id })
                        setOpen(false)
                      }}
                    >
                      <span className="mi-name">{m.label}</span>
                      <span className="mi-win">{fmtTokens(contextWindowFor(m.id))}</span>
                      {isSel && <span className="mi-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
