import { create } from 'zustand'
import type {
  AppSettings,
  BgTask,
  ChatEvent,
  Conversation,
  ConvTarget,
  Credential,
  ComposerAttachment,
  ModelInfo,
  ReasoningEffort,
  SavedSshHost,
  UiAttachment,
  UiBlock,
  UiMessage,
  UiToolEntry
} from '@shared/types'
import { translate, type Lang } from '@shared/i18n'
import { contextWindowFor, effectiveWindow, estimateTokens, getPreset, messagesChars } from '@shared/providers'

export type View = 'chat' | 'code' | 'settings'
export type Section = 'chat' | 'code'

export interface Selection {
  credentialId: string
  model: string
}

export interface RuntimeConv extends Conversation {
  busy: boolean
  streamId: string | null
  /** true pendant le compactage automatique (affiche un indicateur). */
  compacting?: boolean
  /** Tokens REELS du dernier echange (renvoyes par l'API) = taille exacte du contexte. */
  contextTokens?: number
  /** Phase de travail courante de l'agent (pour l'indicateur « en cours »). */
  phase?: WorkPhase
}

/** Phase de travail affichee a l'utilisateur pendant qu'une reponse se genere. */
export type WorkPhase = 'starting' | 'thinking' | 'writing' | 'analyzing' | `tool:${string}`

const PALETTE = ['#4ec07a', '#d8a657', '#3a6ea5', '#cc7a4f', '#a06ad8', '#5ec8c8', '#e0707a']
const AUTO_COMPACT_CHARS = 60000

interface AppState {
  view: View
  conversations: Record<string, RuntimeConv>
  activeChatId: string | null
  activeCodeId: string | null

  credentials: Credential[]
  models: ModelInfo[]
  loadingModels: boolean
  selected: Selection | null
  reasoning: ReasoningEffort
  settings: AppSettings | null
  homeDir: string
  lang: Lang
  sshHosts: SavedSshHost[]
  recentDirs: Record<string, string[]>
  backgroundTasks: BgTask[]
  showTasks: boolean
  appVersion: string
  /** Mise a jour disponible (release GitHub plus recente). null = aucune / pas verifie. */
  update: { latest?: string; url: string } | null
  sidebarCollapsed: boolean
  searchOpen: boolean
  searchQuery: string
  sidebarWidth: number
  tasksWidth: number

  bootstrap: () => Promise<void>
  setView: (v: View) => void
  setLang: (lang: Lang) => void
  refreshSshHosts: () => Promise<void>
  addRecentDir: (key: string, path: string) => void
  contextUsage: (id: string) => { used: number; window: number; pct: number; modelWindow: number }
  toggleTasks: () => void
  clearTasks: () => void
  dismissUpdate: () => void
  toggleSidebar: () => void
  setSearchOpen: (v: boolean) => void
  setSearchQuery: (q: string) => void
  setSidebarWidth: (w: number) => void
  setTasksWidth: (w: number) => void
  archiveConversation: (id: string) => void
  toggleAutoApprove: (id: string) => void

  newConversation: (section: Section) => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  duplicateConversation: (id: string) => void
  setConvTarget: (id: string, target: ConvTarget) => void
  setConvColor: (id: string, color: string) => void
  clearConversation: (id: string) => void

  select: (sel: Selection) => void
  setReasoning: (r: ReasoningEffort) => void
  refreshCredentials: () => Promise<void>
  refreshModels: () => Promise<void>

  send: (id: string, text: string, attachments?: ComposerAttachment[]) => Promise<void>
  cancel: (id: string) => void
  /** Arrête TOUT travail en cours (streams/agents/sous-agents) de toutes les conversations. */
  cancelAll: () => void
  approve: (id: string, callId: string, approved: boolean) => void
  approveAlways: (id: string, callId: string) => void
  compact: (id: string) => Promise<void>
  generateTitle: (id: string) => Promise<void>

  activeId: (section: Section) => string | null
  convsForSection: (section: Section) => RuntimeConv[]
}

