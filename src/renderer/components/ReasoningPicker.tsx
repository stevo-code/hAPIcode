import { useState } from 'react'
import type { ReasoningEffort } from '@shared/types'
import type { TKey } from '@shared/i18n'
import { useApp } from '../store'
import { useT } from '../lib/i18n'

const OPTIONS: { value: ReasoningEffort; key: TKey }[] = [
  { value: 'low', key: 'reasoningLow' },
  { value: 'medium', key: 'reasoningMedium' },
  { value: 'high', key: 'reasoningHigh' },
  { value: 'xhigh', key: 'reasoningXhigh' },
  { value: 'max', key: 'reasoningMax' },
  { value: 'ultracode', key: 'reasoningUltra' }
]

export function ReasoningPicker(): JSX.Element {
  const t = useT()
  const reasoning = useApp((s) => s.reasoning)
  const setReasoning = useApp((s) => s.setReasoning)
  const [open, setOpen] = useState(false)
  const current = OPTIONS.find((o) => o.value === reasoning) ?? OPTIONS[0]

  return (
    <div className="picker">
      <button className="picker-btn reasoning-btn" onClick={() => setOpen((v) => !v)} title="Raisonnement">
        {t(current.key)}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu picker-menu up">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`menu-item ${reasoning === o.value ? 'active' : ''}`}
                onClick={() => {
                  setReasoning(o.value)
                  setOpen(false)
                }}
              >
                {t(o.key)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
