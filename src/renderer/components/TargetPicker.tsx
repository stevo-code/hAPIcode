import { useEffect, useState } from 'react'
import type { SavedSshHost, SshSession } from '@shared/types'
import { useApp } from '../store'
import { useT } from '../lib/i18n'

type SessionRef = { sessionId: string; label: string }

export function TargetPicker({ convId }: { convId: string }): JSX.Element {
  const t = useT()
  const setConvTarget = useApp((s) => s.setConvTarget)
  const sshHosts = useApp((s) => s.sshHosts)
  const [view, setView] = useState<'choice' | 'form' | 'browse'>('choice')
  const [editing, setEditing] = useState<SavedSshHost | undefined>(undefined)
  const [session, setSession] = useState<SessionRef | null>(null)
  const [sessions, setSessions] = useState<SshSession[]>([])
  const [connectingId, setConnectingId] = useState<string | null>(null)

  useEffect(() => {
    window.api.ssh.list().then(setSessions)
  }, [view])

  // La session porte desormais l'id de l'hote : correspondance directe.
  const liveFor = (h: SavedSshHost): SshSession | undefined =>
    sessions.find((s) => s.id === h.id && s.connected)

  const pickLocal = async (): Promise<void> => {
    const dir = await window.api.fs.selectFolder()
    if (dir) setConvTarget(convId, { type: 'local', path: dir })
  }

  // Reconnexion en un clic : le secret est repris du stockage chiffre (pas de ressaisie).
  const useHost = async (h: SavedSshHost): Promise<void> => {
    setConnectingId(h.id)
    try {
      const live = liveFor(h) ?? (await window.api.ssh.connectHost(h.id))
      setSession({ sessionId: live.id, label: h.label })
      setView('browse')
    } catch {
      // Echec (hote modifie, secret invalide…) : on rouvre le formulaire pre-rempli.
      setEditing(h)
      setView('form')
    } finally {
      setConnectingId(null)
    }
  }

  if (view === 'form') {
    return (
      <SshForm
        initial={editing}
        onConnected={(s) => {
          setSession(s)
          setView('browse')
        }}
        onBack={() => setView('choice')}
      />
    )
  }

  if (view === 'browse' && session) {
    return (
      <RemoteFolderBrowser
        sessionId={session.sessionId}
        onSelect={(cwd) => setConvTarget(convId, { type: 'ssh', sessionId: session.sessionId, label: session.label, cwd })}
        onCancel={() => setView('choice')}
      />
    )
  }

  return (
    <div className="target-picker">
      <div className="empty-emoji">{'</>'}</div>
      <h2>{t('whereToWork')}</h2>
      <p>{t('whereToWorkText')}</p>

      <div className="target-choices">
        <button className="target-card" onClick={pickLocal}>
          <div className="target-ico">📁</div>
          <div className="target-name">{t('localFolder')}</div>
          <div className="target-desc">{t('localFolderDesc')}</div>
        </button>
        <button
          className="target-card"
          onClick={() => {
            setEditing(undefined)
            setView('form')
          }}
        >
          <div className="target-ico">🖥️</div>
          <div className="target-name">{t('sshConnection')}</div>
          <div className="target-desc">{t('sshConnectionDesc')}</div>
        </button>
      </div>

      {sshHosts.length > 0 && (
        <div className="saved-hosts">
          <div className="saved-hosts-head">{t('savedHosts')}</div>
          {sshHosts.map((h) => {
            const live = liveFor(h)
            const connecting = connectingId === h.id
            return (
              <button key={h.id} className="saved-host" onClick={() => useHost(h)} disabled={connecting}>
                <span className="conv-dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
                <span className="saved-host-label">{h.label}</span>
                <span className="muted small">
                  {h.username}@{h.host}
                </span>
                <span className="saved-host-state">
                  {connecting ? t('connecting') : live ? `✓ ${t('connected')}` : t('reconnect')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SshForm({
  initial,
  onConnected,
  onBack
}: {
  initial?: SavedSshHost
  onConnected: (s: SessionRef) => void
  onBack: () => void
}): JSX.Element {
  const t = useT()
  const refreshSshHosts = useApp((s) => s.refreshSshHosts)
  const [auth, setAuth] = useState<'password' | 'key'>(initial?.auth ?? 'password')
  const [f, setF] = useState({
    label: initial?.label ?? '',
    host: initial?.host ?? '',
    port: String(initial?.port ?? 22),
    username: initial?.username ?? '',
    password: '',
    privateKeyPath: initial?.privateKeyPath ?? '',
    passphrase: ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  const canConnect = !busy && !!f.host.trim() && !!f.username.trim()
  // « Entrée » dans n'importe quel champ déclenche la connexion.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (canConnect) void connect()
    }
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // Enregistre (secret chiffre via safeStorage) PUIS connecte ; la session porte l'id de l'hote.
      const session = await window.api.ssh.saveAndConnect({
        id: initial?.id,
        label: f.label || `${f.username}@${f.host}`,
        host: f.host,
        port: Number(f.port) || 22,
        username: f.username,
        auth,
        ...(auth === 'password'
          ? { password: f.password }
          : { privateKeyPath: f.privateKeyPath, passphrase: f.passphrase || undefined })
      })
      await refreshSshHosts()
      onConnected({ sessionId: session.id, label: session.label })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="target-picker">
      <h2>{t('sshConnection')}</h2>
      <div className="form-grid" style={{ maxWidth: 560, textAlign: 'left' }}>
        <label>
          {t('name')}
          <input type="text" placeholder={t('phName')} value={f.label} onChange={set('label')} onKeyDown={onKey} />
        </label>
        <label>
          {t('host')}
          <input type="text" placeholder={t('phHost')} value={f.host} onChange={set('host')} onKeyDown={onKey} />
        </label>
        <label>
          {t('port')}
          <input type="text" value={f.port} onChange={set('port')} onKeyDown={onKey} />
        </label>
        <label>
          {t('user')}
          <input type="text" placeholder={t('phUser')} value={f.username} onChange={set('username')} onKeyDown={onKey} />
        </label>
        <label>
          {t('auth')}
          <select value={auth} onChange={(e) => setAuth(e.target.value as 'password' | 'key')}>
            <option value="password">{t('password')}</option>
            <option value="key">{t('privateKey')}</option>
          </select>
        </label>
        {auth === 'password' ? (
          <label>
            {t('password')}
            <input type="password" autoFocus={!!initial} value={f.password} onChange={set('password')} onKeyDown={onKey} />
          </label>
        ) : (
          <label>
            {t('privateKeyPath')}
            <input type="text" placeholder="~/.ssh/id_rsa" value={f.privateKeyPath} onChange={set('privateKeyPath')} onKeyDown={onKey} />
          </label>
        )}
      </div>
      {error && <div className="test-result ko" style={{ maxWidth: 560 }}>✗ {error}</div>}
      <div className="form-actions" style={{ maxWidth: 560 }}>
        <button className="ghost-btn" onClick={onBack}>
          {t('back')}
        </button>
        <button className="primary-btn" onClick={connect} disabled={busy || !f.host || !f.username}>
          {busy ? t('connecting') : t('connect')}
        </button>
      </div>
    </div>
  )
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function RemoteFolderBrowser({
  sessionId,
  onSelect,
  onCancel
}: {
  sessionId: string
  onSelect: (path: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [pathInput, setPathInput] = useState('.')
  const [current, setCurrent] = useState('')
  const [entries, setEntries] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const load = async (p: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.ssh.exec(sessionId, `cd ${shq(p)} && pwd && echo '###CCC###' && ls -1Ap`)
      if (r.code !== 0) {
        setError(r.stderr.trim() || t('cdFailed'))
        return
      }
      const [pwdPart, lsPart = ''] = r.stdout.split('###CCC###')
      const abs = pwdPart.trim() || p
      const folders = lsPart
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.endsWith('/') && s !== './' && s !== '../')
        .map((s) => s.slice(0, -1))
        .sort((a, b) => a.localeCompare(b))
      setCurrent(abs)
      setPathInput(abs)
      setEntries(folders)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  const createFolder = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || !current) return
    const r = await window.api.ssh.exec(sessionId, `mkdir -p ${shq(`${current}/${name}`)}`)
    if (r.code !== 0) {
      setError(r.stderr.trim() || t('mkdirFailed'))
      return
    }
    setNewName('')
    load(current)
  }

  useEffect(() => {
    load('.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="target-picker">
      <h2>{t('selectRemoteFolder')}</h2>
      <div className="remote-browser">
        <div className="remote-path-row">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(pathInput)}
          />
          <button className="ghost-btn" onClick={() => load(pathInput)}>
            {t('go')}
          </button>
        </div>
        {error && <div className="test-result ko">✗ {error}</div>}
        <div className="remote-newfolder">
          <input
            placeholder={t('folderName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <button className="ghost-btn" onClick={createFolder} disabled={!newName.trim()}>
            📁＋ {t('newFolder')}
          </button>
        </div>
        <div className="remote-list">
          <div className="remote-item" onClick={() => load(`${current || '.'}/..`)}>
            📁 ..
          </div>
          {loading && <div className="recents-empty">{t('loadingModels')}</div>}
          {!loading &&
            entries.map((dir) => (
              <div key={dir} className="remote-item" onClick={() => load(`${current}/${dir}`)}>
                📁 {dir}
              </div>
            ))}
        </div>
        <div className="form-actions">
          <button className="ghost-btn" onClick={onCancel}>
            {t('back')}
          </button>
          <button className="primary-btn" onClick={() => onSelect(current)} disabled={!current}>
            {t('selectThisFolder')}
          </button>
        </div>
      </div>
    </div>
  )
}
