import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings, Credential, NewCredentialInput, SavedSshHost, SshHostInput } from '@shared/types'
import { getPreset, type ProviderKind } from '@shared/providers'

interface StoredCredential {
  id: string
  providerId: string
  label: string
  kind: ProviderKind
  baseUrl: string
  maskedKey: string
  createdAt: number
  /** Cle chiffree (base64). */
  enc: string
  /** true si chiffree via OS keychain, false si simple base64 (fallback). */
  encrypted: boolean
}

/** Hote SSH avec secret chiffre (pour reconnexion automatique). */
interface StoredSshHost {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  privateKeyPath?: string
  /** Secret chiffre (mot de passe ou passphrase) en base64. */
  enc: string
  encrypted: boolean
  /** true si migre depuis l'ancien format (v0.6) SANS secret : reconnexion impossible tant
   *  que l'utilisateur ne s'est pas reconnecte une fois (re-saisie du mot de passe). */
  migrated?: boolean
}

export interface FullSshHost {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  privateKeyPath?: string
  password?: string
  passphrase?: string
  /** true quand le secret necessaire (mot de passe) est manquant : ne PAS reconnecter en auto. */
  needsSecret: boolean
}

interface StoreShape {
  credentials: StoredCredential[]
  sshHosts: StoredSshHost[]
  settings: AppSettings
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark'
}

let storePath = ''
let cache: StoreShape | null = null

function file(): string {
  if (!storePath) storePath = join(app.getPath('userData'), 'cccc-store.json')
  return storePath
}

function load(): StoreShape {
  if (cache) return cache
  if (existsSync(file())) {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf-8')) as Partial<StoreShape>
      const sshHosts: StoredSshHost[] = [...(raw.sshHosts ?? [])]
      const settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }

      // Migration : anciens hotes SSH stockes dans settings.sshHosts (v0.6, sans secret)
      // -> nouveau stockage chiffre. L'hote reapparait dans la liste ; pour un hote par
      // mot de passe il faudra se reconnecter une fois (le secret sera alors chiffre).
      const legacy = (settings as { sshHosts?: SavedSshHost[] }).sshHosts
      if (Array.isArray(legacy) && legacy.length) {
        const have = new Set(sshHosts.map((h) => h.id))
        for (const lh of legacy) {
          if (lh?.id && !have.has(lh.id)) {
            sshHosts.push({
              id: lh.id,
              label: lh.label || `${lh.username}@${lh.host}`,
              host: lh.host,
              port: lh.port || 22,
              username: lh.username,
              auth: lh.auth || 'password',
              privateKeyPath: lh.privateKeyPath,
              enc: '',
              encrypted: false,
              migrated: true
            })
          }
        }
        delete (settings as { sshHosts?: SavedSshHost[] }).sshHosts
      }

      cache = { credentials: raw.credentials ?? [], sshHosts, settings }
      // Persistance de la migration : non fatale (un echec d'ecriture ne doit jamais
      // faire retomber sur un store vide ; on garde le cache en memoire).
      if (Array.isArray(legacy) && legacy.length) {
        try {
          persist()
        } catch {
          /* on reessaiera a la prochaine ecriture */
        }
      }
      return cache
    } catch {
      // fichier corrompu : on repart proprement
    }
  }
  cache = { credentials: [], sshHosts: [], settings: { ...DEFAULT_SETTINGS } }
  return cache
}

