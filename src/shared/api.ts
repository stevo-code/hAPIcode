import type {
  AppSettings,
  BgTask,
  ChatEvent,
  ChatMessage,
  ChatStartRequest,
  Conversation,
  Credential,
  DirEntry,
  ModelInfo,
  NewCredentialInput,
  SavedSshHost,
  SshHostInput,
  SshSession,
  StreamId
} from './types'

/** Surface exposee au renderer via le preload (contextBridge). */
export interface RendererApi {
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    listCredentials(): Promise<Credential[]>
    addCredential(input: NewCredentialInput): Promise<Credential>
    removeCredential(id: string): Promise<void>
    /** Teste une cle (ping listModels) sans l'enregistrer. */
    testCredential(input: NewCredentialInput): Promise<{ ok: boolean; error?: string; models?: number }>
    encryptionAvailable(): Promise<boolean>
  }
  providers: {
    listModels(credentialId: string): Promise<ModelInfo[]>
    /** Tous les modeles de toutes les cles enregistrees. */
    listAllModels(): Promise<ModelInfo[]>
  }
  chat: {
    start(req: ChatStartRequest): Promise<StreamId>
    cancel(streamId: StreamId): Promise<void>
    /** Reponse a une demande d'approbation d'outil (section Code). */
    approve(streamId: StreamId, callId: string, approved: boolean): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): () => void
    /** Compacte une conversation : renvoie un resume des messages fournis. */
    summarize(req: { credentialId: string; model: string; messages: ChatMessage[] }): Promise<string>
    /** Genere un titre court pour la conversation. */
    title(req: { credentialId: string; model: string; messages: ChatMessage[] }): Promise<string>
  }
  fs: {
    selectFolder(): Promise<string | null>
    selectFile(): Promise<string | null>
    listDir(dir: string): Promise<DirEntry[]>
    readFile(file: string): Promise<string>
    writeFile(file: string, content: string): Promise<void>
    homeDir(): Promise<string>
  }
  ssh: {
    /** Enregistre (chiffre) l'hote puis se connecte. La session porte l'id de l'hote. */
    saveAndConnect(input: SshHostInput): Promise<SshSession>
    /** Reconnecte un hote deja enregistre par son id (secret repris du stockage). */
    connectHost(id: string): Promise<SshSession>
    /** Hotes SSH enregistres (metadonnees publiques, sans secret). */
    listHosts(): Promise<SavedSshHost[]>
    /** Supprime un hote enregistre et coupe sa session. */
    removeHost(id: string): Promise<void>
    exec(sessionId: string, command: string): Promise<{ code: number; stdout: string; stderr: string }>
    list(): Promise<SshSession[]>
    disconnect(sessionId: string): Promise<void>
  }
  conversations: {
    list(): Promise<Conversation[]>
    upsert(conv: Conversation): Promise<void>
    remove(id: string): Promise<void>
  }
  tasks: {
    list(): Promise<BgTask[]>
    clear(): Promise<void>
    onUpdate(cb: (tasks: BgTask[]) => void): () => void
  }
  app: {
    version(): Promise<string>
    /** Verifie s'il existe une release GitHub plus recente (lecture seule, jamais d'install auto). */
    checkUpdate(): Promise<{ available: boolean; latest?: string; current: string; url: string }>
    openExternal(url: string): Promise<void>
    showPath(path: string): Promise<string>
    /** Copie du texte dans le presse-papier (fiable, via Electron). */
    copyText(text: string): Promise<void>
    gitBranch(dir: string): Promise<string>
    gitDiff(dir: string): Promise<{ added: number; removed: number }>
    /** Etat « demarrer avec le systeme ». */
    getLoginItem(): Promise<boolean>
    /** Active/desactive le demarrage avec le systeme ; renvoie l'etat effectif. */
    setLoginItem(enabled: boolean): Promise<boolean>
  }
  /** Controles de fenetre (barre de titre custom, fenetre sans cadre OS). */
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}

declare global {
  interface Window {
    api: RendererApi
  }
}
