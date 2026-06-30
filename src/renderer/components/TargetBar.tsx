import { useEffect, useState } from 'react'
import type { SavedSshHost, SshSession } from '@shared/types'
import { useApp } from '../store'
import { useT } from '../lib/i18n'
import { SshForm, RemoteFolderBrowser } from './TargetPicker'

const baseName = (p: string): string => {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

type Modal = { kind: 'sshform'; host?: SavedSshHost } | { kind: 'browse'; sessionId: string }

/** Barre de cible (style Claude Code) : chips Environnement + Répertoire avec menus déroulants. */
export function TargetBar({ convId }: { convId: string }): JSX.Element {
  const t = useT()
  const conv = useApp((s) => s.conversations[convId])
  const sshHosts = useApp((s) => s.sshHosts)
  const setConvTarget = useApp((s) => s.setConvTarget)
  const refreshSshHosts = useApp((s) => s.refreshSshHosts)
  const recentDirs = useApp((s) => s.recentDirs)
  const addRecentDir = useApp((s) => s.addRecentDir)

  const [sessions, setSessions] = useState<SshSession[]>([])
  const [menu, setMenu] = useState<null | 'env' | 'dir'>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.ssh.list().then(setSessions)
  }, [menu, modal])

  if (!conv) return <></>

  const target = conv.target
  const ssh = target?.type === 'ssh' ? target : null
  const local = target?.type === 'local' ? target : null
  const envKey = ssh ? ssh.sessionId : 'local'
  const cwd = ssh ? ssh.cwd : local ? local.path : ''

  const liveFor = (id: string): SshSession | undefined => sessions.find((s) => s.id === id && s.connected)
  const close = (): void => setMenu(null)

  const applyLocal = (path: string): void => {
    setConvTarget(convId, { type: 'local', path })
    addRecentDir('local', path)
  }
  const applySsh = (id: string, label: string, dir: string): void => {
    setConvTarget(convId, { type: 'ssh', sessionId: id, label, cwd: dir })
    if (dir) addRecentDir(id, dir)
  }

  const pickLocal = async (): Promise<void> => {
    close()
    const dir = await window.api.fs.selectFolder()
    if (dir) applyLocal(dir)
  }

  const pickHost = async (h: SavedSshHost): Promise<void> => {
    close()
    setError(null)
    // Hôte migré (v0.6) sans mot de passe stocké : il FAUT le ressaisir → formulaire.
    if (h.needsSecret) {
      setModal({ kind: 'sshform', host: h })
      return
    }
    setConnecting(h.id)
    try {
      if (!liveFor(h.id)) await window.api.ssh.connectHost(h.id)
      const recent = recentDirs[h.id]?.[0]
      applySsh(h.id, h.label, recent ?? '')
      if (!recent) setModal({ kind: 'browse', sessionId: h.id }) // choisir le dossier de travail
    } catch (e: any) {
      // Hôte AVEC secret mais échec (réseau, hôte injoignable) : on signale sans rouvrir le form.
      setError(`${h.label} — ${e?.message ?? 'connexion impossible'}`)
    } finally {
      setConnecting(null)
    }
  }

  const pickDir = (p: string): void => {
    close()
    if (ssh) applySsh(ssh.sessionId, ssh.label, p)
    else applyLocal(p)
  }

  const browse = (): void => {
    close()
    if (ssh) setModal({ kind: 'browse', sessionId: ssh.sessionId })
    else void pickLocal()
  }

  const envLabel = ssh ? ssh.label : local ? t('localFolder') : t('selectEnv')
  const dirLabel = cwd ? baseName(cwd) : ssh ? '~' : ''
  const recents = recentDirs[envKey] ?? []

  return (
    <div className="composer-chips target-bar">
      {/* Chip Environnement */}
      <div className="chip-wrap">
        <button
          className={`composer-chip chip-btn ${!target ? 'chip-accent' : ''}`}
          onClick={() => { setError(null); setMenu(menu === 'env' ? null : 'env') }}
        >
          <span className="chip-ico">{ssh ? '🖥️' : '💻'}</span> {envLabel}
        </button>
        {menu === 'env' && (
          <>
            <div className="menu-backdrop" onClick={close} />
            <div className="menu target-menu up">
              <button className="menu-item flex-item" onClick={pickLocal}>
                <span className="chip-ico">💻</span>
                <span className="grow">{t('localFolder')}</span>
                {local && <span className="menu-check">✓</span>}
              </button>
              <div className="menu-section">SSH</div>
              {sshHosts.map((h) => (
                <div key={h.id} className="menu-item flex-item host-item" onClick={() => pickHost(h)}>
                  <span className="conv-dot" style={{ background: liveFor(h.id) ? 'var(--ok)' : 'var(--muted)' }} />
                  <span className="grow host-name">{h.label}</span>
                  {connecting === h.id && <span className="muted small">{t('connecting')}</span>}
                  {ssh?.sessionId === h.id && <span className="menu-check">✓</span>}
                  <span
                    className="host-edit"
                    title={t('editHost')}
                    onClick={(e) => {
                      e.stopPropagation()
                      close()
                      setModal({ kind: 'sshform', host: h })
                    }}
                  >
                    ⚙
                  </span>
                </div>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { close(); setModal({ kind: 'sshform' }) }}>
                {t('addSshHostItem')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Chip Répertoire */}
      {target && (
        <div className="chip-wrap">
          <button className="composer-chip chip-btn" onClick={() => setMenu(menu === 'dir' ? null : 'dir')}>
            <span className="chip-ico">📁</span> {dirLabel || t('selectFolderShort')}
          </button>
          {menu === 'dir' && (
            <>
              <div className="menu-backdrop" onClick={close} />
              <div className="menu target-menu up">
                <div className="menu-section">{t('recents')}</div>
                {recents.length === 0 && <div className="menu-empty">{t('noRecentDirs')}</div>}
                {recents.map((p) => (
                  <button key={p} className="menu-item flex-item" onClick={() => pickDir(p)} title={p}>
                    <span className="grow host-name">{baseName(p)}</span>
                    {cwd === p && <span className="menu-check">✓</span>}
                  </button>
                ))}
                <div className="menu-sep" />
                <button className="menu-item" onClick={browse}>
                  {ssh ? t('browseRemote') : t('browseLocal')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {local && <LocalGitChips path={local.path} msgCount={conv.messages.length} />}
      {error && <span className="chip-error">⚠ {error}</span>}

      {/* Modales */}
      {modal?.kind === 'sshform' && (
        <ModalShell onClose={() => setModal(null)}>
          <SshForm
            initial={modal.host}
            onConnected={(s) => {
              refreshSshHosts()
              applySsh(s.sessionId, s.label, recentDirs[s.sessionId]?.[0] ?? '')
              setModal({ kind: 'browse', sessionId: s.sessionId })
            }}
            onBack={() => setModal(null)}
          />
        </ModalShell>
      )}
      {modal?.kind === 'browse' && (
        <ModalShell onClose={() => setModal(null)}>
          <RemoteFolderBrowser
            sessionId={modal.sessionId}
            onSelect={(dir) => {
              const sid = modal.sessionId
              const label = sshHosts.find((h) => h.id === sid)?.label ?? (ssh ? ssh.label : 'SSH')
              applySsh(sid, label, dir)
              setModal(null)
            }}
            onCancel={() => setModal(null)}
          />
        </ModalShell>
      )}
    </div>
  )
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal target-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function LocalGitChips({ path, msgCount }: { path: string; msgCount: number }): JSX.Element | null {
  const [branch, setBranch] = useState('')
  const [diff, setDiff] = useState({ added: 0, removed: 0 })

  useEffect(() => {
    if (!path) return
    window.api.app.gitBranch(path).then(setBranch)
    window.api.app.gitDiff(path).then(setDiff)
  }, [path, msgCount])

  if (!branch && diff.added === 0 && diff.removed === 0) return null
  return (
    <>
      {branch && <span className="composer-chip">⎇ {branch}</span>}
      <span className="titlebar-spacer" />
      {(diff.added > 0 || diff.removed > 0) && (
        <span className="diff-stats">
          <span className="diff-add">+{diff.added}</span> <span className="diff-rem">−{diff.removed}</span>
        </span>
      )}
    </>
  )
}