export const useApp = create<AppState>((set, get) => {
  /* ------------------------------ helpers internes ----------------------------- */

  const patch = (id: string, fn: (c: RuntimeConv) => RuntimeConv): void => {
    const c = get().conversations[id]
    if (!c) return
    set({ conversations: { ...get().conversations, [id]: fn(c) } })
  }

  const persist = (id: string): void => {
    const c = get().conversations[id]
    if (!c) return
    const { busy, streamId, compacting, phase, ...rest } = c
    void busy
    void streamId
    void compacting
    void phase
    window.api.conversations.upsert({
      ...rest,
      messages: rest.messages.map((m) => ({ role: m.role, content: m.content, reasoning: m.reasoning, blocks: m.blocks, tools: m.tools, error: m.error }))
    })
  }

  const identityLine = (model: string, providerName: string, endpoint: string): string =>
    `Tu es le modele « ${model} », accessible via l'API ${providerName} (${endpoint}). ` +
    `Si on te demande quel modele ou quelle IA tu es, reponds honnetement « ${model} » — ` +
    `ne pretends jamais etre un autre modele (Claude, ChatGPT, Gemini, etc.).`

  const buildSystem = (c: RuntimeConv, model: string, providerName: string, endpoint: string, reasoning: ReasoningEffort): string => {
    const id = identityLine(model, providerName, endpoint)
    if (c.section === 'chat') {
      return `${id}\nTu es un assistant utile, clair et concis. Reponds dans la langue de l'utilisateur.`
    }
    let s = `${id}\nTu es un assistant de programmation expert. Tu disposes d'outils pour lire/ecrire des fichiers et executer des commandes.`
    if (c.target?.type === 'local') {
      const isWin = /^[A-Za-z]:[\\/]/.test(c.target.path)
      s += `\nDossier de travail (local) : ${c.target.path}`
      s += isWin
        ? "\nSYSTEME : Windows. Les commandes run_command passent par cmd.exe. Utilise des commandes WINDOWS (dir, type, copy, move, del, findstr, mkdir) OU mieux : Python (`python -c ...`) ou PowerShell (`powershell -Command ...`). N'utilise PAS ls, grep, cat, find, sed, awk, head, tail (commandes Unix INDISPONIBLES sur Windows -> elles echouent)."
        : '\nSYSTEME : Unix/Linux (commandes shell standard : ls, grep, cat, find...).'
    } else if (c.target?.type === 'ssh') {
      s += `\nMachine distante SSH : ${c.target.label}, dossier : ${c.target.cwd}`
      s += '\nSYSTEME distant : Unix/Linux (commandes shell standard ; PAS de commandes Windows).'
    }
    s += "\nUtilise les outils pour inspecter et modifier le projet. Les commandes run_command s'executent DEJA dans le dossier de travail : inutile de prefixer par `cd`."
    // REGLE STRICTE : creation de fichiers uniquement via l'outil (anti-hallucination).
    s +=
      "\n\nCREATION DE FICHIERS : pour creer ou modifier un fichier, tu DOIS appeler l'outil write_file (ou run_command). " +
      "N'affirme JAMAIS qu'un fichier a ete cree/modifie sans avoir reellement appele l'outil correspondant dans CE tour. " +
      "Apres ecriture, verifie avec read_file ou list_dir si c'est important."
    // MEMOIRE DE PROGRES : persister les etapes cles pour survivre au compactage.
    s +=
      "\n\nMEMOIRE : tiens a jour un fichier de progres dans le dossier de travail (cree-le si absent : `NOTES_HAPICODE.md`). " +
      "Apres chaque etape importante (decouverte, decision, fichier cree, commande clef, resultat), AJOUTE-y une ligne datee. " +
      "Au demarrage d'une tache, lis-le d'abord pour reprendre le fil. Ainsi le contexte essentiel survit meme si la conversation est compactee."
    // STYLE : narration claire et progression etape par etape (lisibilite de l'historique).
    s +=
      "\n\nDEROULE : procede ETAPE PAR ETAPE. AVANT chaque commande ou outil, ecris une courte phrase disant CE que tu vas faire et POURQUOI. " +
      "APRES le resultat, commente brievement ce que tu en deduis, puis enchaine. Evite de lancer une rafale de commandes d'un coup sans explication : " +
      "une action a la fois, expliquee, rend le travail clair et suivable."
    if (reasoning === 'ultracode') {
      s +=
        "\n\nMODE ULTRACODE : pour toute tache non triviale, deploie plusieurs sous-agents EN PARALLELE avec l'outil spawn_subagent " +
        "(decompose la tache en sous-taches independantes, couvre-les en parallele, puis verifie ton travail de maniere adversariale). " +
        'Privilegie l\'exhaustivite et la rigueur sur la rapidite ; ne bacle aucune verification.'
    }
    return s
  }

  // Ajoute du texte au DERNIER bloc texte, ou cree un nouveau bloc texte (preserve l'ordre).
  const appendTextBlock = (blocks: UiBlock[] | undefined, delta: string): UiBlock[] => {
    const arr = blocks ? [...blocks] : []
    const last = arr[arr.length - 1]
    if (last && last.type === 'text') arr[arr.length - 1] = { type: 'text', text: last.text + delta }
    else arr.push({ type: 'text', text: delta })
    return arr
  }
  const updateToolBlock = (blocks: UiBlock[] | undefined, callId: string, fn: (t: UiToolEntry) => UiToolEntry): UiBlock[] | undefined =>
    blocks?.map((b) => (b.type === 'tool' && b.tool.callId === callId ? { type: 'tool', tool: fn(b.tool) } : b))

  const reduceConv = (c: RuntimeConv, e: ChatEvent): RuntimeConv => {
    const msgs = c.messages
    const last = msgs.length - 1
    const patchLast = (fn: (m: UiMessage) => UiMessage): UiMessage[] => msgs.map((m, i) => (i === last ? fn(m) : m))
    switch (e.type) {
      case 'text':
        // `content` = tout le texte (resume/titre) ; `blocks` = ordre chronologique (rendu).
        return { ...c, messages: patchLast((m) => ({ ...m, content: m.content + e.delta, blocks: appendTextBlock(m.blocks, e.delta) })) }
      case 'reasoning':
        return { ...c, messages: patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? '') + e.delta })) }
      case 'tool_call':
        return {
          ...c,
          messages: patchLast((m) => ({
            ...m,
            blocks: [
              ...(m.blocks ?? []),
              {
                type: 'tool',
                tool: { callId: e.callId, tool: e.tool, args: e.args, needsApproval: e.needsApproval, status: e.needsApproval ? 'pending' : 'running' }
              }
            ]
          }))
        }
      case 'tool_result':
        return {
          ...c,
          messages: patchLast((m) => ({
            ...m,
            blocks: updateToolBlock(m.blocks, e.callId, (t) => ({ ...t, result: e.result, status: e.isError ? 'error' : 'done' }))
          }))
        }
      case 'error':
        return {
          ...c,
          messages: patchLast((m) => ({
            ...m,
            content: m.content + `\n\n${translate(get().lang, 'errorPrefix')}${e.message}`,
            blocks: appendTextBlock(m.blocks, `\n\n${translate(get().lang, 'errorPrefix')}${e.message}`),
            streaming: false,
            error: true
          }))
        }
      case 'done':
        return { ...c, messages: patchLast((m) => ({ ...m, streaming: false })) }
      default:
        return c
    }
  }

  // Phase de travail deduite de l'evenement en cours (pour l'indicateur « en cours »).
  const phaseFor = (e: ChatEvent): WorkPhase | undefined => {
    switch (e.type) {
      case 'reasoning':
        return 'thinking'
      case 'text':
        return 'writing'
      case 'tool_call':
        return `tool:${e.tool}`
      case 'tool_result':
        return 'analyzing'
      default:
        return undefined
    }
  }

  const handleEvent = (e: ChatEvent): void => {
    const entry = Object.values(get().conversations).find((c) => c.streamId === e.streamId)
    if (!entry) return
    // Usage REEL remonte en direct (pendant le tour) : maj immediate de la taille du contexte.
    if (e.type === 'usage') {
      const tok = (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0)
      if (tok > 0) patch(entry.id, (c) => ({ ...c, contextTokens: tok }))
      return
    }
    const ph = phaseFor(e)
    patch(entry.id, (c) => ({ ...reduceConv(c, e), ...(ph !== undefined ? { phase: ph } : {}) }))
    // « Accepter les modifications » : approuve automatiquement les actions sensibles.
    if (e.type === 'tool_call' && e.needsApproval && entry.autoApprove) {
      get().approve(entry.id, e.callId, true)
    }
    if (e.type === 'done' || e.type === 'error') {
      // Taille EXACTE du contexte renvoyee par l'API (input + output du dernier appel).
      const usageTokens = e.type === 'done' && e.usage ? (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0) : undefined
      patch(entry.id, (c) => ({ ...c, busy: false, streamId: null, phase: undefined, updatedAt: Date.now(), ...(usageTokens ? { contextTokens: usageTokens } : {}) }))
      persist(entry.id)
      // L'agent nomme la conversation selon le sujet, apres le premier echange.
      if (e.type === 'done' && !get().conversations[entry.id]?.autoTitled) get().generateTitle(entry.id)
    }
  }

  // Taille de la conversation OUTILS INCLUS (sinon le compactage auto ne se declenche jamais
  // en mode agent, ou les sorties d'outils dominent le contexte).
  const estimateChars = (msgs: UiMessage[]): number => messagesChars(msgs)

  // Fenetre de contexte du modele selectionne : valeur REELLE de l'API si dispo, sinon heuristique.
  const selectedWindow = (): number => {
    const sel = get().selected
    if (!sel) return 128_000
    const mi = get().models.find((m) => m.credentialId === sel.credentialId && m.id === sel.model)
    return contextWindowFor(sel.model, mi?.contextWindow)
  }

  // Titre court du « chapitre » de compactage : 1re ligne utile du resume, nettoyee.
  const compactionTitle = (summary: string): string => {
    const line = summary
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find((l) => l.length > 2)
    return (line ?? '').slice(0, 70) || translate(get().lang, 'compactionDone')
  }

  /* --------------------------------- etat initial ------------------------------ */

  return {
    view: 'chat',
    conversations: {},
    activeChatId: null,
    activeCodeId: null,
    credentials: [],
    models: [],
    loadingModels: false,
    selected: null,
    reasoning: 'medium',
    settings: null,
    homeDir: '',
    lang: 'en',
    sshHosts: [],
    recentDirs: {},
    backgroundTasks: [],
    showTasks: false,
    appVersion: '',
    update: null,
    sidebarCollapsed: false,
    searchOpen: false,
    searchQuery: '',
    sidebarWidth: 252,
    tasksWidth: 360,

    toggleTasks: () => set({ showTasks: !get().showTasks }),
    clearTasks: () => window.api.tasks.clear(),
    dismissUpdate: () => set({ update: null }),
    toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
    setSearchOpen: (searchOpen) => set({ searchOpen, ...(searchOpen ? {} : { searchQuery: '' }) }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setSidebarWidth: (w) => set({ sidebarWidth: Math.max(190, Math.min(480, Math.round(w))) }),
    setTasksWidth: (w) => set({ tasksWidth: Math.max(280, Math.min(620, Math.round(w))) }),

    archiveConversation: (id) => {
      const c = get().conversations[id]
      if (!c) return
      if (c.streamId) window.api.chat.cancel(c.streamId) // stoppe l'agent avant d'archiver
      patch(id, (x) => ({ ...x, archived: true }))
      persist(id)
      const rest = Object.values(get().conversations)
        .filter((x) => x.section === c.section && !x.archived && x.id !== id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      set(c.section === 'chat' ? { activeChatId: rest[0]?.id ?? null } : { activeCodeId: rest[0]?.id ?? null })
    },

    toggleAutoApprove: (id) => {
      patch(id, (x) => ({ ...x, autoApprove: !x.autoApprove }))
      persist(id)
    },

    setLang: (lang) => {
      set({ lang })
      window.api.settings.set({ lang })
    },

    refreshSshHosts: async () => set({ sshHosts: await window.api.ssh.listHosts() }),

    addRecentDir: (key, path) => {
      if (!path) return
      const cur = get().recentDirs
      const list = [path, ...(cur[key] ?? []).filter((p) => p !== path)].slice(0, 8)
      const next = { ...cur, [key]: list }
      set({ recentDirs: next })
      window.api.settings.set({ recentDirs: next })
    },

    contextUsage: (id) => {
      const c = get().conversations[id]
      const modelWindow = selectedWindow()
      // Jauge + compactage bornes a la fenetre EFFECTIVE (plafonnee) : sinon 1M => jauge qui
      // monte a peine et compactage jamais atteint. On garde `modelWindow` pour l'info.
      const window = effectiveWindow(modelWindow)
      const used = Math.max(c?.contextTokens ?? 0, estimateTokens(c ? messagesChars(c.messages) : 0))
      return { used, window, pct: Math.min(100, Math.round((used / window) * 100)), modelWindow }
    },

    bootstrap: async () => {
      window.api.chat.onEvent(handleEvent)
      window.api.tasks.onUpdate((list) => set({ backgroundTasks: list }))
      const [settings, homeDir, convs, appVersion, bgTasks, sshHosts] = await Promise.all([
        window.api.settings.get(),
        window.api.fs.homeDir(),
        window.api.conversations.list(),
        window.api.app.version(),
        window.api.tasks.list(),
        window.api.ssh.listHosts()
      ])
      set({ appVersion, backgroundTasks: bgTasks })
      const map: Record<string, RuntimeConv> = {}
      for (const c of convs) map[c.id] = { ...c, busy: false, streamId: null }
      const recent = (section: Section): string | null => {
        const list = Object.values(map)
          .filter((c) => c.section === section && !c.archived)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        return list[0]?.id ?? null
      }
      set({
        settings,
        homeDir,
        // « Off » n'existe plus dans l'UI : on le ramène à un raisonnement minimal.
        reasoning: !settings.lastReasoning || settings.lastReasoning === 'off' ? 'medium' : settings.lastReasoning,
        lang: settings.lang ?? 'en',
        sshHosts,
        recentDirs: settings.recentDirs ?? {},
        conversations: map,
        activeChatId: recent('chat'),
        activeCodeId: recent('code')
      })
      await get().refreshCredentials()
      await get().refreshModels()
      // Modele PAR conversation : au demarrage, applique celui de la conversation active si dispo.
      {
        const av = get().view === 'code' ? get().activeCodeId : get().activeChatId
        const cv = av ? get().conversations[av] : undefined
        if (cv?.credentialId && cv.model && get().models.some((m) => m.credentialId === cv.credentialId && m.id === cv.model)) {
          set({ selected: { credentialId: cv.credentialId, model: cv.model } })
        }
      }
      // Mise a jour : verification non bloquante au demarrage (jamais d'installation auto).
      window.api.app
        .checkUpdate()
        .then((u) => {
          if (u.available) set({ update: { latest: u.latest, url: u.url } })
        })
        .catch(() => {})
    },

    setView: (view) => set({ view }),

    newConversation: (section) => {
      // NE PAS annuler les autres conversations : elles peuvent travailler EN PARALLELE.
      const id = crypto.randomUUID()
      const color = PALETTE[Object.keys(get().conversations).length % PALETTE.length]
      const sel = get().selected
      const conv: RuntimeConv = {
        id,
        section,
        title: translate(get().lang, section === 'code' ? 'newProjectTitle' : 'newConvTitle'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color,
        // Modele PAR conversation : herite du modele courant comme defaut (sans toucher aux autres).
        credentialId: sel?.credentialId,
        model: sel?.model,
        messages: [],
        busy: false,
        streamId: null
      }
      set({
        conversations: { ...get().conversations, [id]: conv },
        view: section,
        ...(section === 'chat' ? { activeChatId: id } : { activeCodeId: id })
      })
      return id
    },

    selectConversation: (id) => {
      const c = get().conversations[id]
      if (!c) return
      set({ view: c.section, ...(c.section === 'chat' ? { activeChatId: id } : { activeCodeId: id }) })
      // Restaure le modele PROPRE a cette conversation (s'il est encore disponible) — modele par conv.
      if (c.credentialId && c.model && get().models.some((m) => m.credentialId === c.credentialId && m.id === c.model)) {
        set({ selected: { credentialId: c.credentialId, model: c.model } })
      }
    },

    deleteConversation: (id) => {
      const c = get().conversations[id]
      if (!c) return
      // CRUCIAL : stoppe l'agent en cours, sinon il continue a tourner en fond (zombie) apres suppression.
      if (c.streamId) window.api.chat.cancel(c.streamId)
      const rest = { ...get().conversations }
      delete rest[id]
      window.api.conversations.remove(id)
      const nextActive = (section: Section): string | null => {
        const list = Object.values(rest)
          .filter((x) => x.section === section && !x.archived)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        return list[0]?.id ?? null
      }
      set({
        conversations: rest,
        ...(c.section === 'chat' ? { activeChatId: nextActive('chat') } : { activeCodeId: nextActive('code') })
      })
    },

    renameConversation: (id, title) => {
      patch(id, (c) => ({ ...c, title: title.trim() || c.title }))
      persist(id)
    },

    duplicateConversation: (id) => {
      const src = get().conversations[id]
      if (!src) return
      const newId = crypto.randomUUID()
      const copy: RuntimeConv = {
        ...src,
        id: newId,
        title: `${src.title} (${translate(get().lang, 'copySuffix')})`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        busy: false,
        streamId: null,
        messages: src.messages.map((m) => ({ ...m, streaming: false }))
      }
      set({
        conversations: { ...get().conversations, [newId]: copy },
        ...(src.section === 'chat' ? { activeChatId: newId } : { activeCodeId: newId })
      })
      persist(newId)
    },

    setConvTarget: (id, target) => {
      patch(id, (c) => ({ ...c, target }))
      persist(id)
    },

    setConvColor: (id, color) => {
      patch(id, (c) => ({ ...c, color }))
      persist(id)
    },

    clearConversation: (id) => {
      const c = get().conversations[id]
      if (c?.streamId) window.api.chat.cancel(c.streamId)
      patch(id, (x) => ({ ...x, messages: [], busy: false, streamId: null }))
      persist(id)
    },

    select: (selected) => {
      set({ selected })
      window.api.settings.set({ lastCredentialId: selected.credentialId, lastModel: selected.model })
      // Enregistre le modele sur la conversation ACTIVE uniquement (modele par conversation).
      const section: Section = get().view === 'code' ? 'code' : 'chat'
      const activeId = section === 'chat' ? get().activeChatId : get().activeCodeId
      if (activeId && get().conversations[activeId]) {
        patch(activeId, (c) => ({ ...c, credentialId: selected.credentialId, model: selected.model }))
        persist(activeId)
      }
    },

    setReasoning: (reasoning) => {
      set({ reasoning })
      window.api.settings.set({ lastReasoning: reasoning })
    },

    refreshCredentials: async () => set({ credentials: await window.api.settings.listCredentials() }),

    refreshModels: async () => {
      if (get().credentials.length === 0) {
        set({ models: [], selected: null })
        return
      }
      set({ loadingModels: true })
      try {
        const models = await window.api.providers.listAllModels()
        const { settings } = get()
        let selected = get().selected
        const valid = selected && models.some((m) => m.credentialId === selected!.credentialId && m.id === selected!.model)
        if (!valid) {
          const preferred =
            (settings?.lastCredentialId && models.find((m) => m.credentialId === settings.lastCredentialId && m.id === settings.lastModel)) ||
            models[0]
          selected = preferred ? { credentialId: preferred.credentialId, model: preferred.id } : null
        }
        set({ models, selected })
      } finally {
        set({ loadingModels: false })
      }
    },

    send: async (id, text, attachments = []) => {
      const typed = text.trim()
      const conv = get().conversations[id]
      const sel = get().selected
      if ((!typed && attachments.length === 0) || !conv || conv.busy || !sel) return

      // Compactage automatique quand on approche la fenetre EFFECTIVE (plafonnee, sinon jamais atteinte).
      const ctxWindow = effectiveWindow(selectedWindow())
      const usedTokens = Math.max(conv.contextTokens ?? 0, estimateTokens(estimateChars(conv.messages)))
      // Compactage anticipe (75%) : garde l'agent vif avant que le contexte ne sature.
      if (usedTokens > ctxWindow * 0.75) await get().compact(id)
      const current = get().conversations[id]
      const history = current.messages

      // Fichiers texte -> plies dans le contenu ENVOYE ; images -> parts multimodales.
      const files = attachments.filter((a) => a.kind === 'file' && a.text)
      const images = attachments
        .filter((a) => a.kind === 'image' && a.mime && a.data)
        .map((a) => ({ mime: a.mime as string, data: a.data as string }))
      let sentContent = typed
      for (const f of files) sentContent += `${sentContent ? '\n\n' : ''}--- ${f.name} ---\n${f.text}\n--- end ---`

      const uiAttachments: UiAttachment[] = attachments.map((a) => ({ name: a.name, kind: a.kind, dataUrl: a.dataUrl }))

      const isFirst = history.length === 0
      const streamId = crypto.randomUUID()
      // Le message UI montre ce que l'utilisateur a tapé + les pastilles (pas le contenu déversé).
      const userMsg: UiMessage = { role: 'user', content: typed, attachments: uiAttachments.length ? uiAttachments : undefined }
      const assistant: UiMessage = { role: 'assistant', content: '', streaming: true, blocks: [] }

      patch(id, (c) => ({
        ...c,
        title: isFirst ? typed.slice(0, 48) || uiAttachments[0]?.name || c.title : c.title,
        model: sel.model,
        messages: [...history, userMsg, assistant],
        busy: true,
        streamId,
        phase: 'starting',
        updatedAt: Date.now()
      }))
      persist(id)

      const workdir =
        conv.target?.type === 'local' ? conv.target.path : conv.target?.type === 'ssh' ? conv.target.cwd : undefined

      const cred = get().credentials.find((c) => c.id === sel.credentialId)
      const providerName = getPreset(cred?.providerId ?? '')?.name ?? cred?.label ?? 'API'
      const endpoint = cred?.baseUrl ?? ''

      // Historique en texte + message courant (texte plié + images).
      const outgoing = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: sentContent, images: images.length ? images : undefined }
      ]

      await window.api.chat.start({
        clientStreamId: streamId,
        convId: id,
        credentialId: sel.credentialId,
        model: sel.model,
        messages: outgoing,
        system: buildSystem(conv, sel.model, providerName, endpoint, get().reasoning),
        reasoningEffort: get().reasoning,
        workdir,
        sshSessionId: conv.target?.type === 'ssh' ? conv.target.sessionId : undefined,
        agentMode: conv.section === 'code'
      })
    },

    cancel: (id) => {
      const c = get().conversations[id]
      if (c?.streamId) window.api.chat.cancel(c.streamId)
      patch(id, (x) => ({ ...x, busy: false, streamId: null, messages: x.messages.map((m, i) => (i === x.messages.length - 1 ? { ...m, streaming: false } : m)) }))
      persist(id)
    },

    // Arrête TOUT (utile : « nouveau projet » ne stoppe pas l'ancien tour/sous-agents qui rament).
    cancelAll: () => {
      for (const c of Object.values(get().conversations)) {
        if (c.streamId) get().cancel(c.id)
      }
    },

    approve: (id, callId, approved) => {
      const c = get().conversations[id]
      if (!c?.streamId) return
      window.api.chat.approve(c.streamId, callId, approved)
      patch(id, (x) => ({
        ...x,
        messages: x.messages.map((m, i) =>
          i === x.messages.length - 1
            ? {
                ...m,
                blocks: m.blocks?.map((b) =>
                  b.type === 'tool' && b.tool.callId === callId
                    ? { type: 'tool', tool: { ...b.tool, status: approved ? 'running' : 'denied' } }
                    : b
                )
              }
            : m
        )
      }))
    },

    approveAlways: (id, callId) => {
      // Active « Accepter les modifications » pour la conversation puis approuve cet appel.
      patch(id, (x) => ({ ...x, autoApprove: true }))
      persist(id)
      get().approve(id, callId, true)
    },

    compact: async (id) => {
      const c = get().conversations[id]
      const sel = get().selected
      if (!c || !sel || c.messages.length < 2) return
      patch(id, (x) => ({ ...x, compacting: true }))
      try {
        const summary = await window.api.chat.summarize({
          credentialId: sel.credentialId,
          model: sel.model,
          messages: c.messages.map((m) => ({ role: m.role, content: m.content }))
        })
        const compaction = { id: crypto.randomUUID(), at: Date.now(), title: compactionTitle(summary), summary }
        patch(id, (x) => ({
          ...x,
          compacting: false,
          contextTokens: undefined,
          // Chapitre conserve : consultable, et les notes survivent.
          compactions: [...(x.compactions ?? []), compaction],
          messages: [
            { role: 'user', content: `${translate(get().lang, 'compactSummaryIntro')}\n\n${summary}` },
            { role: 'assistant', content: translate(get().lang, 'compactAck') }
          ]
        }))
        persist(id)
      } catch {
        // echec resume : on garde l'historique
        patch(id, (x) => ({ ...x, compacting: false }))
      }
    },

    generateTitle: async (id) => {
      const c = get().conversations[id]
      const sel = get().selected
      if (!c || !sel || c.autoTitled || c.messages.length < 2) return
      try {
        const raw = await window.api.chat.title({
          credentialId: sel.credentialId,
          model: sel.model,
          messages: c.messages.slice(0, 4).map((m) => ({ role: m.role, content: m.content }))
        })
        const clean = raw.replace(/^["'«»\s]+|["'«».\s]+$/g, '').replace(/\n/g, ' ').slice(0, 60)
        patch(id, (x) => ({ ...x, title: clean || x.title, autoTitled: true }))
        persist(id)
      } catch {
        patch(id, (x) => ({ ...x, autoTitled: true }))
      }
    },

    activeId: (section) => (section === 'chat' ? get().activeChatId : get().activeCodeId),

    convsForSection: (section) =>
      Object.values(get().conversations)
        .filter((c) => c.section === section && !c.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)
  }
})
