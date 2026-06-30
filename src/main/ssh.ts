import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import type { SshSession } from '@shared/types'
import * as store from './store'
import type { FullSshHost } from './store'

interface Live {
  client: Client
  meta: SshSession
  /** true quand la coupure est volontaire (disconnect / remplacement) : pas de reconnexion. */
  intentional: boolean
  /** true des qu'une session a reussi au moins une fois (sur cet hote, ce process). */
  everConnected: boolean
  /** true si on doit retenter meme apres un echec qui n'a jamais abouti (hotes sauvegardes / exec). */
  retryOnFailure: boolean
  /** true si l'echec est une erreur d'AUTHENTIFICATION (mauvais mot de passe / passphrase) : on NE reboucle pas. */
  authFailed: boolean
  reconnectTimer?: NodeJS.Timeout
  attempts: number
  /** true des que la promesse de connexion est resolue OU rejetee (evite tout double-settle). */
  settled: boolean
  /** rejette la promesse de connexion EN VOL (ex. si on tue le client avant qu'elle aboutisse). */
  rejectConnect?: (err: Error) => void
}

// La cle de session EST l'id de l'hote (stable entre reconnexions et redemarrages).
const sessions = new Map<string, Live>()
// Promesses de connexion en cours, pour dedupliquer les doConnect concurrents par hote.
const connecting = new Map<string, Promise<SshSession>>()

/** Neutralise et ferme proprement un client existant (sans declencher sa reconnexion). */
function killClient(live: Live | undefined): void {
  if (!live) return
  live.intentional = true
  if (live.reconnectTimer) clearTimeout(live.reconnectTimer)
  // Rejeter une connexion EN VOL avant de retirer les listeners, sinon sa promesse reste pendante
  // (l'appelant qui fait `await doConnect(...)` resterait bloque indefiniment).
  live.rejectConnect?.(new Error('Connexion SSH interrompue'))
  try {
    live.client.removeAllListeners()
    live.client.end()
  } catch {
    /* deja ferme */
  }
}

function doConnect(full: FullSshHost, retryOnFailure: boolean): Promise<SshSession> {
  // Deduplication : une seule tentative de connexion a la fois par hote.
  const inflight = connecting.get(full.id)
  if (inflight) return inflight

  const p = new Promise<SshSession>((resolve, reject) => {
    const prev = sessions.get(full.id)
    const attempts = prev?.attempts ?? 0
    // Ferme l'ancien client AVANT de le remplacer (evite sessions fantomes + fuites de sockets/timers).
    killClient(prev)

    const client = new Client()
    const meta: SshSession = { id: full.id, label: full.label, host: full.host, username: full.username, connected: false }
    const live: Live = { client, meta, intentional: false, everConnected: false, retryOnFailure, authFailed: false, attempts, settled: false }
    sessions.set(full.id, live)

    // Settle idempotent : garantit qu'on ne resout/rejette la promesse qu'une seule fois.
    const settle = (fn: () => void): void => {
      if (live.settled) return
      live.settled = true
      live.rejectConnect = undefined
      fn()
    }
    live.rejectConnect = (err) => settle(() => reject(err))

    client
      .on('ready', () => {
        meta.connected = true
        live.everConnected = true
        live.attempts = 0
        settle(() => resolve(meta))
      })
      .on('error', (err: Error & { level?: string }) => {
        // Echec d'authentification (mauvais mot de passe / passphrase, ou secret vide d'un
        // hote migre) : inutile et nuisible de reboucler (on martèlerait le serveur).
        if (err?.level === 'client-authentication') live.authFailed = true
        settle(() => reject(new Error(err.message)))
      })
      .on('close', () => {
        meta.connected = false
        // Si la connexion se ferme avant d'avoir abouti, rejeter la promesse en attente.
        settle(() => reject(new Error('Connexion SSH fermee')))
        // Reconnexion auto seulement si : non volontaire, pas un echec d'auth, hote toujours
        // enregistre, et (session deja aboutie OU hote a maintenir = retryOnFailure).
        if (!live.intentional && !live.authFailed && (live.everConnected || live.retryOnFailure) && store.getSshHostFull(full.id)) {
          scheduleReconnect(full.id)
        }
      })

    try {
      client.connect({
        host: full.host,
        port: full.port || 22,
        username: full.username,
        ...(full.auth === 'password'
          ? { password: full.password }
          : { privateKey: full.privateKeyPath ? readFileSync(full.privateKeyPath) : undefined, passphrase: full.passphrase }),
        readyTimeout: 20000,
        // Maintien de la connexion : evite l'expiration sur inactivite.
        keepaliveInterval: 15000,
        keepaliveCountMax: 5
      })
    } catch (e: any) {
      settle(() => reject(new Error(e?.message ?? String(e))))
    }
  })

  connecting.set(full.id, p)
  const clear = (): void => {
    if (connecting.get(full.id) === p) connecting.delete(full.id)
  }
  p.then(clear, clear)
  return p
}

