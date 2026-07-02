import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, cpSync } from 'fs'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import type {
  AgentMessage,
  AppSettings,
  ChatEvent,
  ChatMessage,
  ChatStartRequest,
  DirEntry,
  ModelInfo,
  NewCredentialInput,
  SshHostInput
} from '@shared/types'
import { getPreset } from '@shared/providers'
import type { Conversation } from '@shared/types'
import * as store from './store'
import * as conversations from './conversations'
import * as ssh from './ssh'
import { listModels, runTurn, type ProviderContext } from './providers'
import { runAgent } from './agent/loop'
import * as tasks from './agent/tasks'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
// true seulement quand on veut REELLEMENT quitter (menu tray « Quitter »).
// Sinon, fermer la fenetre la cache dans la zone de notification (systray).
let isQuitting = false
// true quand l'app est lancee au demarrage de session : on demarre masque dans le systray.
let startHidden = false

// Dossier de donnees STABLE et brande. Sur Windows (FS insensible a la casse),
// 'Hapicode' et 'hAPIcode' designent le MEME dossier : aucune perte de cles ni de
// conversations apres le renommage. Sur un FS sensible a la casse (Linux), on migre
// l'ancien dossier 'Hapicode' vers 'hAPIcode' s'il existe.
const appDataDir = app.getPath('appData')
let userDataDir = join(appDataDir, 'hAPIcode')
const legacyUserDataDir = join(appDataDir, 'Hapicode')
// Migration SANS PERTE : si seul l'ancien dossier existe, on le deplace (rename), avec repli
// sur une copie recursive (cas cross-device EXDEV), et en dernier recours on continue d'utiliser
// l'ancien dossier tel quel pour ne JAMAIS perdre les cles API / conversations chiffrees.
if (legacyUserDataDir !== userDataDir && existsSync(legacyUserDataDir) && !existsSync(userDataDir)) {
  try {
    renameSync(legacyUserDataDir, userDataDir)
  } catch {
    try {
      cpSync(legacyUserDataDir, userDataDir, { recursive: true })
    } catch {
      userDataDir = legacyUserDataDir
    }
  }
}
app.setPath('userData', userDataDir)