function persist(): void {
  if (!cache) return
  writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf-8')
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encrypt(plain: string): { enc: string; encrypted: boolean } {
  if (encryptionAvailable()) {
    return { enc: safeStorage.encryptString(plain).toString('base64'), encrypted: true }
  }
  // Fallback : pas de keychain dispo (ex: Linux sans libsecret). Obfuscation simple.
  return { enc: Buffer.from(plain, 'utf-8').toString('base64'), encrypted: false }
}

function decrypt(c: StoredCredential): string {
  const buf = Buffer.from(c.enc, 'base64')
  if (c.encrypted) return safeStorage.decryptString(buf)
  return buf.toString('utf-8')
}

function mask(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return '****'
  return `${k.slice(0, 4)}****${k.slice(-4)}`
}

function toPublic(c: StoredCredential): Credential {
  return {
    id: c.id,
    providerId: c.providerId,
    label: c.label,
    kind: c.kind,
    baseUrl: c.baseUrl,
    maskedKey: c.maskedKey,
    createdAt: c.createdAt
  }
}

/** Resout kind + baseUrl a partir du preset ou des valeurs fournies. */
export function resolveProvider(input: NewCredentialInput): { kind: ProviderKind; baseUrl: string } {
  const preset = getPreset(input.providerId)
  const kind = input.kind ?? preset?.kind ?? 'openai'
  let baseUrl = (input.baseUrl ?? preset?.baseUrl ?? '').trim().replace(/\/$/, '')
  if (!baseUrl) baseUrl = preset?.baseUrl ?? ''
  return { kind, baseUrl }
}

export function listCredentials(): Credential[] {
  return load().credentials.map(toPublic)
}

export function addCredential(input: NewCredentialInput): Credential {
  const s = load()
  const { kind, baseUrl } = resolveProvider(input)
  const { enc, encrypted } = encrypt(input.apiKey)
  const cred: StoredCredential = {
    id: randomUUID(),
    providerId: input.providerId,
    label: input.label.trim() || getPreset(input.providerId)?.name || input.providerId,
    kind,
    baseUrl,
    maskedKey: mask(input.apiKey),
    createdAt: Date.now(),
    enc,
    encrypted
  }
  s.credentials.push(cred)
  persist()
  return toPublic(cred)
}

export function removeCredential(id: string): void {
  const s = load()
  s.credentials = s.credentials.filter((c) => c.id !== id)
  persist()
}

export function getCredential(id: string): StoredCredential | undefined {
  return load().credentials.find((c) => c.id === id)
}

export function getRawKey(id: string): string {
  const c = getCredential(id)
  if (!c) throw new Error('Credential introuvable')
  return decrypt(c)
}

export function getSettings(): AppSettings {
  return load().settings
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const s = load()
  s.settings = { ...s.settings, ...patch }
  persist()
  return s.settings
}

/* --------------------------------- Hotes SSH ---------------------------------- */

function toPublicHost(h: StoredSshHost): SavedSshHost {
  return {
    id: h.id,
    label: h.label,
    host: h.host,
    port: h.port,
    username: h.username,
    auth: h.auth,
    privateKeyPath: h.privateKeyPath,
    needsSecret: !!h.migrated && h.auth === 'password'
  }
}

export function listSshHosts(): SavedSshHost[] {
  return load().sshHosts.map(toPublicHost)
}

export function upsertSshHost(input: SshHostInput): SavedSshHost {
  const s = load()
  const id = input.id ?? randomUUID()
  const secret = input.auth === 'password' ? input.password ?? '' : input.passphrase ?? ''
  const { enc, encrypted } = encrypt(secret)
  const host: StoredSshHost = {
    id,
    label: input.label || `${input.username}@${input.host}`,
    host: input.host,
    port: input.port || 22,
    username: input.username,
    auth: input.auth,
    privateKeyPath: input.privateKeyPath,
    enc,
    encrypted
  }
  const i = s.sshHosts.findIndex((h) => h.id === id)
  if (i >= 0) s.sshHosts[i] = host
  else s.sshHosts.push(host)
  persist()
  return toPublicHost(host)
}

export function removeSshHost(id: string): void {
  const s = load()
  s.sshHosts = s.sshHosts.filter((h) => h.id !== id)
  persist()
}

function toFull(h: StoredSshHost): FullSshHost {
  let secret = ''
  try {
    const buf = Buffer.from(h.enc, 'base64')
    secret = h.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch {
    secret = ''
  }
  return {
    id: h.id,
    label: h.label,
    host: h.host,
    port: h.port,
    username: h.username,
    auth: h.auth,
    privateKeyPath: h.privateKeyPath,
    password: h.auth === 'password' ? secret : undefined,
    passphrase: h.auth === 'key' ? secret || undefined : undefined,
    // Un hote par mot de passe migre (sans secret) ne peut pas se reconnecter seul.
    needsSecret: !!h.migrated && h.auth === 'password'
  }
}

export function getSshHostFull(id: string): FullSshHost | undefined {
  const h = load().sshHosts.find((x) => x.id === id)
  return h ? toFull(h) : undefined
}

export function listSshHostsFull(): FullSshHost[] {
  return load().sshHosts.map(toFull)
}
