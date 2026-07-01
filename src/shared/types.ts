import type { ProviderKind } from './providers'

/** Identifiant d'un evenement de stream (un message en cours de generation). */
export type StreamId = string

/** Credential tel qu'expose au renderer : JAMAIS la cle en clair. */
export interface Credential {
  id: string
  providerId: string
  label: string
  kind: ProviderKind
  baseUrl: string
  maskedKey: string
  createdAt: number
}

export interface NewCredentialInput {
  providerId: string
  label: string
  kind?: ProviderKind
  baseUrl?: string
  apiKey: string
}

export interface ModelInfo {
  id: string
  label: string
  credentialId: string
  providerId: string
  providerLabel: string
  /** Fenetre de contexte REELLE renvoyee par l'API du fournisseur (quand disponible). */
  contextWindow?: number
}

/** Image jointe a un message (base64 sans prefixe data:), pour l'envoi multimodal. */
export interface ImagePart {
  mime: string
  data: string
}

/** Piece jointe telle qu'affichee dans un message d'interface (pastille). */
export interface UiAttachment {
  name: string
  kind: 'image' | 'file'
  /** Miniature (data URL) pour les images. */
  dataUrl?: string
}

/** Piece jointe en attente dans le composer (avant envoi). */
export interface ComposerAttachment {
  id: string
  name: string
  kind: 'image' | 'file'
  /** Image : type MIME + base64 + apercu (data URL). */
  mime?: string
  data?: string
  dataUrl?: string
  /** Fichier texte : contenu. */
  text?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Images jointes (multimodal). */
  images?: ImagePart[]
}

/**
 * Effort de raisonnement. Niveaux d'interface :
 *  off · low · medium · high · xhigh (Extra) · max · ultracode (mode hAPIcode = max + sous-agents).
 * Le mapping vers l'API exacte de chaque fournisseur est fait dans src/main/providers.
 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Renseigne si les arguments JSON envoyes par le modele n'ont pas pu etre parses. */
  argsError?: string
}

/** Message interne agent : peut porter des appels d'outils et des resultats. */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
  /** Blocs de raisonnement bruts (Anthropic) a rejouer tels quels au tour suivant. */
  thinkingBlocks?: unknown[]
  /** Images jointes au message user (multimodal). */
  images?: ImagePart[]
}

export interface ChatStartRequest {
  credentialId: string
  model: string
  messages: ChatMessage[]
  system?: string
  temperature?: number
  reasoningEffort?: ReasoningEffort
  /** Identifiant de stream genere cote renderer (evite une course sur les premiers evenements). */
  clientStreamId?: string
  /** Dossier de travail (section Code) pour activer les outils agent. */
  workdir?: string
  /** Active la boucle agent avec outils (lecture/ecriture/commande). */
  agentMode?: boolean
  /** Si renseigne, les outils agent s'executent sur cette machine SSH (sinon local). */
  sshSessionId?: string
}

/* ---------------------------- Messages d'interface ---------------------------- */

export type ToolStatus = 'pending' | 'running' | 'denied' | 'done' | 'error'

export interface UiToolEntry {
  callId: string
  tool: string
  args: unknown
  needsApproval: boolean
  status: ToolStatus
  result?: string
}

/** Bloc d'un message assistant : texte OU appel d'outil, dans l'ordre CHRONOLOGIQUE
 *  (narration → commande → résultat → narration…). */
export type UiBlock = { type: 'text'; text: string } | { type: 'tool'; tool: UiToolEntry }

export interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  /** Ancien format (conversations d'avant) : outils groupés. Remplacé par `blocks`. */
  tools?: UiToolEntry[]
  /** Texte et outils entrelacés dans l'ordre où ils se sont produits. */
  blocks?: UiBlock[]
  /** Pièces jointes (images/fichiers) affichées avec le message. */
  attachments?: UiAttachment[]
  streaming?: boolean
  error?: boolean
}

/* ------------------------------- Conversations -------------------------------- */

/** Cible de travail d'une conversation Code : dossier local ou machine SSH. */
export type ConvTarget =
  | { type: 'local'; path: string }
  | { type: 'ssh'; sessionId: string; label: string; cwd: string }

/** Un compactage effectue : un « chapitre » resume de la session, conserve et consultable. */
export interface Compaction {
  id: string
  at: number
  /** Titre court du chapitre (affiche au survol). */
  title: string
  /** Resume detaille = les notes de cette tranche de session (consultable au clic). */
  summary: string
}

export interface Conversation {
  id: string
  section: 'chat' | 'code'
  title: string
  createdAt: number
  updatedAt: number
  /** Historique des compactages (chapitres), du plus ancien au plus recent. */
  compactions?: Compaction[]
  /** Pastille de statut (couleur), facon Claude Code. */
  color: string
  credentialId?: string
  model?: string
  reasoning?: ReasoningEffort
  target?: ConvTarget
  archived?: boolean
  /** true quand le titre a deja ete genere automatiquement par le modele. */
  autoTitled?: boolean
  /** « Accepter les modifications » : approuve automatiquement les actions de l'agent. */
  autoApprove?: boolean
  /** Derniere taille de contexte REELLE (tokens API) — persistee pour survivre au redemarrage. */
  contextTokens?: number
  messages: UiMessage[]
}

export type ChatEvent =
  | { streamId: StreamId; type: 'text'; delta: string }
  | { streamId: StreamId; type: 'reasoning'; delta: string }
  | { streamId: StreamId; type: 'tool_call'; callId: string; tool: string; args: unknown; needsApproval: boolean }
  | { streamId: StreamId; type: 'tool_result'; callId: string; result: string; isError?: boolean }
  | { streamId: StreamId; type: 'done'; usage?: TokenUsage }
  | { streamId: StreamId; type: 'error'; message: string }

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

/* ----------------------------- Systeme de fichiers ----------------------------- */

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

/* ----------------------------------- SSH -------------------------------------- */

/** Donnees fournies pour enregistrer/mettre a jour un hote SSH (avec secret). */
export interface SshHostInput {
  id?: string
  label: string
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  privateKeyPath?: string
  /** Auth par mot de passe OU cle privee. */
  password?: string
  passphrase?: string
}

export interface SshSession {
  id: string
  label: string
  host: string
  username: string
  connected: boolean
}

/* --------------------------- Taches en arriere-plan --------------------------- */

export interface BgTask {
  id: string
  kind: 'command' | 'subagent'
  title: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  detail?: string
  /** Nombre d'agents impliques (pour les sous-agents). */
  agentCount?: number
}

/* --------------------------------- Reglages ----------------------------------- */

/** Hote SSH enregistre (metadonnees ; le mot de passe n'est jamais persiste). */
export interface SavedSshHost {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  privateKeyPath?: string
  /** true si l'hote (migre v0.6) n'a pas de mot de passe stocke : reconnexion = re-saisie requise. */
  needsSecret?: boolean
}

export interface AppSettings {
  theme: 'dark' | 'light'
  lang?: 'fr' | 'en'
  lastCredentialId?: string
  lastModel?: string
  lastWorkdir?: string
  lastReasoning?: ReasoningEffort
  defaultSystemPrompt?: string
  /** « Demarrer avec Windows » : source de verite cote app (evite la relecture capricieuse d'Electron). */
  startWithSystem?: boolean
  /** Dossiers recents par environnement : cle = id d'hote SSH, ou 'local'. */
  recentDirs?: Record<string, string[]>
}