/** Localise l'icone de l'app (packagee ou en dev). */
function iconPath(): string {
  const candidates = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png')
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

interface ActiveStream {
  controller: AbortController
  approvals: Map<string, (approved: boolean) => void>
}
const activeStreams = new Map<string, ActiveStream>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'hAPIcode',
    icon: iconPath(),
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    // Pas de barre de titre OS : on dessine nos propres boutons (reduire/agrandir/fermer).
    // 'hidden' conserve le redimensionnement et l'accrochage natifs de Windows.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Au demarrage de session (--hidden / openAsHidden), on reste masque dans le systray.
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })
  mainWindow.on('closed', () => (mainWindow = null))
  // Tient l'icone agrandir/restaurer a jour cote interface.
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))

  // Menu clic-droit (absent par defaut en Electron). Libelles forces dans la langue de l'APP
  // (les roles Electron suivent sinon la langue de l'OS). « Tout selectionner » UNIQUEMENT
  // dans un champ (sinon selectAll selectionne TOUT le document = toute l'app).
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const f = params.editFlags
    const en = (store.getSettings().lang ?? 'fr') === 'en'
    const L = en
      ? { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', copyImage: 'Copy image', copyLink: 'Copy link' }
      : { undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner', copyImage: 'Copier l’image', copyLink: 'Copier le lien' }
    const tpl: Electron.MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      tpl.push(
        { role: 'undo', label: L.undo, enabled: f.canUndo },
        { role: 'redo', label: L.redo, enabled: f.canRedo },
        { type: 'separator' },
        { role: 'cut', label: L.cut, enabled: f.canCut },
        { role: 'copy', label: L.copy, enabled: f.canCopy },
        { role: 'paste', label: L.paste, enabled: f.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: L.selectAll }
      )
    } else {
      if (params.mediaType === 'image') {
        tpl.push({ label: L.copyImage, click: () => mainWindow?.webContents.copyImageAt(params.x, params.y) })
      }
      if (params.linkURL) {
        tpl.push({ label: L.copyLink, click: () => clipboard.writeText(params.linkURL) })
      }
      // Copier uniquement s'il y a une selection ; PAS de « tout selectionner » hors champ.
      if (params.selectionText) tpl.push({ role: 'copy', label: L.copy })
    }
    if (tpl.length) Menu.buildFromTemplate(tpl).popup()
  })

  // Fermer (X) => masquer dans la zone de notification, MAIS seulement si un tray existe
  // pour rouvrir la fenetre. Sinon fermer = quitter (jamais d'app invisible et inaccessible).
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Applique l'entree de demarrage systeme (lance masque dans le systray au login). Renvoie le succes. */
function applyLoginItem(enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled, args: enabled ? ['--hidden'] : [] })
    return true
  } catch {
    /* non supporte / refuse (GPO, droits) : on signale l'echec */
    return false
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) return
  let img = nativeImage.createFromPath(iconPath())
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  const lang = store.getSettings().lang ?? 'fr'
  const L = lang === 'en'
    ? { show: 'Show hAPIcode', quit: 'Quit' }
    : { show: 'Afficher hAPIcode', quit: 'Quitter' }
  const menu = Menu.buildFromTemplate([
    { label: L.show, click: () => showWindow() },
    { type: 'separator' },
    {
      label: L.quit,
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('hAPIcode')
  tray.setContextMenu(menu)
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
}

/* --------------------------------- Helpers ------------------------------------ */

function ctxFor(credentialId: string): { ctx: ProviderContext; providerId: string; label: string } {
  const cred = store.getCredential(credentialId)
  if (!cred) throw new Error('Credential introuvable')
  return {
    ctx: { kind: cred.kind, baseUrl: cred.baseUrl, apiKey: store.getRawKey(credentialId) },
    providerId: cred.providerId,
    label: cred.label
  }
}

function toModelInfos(
  credentialId: string,
  providerId: string,
  label: string,
  models: (string | { id: string; contextWindow?: number })[]
): ModelInfo[] {
  return models.map((m) => {
    const id = typeof m === 'string' ? m : m.id
    const contextWindow = typeof m === 'string' ? undefined : m.contextWindow
    return { id, label: id, credentialId, providerId, providerLabel: label, contextWindow }
  })
}

/** Depot GitHub source des releases (verification de mise a jour). */
const RELEASES_REPO = 'stevo-code/hAPIcode'

/** Compare deux versions « x.y.z » : true si `a` est STRICTEMENT plus recente que `b`. */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/* ---------------------------------- IPC --------------------------------------- */

function registerIpc(): void {
  // Reglages
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => store.setSettings(patch))
  ipcMain.handle('settings:listCredentials', () => store.listCredentials())
  ipcMain.handle('settings:addCredential', (_e, input: NewCredentialInput) => store.addCredential(input))
  ipcMain.handle('settings:removeCredential', (_e, id: string) => store.removeCredential(id))
  ipcMain.handle('settings:encryptionAvailable', () => store.encryptionAvailable())
  ipcMain.handle('settings:testCredential', async (_e, input: NewCredentialInput) => {
    try {
      const { kind, baseUrl } = store.resolveProvider(input)
      const models = await listModels({ kind, baseUrl, apiKey: input.apiKey })
      return { ok: true, models: models.length }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // Modeles
  ipcMain.handle('providers:listModels', async (_e, credentialId: string) => {
    const { ctx, providerId, label } = ctxFor(credentialId)
    try {
      const ids = await listModels(ctx)
      return toModelInfos(credentialId, providerId, label, ids)
    } catch {
      const fb = getPreset(providerId)?.fallbackModels ?? []
      return toModelInfos(credentialId, providerId, label, fb)
    }
  })

  ipcMain.handle('providers:listAllModels', async () => {
    const creds = store.listCredentials()
    const all: ModelInfo[] = []
    for (const cred of creds) {
      try {
        const { ctx } = ctxFor(cred.id)
        const ids = await listModels(ctx)
        all.push(...toModelInfos(cred.id, cred.providerId, cred.label, ids))
      } catch {
        const fb = getPreset(cred.providerId)?.fallbackModels ?? []
        all.push(...toModelInfos(cred.id, cred.providerId, cred.label, fb))
      }
    }
    return all
  })

  // Chat (streaming + agent)
  ipcMain.handle('chat:start', (e, req: ChatStartRequest) => {
    const streamId = req.clientStreamId ?? randomUUID()
    const active: ActiveStream = { controller: new AbortController(), approvals: new Map() }
    activeStreams.set(streamId, active)
    const sender = e.sender
    const emit = (ev: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send('chat:event', ev)
    }

    let ctx: ProviderContext
    try {
      ctx = ctxFor(req.credentialId).ctx
    } catch (err: any) {
      emit({ streamId, type: 'error', message: err?.message ?? String(err) })
      activeStreams.delete(streamId)
      return streamId
    }

    // Historique rejoue en NATIF (tool_calls + resultats role 'tool' + thinking) : les mappers
    // providers les convertissent au format de chaque API. Aplati en texte, le modele apprenait
    // a IMITER des pseudo-appels ([run_command {...}]) au lieu d'appeler les vrais outils.
    const messages: AgentMessage[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        images: m.images,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
        thinkingBlocks: m.thinkingBlocks
      }))

    const requestApproval = (callId: string): Promise<boolean> =>
      new Promise((resolveApproval) => {
        active.approvals.set(callId, resolveApproval)
        // Deblocage a l'abort (Stop/suppression) : ne reste JAMAIS bloque sur une approbation en attente.
        active.controller.signal.addEventListener('abort', () => resolveApproval(false), { once: true })
      })

    let lastUsage: import('@shared/types').TokenUsage | undefined
    runAgent({
      ctx,
      model: req.model,
      convId: req.convId,
      system: req.system,
      messages,
      temperature: req.temperature,
      reasoningEffort: req.reasoningEffort,
      workdir: req.workdir,
      ssh: req.sshSessionId ? { sessionId: req.sshSessionId, cwd: req.workdir || '.' } : undefined,
      useTools: !!req.agentMode && (!!req.workdir || !!req.sshSessionId),
      streamId,
      signal: active.controller.signal,
      emit,
      requestApproval,
      onUsage: (u) => {
        lastUsage = u
        // Remontee EN DIRECT (pas seulement a la fin) : la jauge suit le contexte pendant un tour long.
        emit({ streamId, type: 'usage', usage: u })
      }
    })
      .then(() => emit({ streamId, type: 'done', usage: lastUsage }))
      .catch((err: any) => emit({ streamId, type: 'error', message: err?.message ?? String(err) }))
      .finally(() => activeStreams.delete(streamId))

    return streamId
  })

  ipcMain.handle('chat:cancel', (_e, streamId: string) => {
    const active = activeStreams.get(streamId)
    if (active) {
      active.controller.abort()
      for (const resolve of active.approvals.values()) resolve(false)
      active.approvals.clear()
    }
    activeStreams.delete(streamId)
  })

  ipcMain.handle('chat:approve', (_e, streamId: string, callId: string, approved: boolean) => {
    const resolve = activeStreams.get(streamId)?.approvals.get(callId)
    if (resolve) {
      resolve(approved)
      activeStreams.get(streamId)?.approvals.delete(callId)
    }
  })

  ipcMain.handle(
    'chat:summarize',
    async (_e, req: { credentialId: string; model: string; messages: ChatMessage[] }) => {
      const { ctx } = ctxFor(req.credentialId)
      const transcript = req.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      const turn = await runTurn(
        ctx,
        {
          model: req.model,
          maxTokens: 16000,
          system:
            'Tu produis le RELEVE D\'ETAT d\'une session d\'agent de code, destine a permettre a l\'agent de CONTINUER EXACTEMENT ou il en etait — SANS refaire le travail deja fait. ' +
            'Ce texte remplace l\'historique : tout ce que tu n\'ecris PAS est PERDU a jamais. Donc sois EXHAUSTIF, pas concis. ' +
            'Structure en markdown : ' +
            '## Objectif global · ## Ce qui est DEJA FAIT (liste precise, pour ne PAS le refaire) · ## Etat EXACT de chaque fichier cree/modifie (chemin + ce qui a change + extraits de code clefs verbatim) · ## Commandes deja executees + leur resultat · ## Decisions prises et pourquoi · ## Ou on en est PRECISEMENT maintenant · ## LA prochaine action a faire (concrete) · ## Pieges/erreurs rencontrees a ne pas refaire. ' +
            'Cite les noms de fichiers, chemins, fonctions, numeros de ligne, valeurs et extraits de code EXACTS. ' +
            "N'ecris JAMAIS de pseudo-appels d'outils dans le releve (aucun bloc du style [run_command {...}] ni fausse sortie de terminal) : decris les commandes et leurs resultats en PROSE. " +
            'REGLE ABSOLUE : un agent qui lit ce releve doit pouvoir reprendre sans relire les fichiers ni recommencer. Reponds dans la langue de l\'utilisateur.',
          messages: [{ role: 'user', content: `Fais le releve d'etat COMPLET de cette session pour la reprendre sans rien refaire :\n\n${transcript}` }]
        },
        { onText: () => {}, onReasoning: () => {} }
      )
      return turn.text
    }
  )

  ipcMain.handle(
    'chat:title',
    async (_e, req: { credentialId: string; model: string; messages: ChatMessage[] }) => {
      const { ctx } = ctxFor(req.credentialId)
      const transcript = req.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n').slice(0, 4000)
      const turn = await runTurn(
        ctx,
        {
          model: req.model,
          system:
            "Genere un titre tres court (3 a 6 mots) qui resume le sujet de cette conversation. Reponds UNIQUEMENT par le titre, sans guillemets ni ponctuation finale, dans la langue de l'utilisateur.",
          messages: [{ role: 'user', content: transcript }]
        },
        { onText: () => {}, onReasoning: () => {} }
      )
      return turn.text
    }
  )

  // Systeme de fichiers
  ipcMain.handle('fs:selectFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('fs:selectFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('fs:homeDir', () => homedir())
  ipcMain.handle('fs:listDir', (_e, dir: string): DirEntry[] => {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries
      .map((d) => ({ name: d.name, path: join(dir, d.name), isDir: d.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  })
  ipcMain.handle('fs:readFile', (_e, file: string) => readFileSync(file, 'utf-8'))
  // Lecture binaire -> base64 (+ type MIME depuis l'extension) pour les pieces jointes image.
  ipcMain.handle('fs:readFileBase64', (_e, file: string) => {
    const data = readFileSync(file).toString('base64')
    const ext = (file.split('.').pop() ?? '').toLowerCase()
    const mimes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml'
    }
    return { mime: mimes[ext] ?? 'application/octet-stream', data }
  })
  ipcMain.handle('fs:writeFile', (_e, file: string, content: string) =>
    writeFileSync(file, content, 'utf-8')
  )

  // Conversations (persistance)
  ipcMain.handle('conv:list', () => conversations.list())
  ipcMain.handle('conv:upsert', (_e, conv: Conversation) => conversations.upsert(conv))
  ipcMain.handle('conv:remove', (_e, id: string) => conversations.remove(id))

  // Taches en arriere-plan
  tasks.onChange((list) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('tasks:update', list)
  })
  ipcMain.handle('tasks:list', () => tasks.list())
  ipcMain.handle('tasks:clear', () => tasks.clear())

  // Version de l'application + ouverture de lien externe
  ipcMain.handle('app:version', () => app.getVersion())
  // Verifie s'il existe une release GitHub plus recente. Lecture seule, jamais d'installation auto.
  ipcMain.handle('app:checkUpdate', async () => {
    const current = app.getVersion()
    const releasesUrl = `https://github.com/${RELEASES_REPO}/releases`
    try {
      const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hAPIcode-update-check' }
      })
      if (!res.ok) return { available: false, current, url: releasesUrl }
      const json: any = await res.json()
      const latest = String(json.tag_name ?? '').replace(/^v/i, '')
      const url = typeof json.html_url === 'string' ? json.html_url : releasesUrl
      return { available: !!latest && isNewerVersion(latest, current), latest, current, url }
    } catch {
      return { available: false, current, url: releasesUrl }
    }
  })
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('app:showPath', (_e, p: string) => shell.openPath(p))
  // Copie fiable via le module clipboard d'Electron (pas de souci de focus/permission
  // comme navigator.clipboard, qui echoue si la fenetre n'a pas le focus).
  ipcMain.handle('app:copyText', (_e, text: string) => clipboard.writeText(String(text ?? '')))
  ipcMain.handle(
    'app:gitBranch',
    (_e, dir: string) =>
      new Promise<string>((resolve) => {
        execFile('git', ['-C', dir, 'branch', '--show-current'], { timeout: 5000, windowsHide: true }, (err, stdout) =>
          resolve(err ? '' : stdout.trim())
        )
      })
  )
  ipcMain.handle(
    'app:gitDiff',
    (_e, dir: string) =>
      new Promise<{ added: number; removed: number }>((resolve) => {
        execFile('git', ['-C', dir, 'diff', 'HEAD', '--numstat'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
          if (err) return resolve({ added: 0, removed: 0 })
          let added = 0
          let removed = 0
          for (const line of stdout.split('\n')) {
            const [a, r] = line.trim().split(/\s+/)
            if (/^\d+$/.test(a)) added += parseInt(a, 10)
            if (/^\d+$/.test(r)) removed += parseInt(r, 10)
          }
          resolve({ added, removed })
        })
      })
  )

  // SSH (les hotes sont enregistres chiffres ; la session porte l'id de l'hote)
  ipcMain.handle('ssh:saveAndConnect', async (_e, input: SshHostInput) => {
    const host = store.upsertSshHost(input)
    return ssh.connect(host.id)
  })
  ipcMain.handle('ssh:connectHost', (_e, id: string) => ssh.connect(id))
  ipcMain.handle('ssh:listHosts', () => store.listSshHosts())
  ipcMain.handle('ssh:removeHost', (_e, id: string) => {
    ssh.disconnect(id)
    store.removeSshHost(id)
  })
  ipcMain.handle('ssh:exec', (_e, sessionId: string, command: string) => ssh.exec(sessionId, command))
  ipcMain.handle('ssh:list', () => ssh.list())
  ipcMain.handle('ssh:disconnect', (_e, sessionId: string) => ssh.disconnect(sessionId))

  // Demarrage avec le systeme (Windows / macOS).
  // IMPORTANT : la source de verite est NOTRE reglage persiste, pas la relecture d'Electron.
  // Sur Windows, getLoginItemSettings() relit sans les args et renverrait false alors qu'on
  // a pose l'entree avec args ['--hidden'] -> le toggle « sautait » a off. On evite ce piege.
  // Controles de fenetre (barre de titre custom)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  // Fermer = se comporte comme le X : masque dans le systray (via le handler 'close').
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized())

  ipcMain.handle('app:getLoginItem', () => store.getSettings().startWithSystem ?? app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
    // On ne persiste « active » que si l'application a REELLEMENT reussi (sinon le toggle mentirait).
    const ok = applyLoginItem(enabled)
    const effective = enabled && ok
    store.setSettings({ startWithSystem: effective })
    return effective
  })
}