function scheduleReconnect(hostId: string): void {
  const live = sessions.get(hostId)
  if (!live || live.reconnectTimer) return
  const delay = Math.min(30000, 3000 * 2 ** Math.min(live.attempts, 4))
  live.attempts++
  live.reconnectTimer = setTimeout(() => {
    live.reconnectTimer = undefined
    const full = store.getSshHostFull(hostId)
    if (!full) return
    // Une session qui retombe doit continuer a etre maintenue : retryOnFailure = true.
    doConnect(full, true).catch(() => scheduleReconnect(hostId))
  }, delay)
}

/** Connecte (ou reutilise) un hote SSH enregistre, par son id. Connexion interactive : pas de boucle si echec initial. */
export async function connect(hostId: string): Promise<SshSession> {
  const existing = sessions.get(hostId)
  if (existing?.meta.connected) return existing.meta
  const full = store.getSshHostFull(hostId)
  if (!full) throw new Error('Hote SSH introuvable')
  return doConnect(full, false)
}

/** Delai max par defaut d'une commande SSH (comme le run_command local). Au-dela, on la tue. */
const EXEC_TIMEOUT_MS = 120000

export async function exec(
  hostId: string,
  command: string,
  signal?: AbortSignal,
  timeoutMs: number = EXEC_TIMEOUT_MS
): Promise<{ code: number; stdout: string; stderr: string }> {
  let live = sessions.get(hostId)
  // Si la session est tombee, on tente une reconnexion immediate (session a maintenir) avant d'echouer.
  if (!live?.meta.connected) {
    const full = store.getSshHostFull(hostId)
    if (full) {
      try {
        await doConnect(full, true)
        live = sessions.get(hostId)
      } catch {
        /* echec : on rejette plus bas */
      }
    }
  }
  if (!live?.meta.connected) throw new Error('Session SSH non disponible (reconnexion impossible)')

  const client = live.client
  return new Promise((resolve, reject) => {
    let done = false
    let timer: NodeJS.Timeout | undefined
    let detach = (): void => {}
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      detach()
      client.removeListener('close', onClientDown)
      client.removeListener('error', onClientErr)
    }
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      cleanup()
      fn()
    }
    // Garde : si le CLIENT tombe pendant la commande (coupure reseau brutale), le stream
    // n'emet pas toujours 'close'/'error'. On rejette alors explicitement pour ne jamais rester suspendu.
    const onClientDown = (): void => finish(() => reject(new Error('Connexion SSH perdue pendant la commande')))
    const onClientErr = (e: Error): void => finish(() => reject(new Error(e.message)))
    client.on('close', onClientDown)
    client.on('error', onClientErr)

    // Annulation demandee avant meme l'ouverture du canal.
    if (signal?.aborted) {
      finish(() => reject(new Error('Commande annulee')))
      return
    }

    client.exec(command, (err, stream) => {
      if (err) return finish(() => reject(new Error(err.message)))
      let stdout = ''
      let stderr = ''
      const killStream = (): void => {
        try {
          stream.signal('KILL')
        } catch {
          /* ignore */
        }
        try {
          stream.close()
        } catch {
          /* ignore */
        }
      }
      // TIMEOUT : une commande qui se fige (boucle infinie, attente d'entree...) ne doit JAMAIS
      // bloquer l'agent. On tue le processus distant et on renvoie la sortie partielle (code 124).
      timer = setTimeout(() => {
        killStream()
        finish(() =>
          resolve({
            code: 124,
            stdout,
            stderr: `${stderr}\n[Commande interrompue : delai de ${Math.round(timeoutMs / 1000)}s depasse]`
          })
        )
      }, timeoutMs)
      // ANNULATION (bouton Stop) : tue la commande distante immediatement.
      if (signal) {
        const onAbort = (): void => {
          killStream()
          finish(() => reject(new Error('Commande annulee')))
        }
        signal.addEventListener('abort', onAbort)
        detach = (): void => signal.removeEventListener('abort', onAbort)
        // Abort survenu pendant l'ouverture du canal (entre le pre-check et l'attache du listener).
        if (signal.aborted) onAbort()
      }
      stream
        .on('error', (e: Error) => finish(() => reject(new Error(e.message))))
        .on('close', (code: number) => finish(() => resolve({ code: code ?? 0, stdout, stderr })))
        .on('data', (d: Buffer) => (stdout += d.toString()))
        .stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    })
  })
}

export function list(): SshSession[] {
  return Array.from(sessions.values()).map((l) => l.meta)
}

export function disconnect(hostId: string): void {
  const live = sessions.get(hostId)
  if (live) {
    killClient(live)
    sessions.delete(hostId)
  }
  connecting.delete(hostId)
}

/** Reconnecte tous les hotes enregistres (au demarrage de l'app). Hotes a maintenir : retryOnFailure = true. */
export async function reconnectAll(): Promise<void> {
  for (const full of store.listSshHostsFull()) {
    // Hote migre par mot de passe (secret vide) : ne PAS tenter (auth echouerait en boucle).
    // L'utilisateur le reconnectera via le menu (re-saisie du mot de passe).
    if (full.needsSecret) continue
    doConnect(full, true).catch(() => {
      /* meilleur effort : scheduleReconnect prend le relais (sauf echec d'auth) */
    })
  }
}

export function disconnectAll(): void {
  for (const [id, live] of sessions) {
    killClient(live)
    connecting.delete(id)
  }
  sessions.clear()
}
