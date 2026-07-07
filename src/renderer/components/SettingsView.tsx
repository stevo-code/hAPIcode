import { useEffect, useState } from 'react'
import { PROVIDER_PRESETS, getPreset, type ProviderKind } from '@shared/providers'
import { useApp } from '../store'
import { useT } from '../lib/i18n'
import { SkillsCard } from './SkillsCard'

export function SettingsView(): JSX.Element {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const setLang = useApp((s) => s.setLang)
  const appVersion = useApp((s) => s.appVersion)
  const credentials = useApp((s) => s.credentials)
  const refreshCredentials = useApp((s) => s.refreshCredentials)
  const refreshModels = useApp((s) => s.refreshModels)

  const [providerId, setProviderId] = useState('openai')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [kind, setKind] = useState<ProviderKind>('openai')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [encAvailable, setEncAvailable] = useState(true)
  const [startWithSystem, setStartWithSystem] = useState(false)

  const preset = getPreset(providerId)
  const isCustom = !!preset?.custom

  useEffect(() => {
    window.api.settings.encryptionAvailable().then(setEncAvailable)
    window.api.app.getLoginItem().then(setStartWithSystem)
  }, [])

  const toggleStartWithSystem = async (): Promise<void> => {
    const next = !startWithSystem
    setStartWithSystem(next) // optimiste
    try {
      // On reflète l'état RÉELLEMENT appliqué (false si Windows a refusé l'entrée de démarrage).
      const effective = await window.api.app.setLoginItem(next)
      setStartWithSystem(effective)
    } catch {
      setStartWithSystem(!next) // échec : on restaure
    }
  }

  const buildInput = () => ({
    providerId,
    label: label.trim() || preset?.name || providerId,
    apiKey: apiKey.trim(),
    ...(isCustom ? { baseUrl: baseUrl.trim(), kind } : {})
  })

  const onTest = async (): Promise<void> => {
    if (!apiKey.trim()) return
    setBusy(true)
    setTest(null)
    const r = await window.api.settings.testCredential(buildInput())
    setTest(
      r.ok
        ? { ok: true, msg: `${t('connectionOk')} — ${r.models ?? 0} ${t('modelsFound')}` }
        : { ok: false, msg: r.error ?? t('failed') }
    )
    setBusy(false)
  }

  const onAdd = async (): Promise<void> => {
    if (!apiKey.trim()) return
    setBusy(true)
    try {
      await window.api.settings.addCredential(buildInput())
      setApiKey('')
      setLabel('')
      setBaseUrl('')
      setTest(null)
      await refreshCredentials()
      await refreshModels()
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (id: string): Promise<void> => {
    await window.api.settings.removeCredential(id)
    await refreshCredentials()
    await refreshModels()
  }

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <h1>{t('settings')}</h1>

        <section className="card">
          <h2>{t('language')}</h2>
          <div className="lang-toggle">
            <button className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>
              <span className="lang-flag">EN</span> English
            </button>
            <button className={`lang-btn ${lang === 'fr' ? 'active' : ''}`} onClick={() => setLang('fr')}>
              <span className="lang-flag">FR</span> Français
            </button>
          </div>
        </section>

        <section className="card">
          <h2>{t('general')}</h2>
          <div className="setting-row">
            <div className="setting-text">
              <span className="setting-label">{t('startWithSystem')}</span>
              <span className="muted small">{t('startWithSystemDesc')}</span>
            </div>
            <button
              className={`switch ${startWithSystem ? 'on' : ''}`}
              role="switch"
              aria-checked={startWithSystem}
              onClick={toggleStartWithSystem}
            >
              <span className="switch-knob" />
            </button>
          </div>
          <p className="muted small">{t('closeToTrayNote')}</p>
        </section>

        <SkillsCard />

        {!encAvailable && <div className="warn-banner">⚠️ {t('encWarning')}</div>}

        <section className="card">
          <h2>{t('addApiKey')}</h2>
          <div className="form-grid">
            <label>
              {t('provider')}
              <select
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value)
                  setTest(null)
                }}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t('displayName')}
              <input
                type="text"
                placeholder={preset?.name ?? t('phProviderName')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>

            {isCustom && (
              <>
                <label>
                  {t('baseUrlLabel')}
                  <input
                    type="text"
                    placeholder="https://mon-serveur/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </label>
                <label>
                  {t('apiFormat')}
                  <select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
                    <option value="openai">{t('openaiCompat')}</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
              </>
            )}

            <label className="full">
              {t('apiKeyLabel')} {preset?.keyHint && <span className="muted">({preset.keyHint})</span>}
              <input
                type="password"
                placeholder={t('phPasteKey')}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setTest(null)
                }}
              />
            </label>
          </div>

          {preset?.docsUrl && (
            <p className="muted small">
              {t('getKey')}
              <a
                className="ext-link"
                href={preset.docsUrl}
                onClick={(e) => {
                  e.preventDefault()
                  window.api.app.openExternal(preset.docsUrl)
                }}
              >
                {preset.docsUrl}
              </a>
            </p>
          )}

          {test && <div className={`test-result ${test.ok ? 'ok' : 'ko'}`}>{test.ok ? '✓ ' : '✗ '}{test.msg}</div>}

          <div className="form-actions">
            <button className="ghost-btn" onClick={onTest} disabled={busy || !apiKey.trim()}>
              {t('testBtn')}
            </button>
            <button className="primary-btn" onClick={onAdd} disabled={busy || !apiKey.trim()}>
              {t('addBtn')}
            </button>
          </div>
        </section>

        <section className="card">
          <h2>{t('savedKeys')} ({credentials.length})</h2>
          {credentials.length === 0 ? (
            <p className="muted">{t('noKeys')}</p>
          ) : (
            <ul className="cred-list">
              {credentials.map((c) => (
                <li key={c.id} className="cred-item">
                  <div className="cred-main">
                    <span className="cred-label">{c.label}</span>
                    <span className="cred-provider">{getPreset(c.providerId)?.name ?? c.providerId}</span>
                  </div>
                  <code className="cred-key">{c.maskedKey}</code>
                  <button className="danger-btn small" onClick={() => onRemove(c.id)}>
                    {t('delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="app-version">hAPIcode · {t('version')} {appVersion || '—'}</div>
      </div>
    </div>
  )
}