/* --------------------------------- Lifecycle ---------------------------------- */

// Instance unique : relancer l'exe ne fait que reveler la fenetre existante.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    // Demarrage masque si lance au login (argument --hidden ou ouverture de session OS).
    // Sur Windows la detection du demarrage masque repose sur l'argument --hidden (pose par
    // setLoginItemSettings) ; wasOpenedAtLogin n'est renseigne que sur macOS.
    startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
    registerIpc()
    createWindow()
    try {
      createTray()
    } catch {
      // Tray indisponible (echec systeme) : ne JAMAIS laisser l'app sans UI -> forcer l'affichage.
      startHidden = false
      mainWindow?.show()
    }
    // Re-applique l'entree de demarrage systeme a chaque lancement, dans LES DEUX sens :
    // garde le registre coherent avec notre reglage (ex. apres une MAJ qui change le chemin
    // de l'exe, ou pour nettoyer une entree orpheline quand le reglage est desactive).
    applyLoginItem(!!store.getSettings().startWithSystem)
    // Reconnexion automatique des hotes SSH des le demarrage.
    ssh.reconnectAll().catch(() => {})
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })
}

// L'app vit dans la zone de notification : ne pas quitter quand la fenetre se ferme.
// MAIS sans tray (echec de creation), fermer la fenetre doit reellement quitter.
app.on('window-all-closed', () => {
  if ((isQuitting || !tray) && process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  ssh.disconnectAll()
})
