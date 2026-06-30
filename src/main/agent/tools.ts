import { resolve, relative, isAbsolute, join, dirname, sep } from 'path'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, realpathSync } from 'fs'
import { exec } from 'child_process'
import type { ToolCall, ToolDef } from '@shared/types'
import * as ssh from '../ssh'

/** Definitions exposees au modele (format JSON Schema). */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_dir',
    description: "Liste les fichiers et dossiers d'un repertoire du projet.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif au dossier du projet (ex: "src" ou "."), par defaut la racine.' }
      }
    }
  },
  {
    name: 'read_file',
    description: "Lit le contenu d'un fichier texte du projet.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif au dossier du projet.' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: "Cree ou remplace entierement un fichier avec le contenu fourni. Cree les dossiers manquants.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif au dossier du projet.' },
        content: { type: 'string', description: 'Contenu complet du fichier.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description:
      'Execute une commande shell depuis le dossier du projet (cwd) et renvoie sa sortie. ATTENTION : non confine — la commande peut acceder hors du dossier ; necessite une approbation.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'La commande a executer (ex: "npm test").' }
      },
      required: ['command']
    }
  }
]

/** Outil de delegation : confie une sous-tache a un sous-agent autonome. */
export const SPAWN_TOOL: ToolDef = {
  name: 'spawn_subagent',
  description:
    "Delegue une sous-tache a un sous-agent autonome qui dispose des memes outils de fichiers sur le meme projet. " +
    "Utilise-le pour paralleliser des sous-taches independantes (ex: implementer plusieurs fichiers, explorer plusieurs pistes). " +
    "Tu peux en lancer plusieurs dans un meme tour : ils s'executent en parallele. Renvoie le resume du travail du sous-agent.",
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: "Description claire et autonome de la sous-tache (le sous-agent ne voit pas le reste de la conversation)."
      }
    },
    required: ['description']
  }
}

/** Outils qui modifient l'etat ou executent du code : approbation utilisateur requise. */
export const NEEDS_APPROVAL = new Set(['write_file', 'run_command'])

/** Selectionne la palette d'outils selon la profondeur d'agent (limite la portee des sous-agents). */
export function toolsetFor(depth: number, canSpawn: boolean): ToolDef[] {
  // Les sous-agents (depth > 0) n'ont pas run_command (pas d'execution shell non supervisee).
  const base = depth > 0 ? TOOL_DEFS.filter((t) => t.name !== 'run_command') : TOOL_DEFS.slice()
  return canSpawn ? [...base, SPAWN_TOOL] : base
}

export interface ToolResult {
  result: string
  isError: boolean
}

/** realpath du plus proche ancetre existant (pour valider meme un fichier pas encore cree). */
function realNearest(p: string): string {
  let cur = p
  for (;;) {
    try {
      return realpathSync(cur)
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return cur
      cur = parent
    }
  }
}

/**
 * Resout un chemin en restant strictement dans le dossier de travail, liens symboliques inclus.
 * Verifie le realpath du plus proche ancetre existant contre le realpath du dossier de projet,
 * ce qui empeche l'evasion via un symlink interne pointant hors du dossier.
 */
function safePath(workdir: string, p: string | undefined): string {
  const root = realNearest(workdir)
  const rel = (p ?? '.').trim()
  const abs = isAbsolute(rel) ? rel : resolve(root, rel)
  const real = realNearest(abs)
  const r = relative(root, real)
  if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) {
    throw new Error(`Acces refuse : "${rel}" est hors du dossier de projet.`)
  }
  return abs
}

export async function executeTool(workdir: string, call: ToolCall): Promise<ToolResult> {
  try {
    const a = call.arguments ?? {}
    switch (call.name) {
      case 'list_dir': {
        const dir = safePath(workdir, a.path as string)
        const entries = readdirSync(dir, { withFileTypes: true })
          .map((d) => `${d.isDirectory() ? '[dir] ' : '      '}${d.name}`)
          .sort()
        return { result: entries.join('\n') || '(vide)', isError: false }
      }
      case 'read_file': {
        const file = safePath(workdir, a.path as string)
        if (!existsSync(file) || statSync(file).isDirectory())
          return { result: `Fichier introuvable : ${a.path}`, isError: true }
        const content = readFileSync(file, 'utf-8')
        const clipped = content.length > 12000 ? content.slice(0, 12000) + '\n…(tronque)' : content
        return { result: clipped, isError: false }
      }
      case 'write_file': {
        const file = safePath(workdir, a.path as string)
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, String(a.content ?? ''), 'utf-8')
        return { result: `Ecrit : ${a.path} (${String(a.content ?? '').length} caracteres)`, isError: false }
      }
      case 'run_command': {
        return await runCommand(workdir, String(a.command ?? ''))
      }
      default:
        return { result: `Outil inconnu : ${call.name}`, isError: true }
    }
  } catch (e: any) {
    return { result: e?.message ?? String(e), isError: true }
  }
}

/* ----------------------------- Execution via SSH ------------------------------ */

function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** Execute un outil sur une machine distante via SSH (cwd = dossier de travail distant). */
export async function executeToolSsh(sessionId: string, cwd: string, call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
  const a = call.arguments ?? {}
  const inCwd = (cmd: string): string => `cd ${shq(cwd || '.')} && ${cmd}`
  try {
    switch (call.name) {
      case 'list_dir': {
        const r = await ssh.exec(sessionId, inCwd(`ls -1Ap ${shq(String(a.path ?? '.'))}`), signal)
        return { result: r.code === 0 ? r.stdout.trim() || '(vide)' : r.stderr || 'erreur', isError: r.code !== 0 }
      }
      case 'read_file': {
        const r = await ssh.exec(sessionId, inCwd(`cat -- ${shq(String(a.path ?? ''))}`), signal)
        if (r.code !== 0) return { result: r.stderr || `Introuvable : ${a.path}`, isError: true }
        return { result: r.stdout.length > 12000 ? r.stdout.slice(0, 12000) + '\n…(tronque)' : r.stdout, isError: false }
      }
      case 'write_file': {
        const p = String(a.path ?? '')
        const b64 = Buffer.from(String(a.content ?? ''), 'utf-8').toString('base64')
        const r = await ssh.exec(
          sessionId,
          inCwd(`mkdir -p "$(dirname ${shq(p)})" && printf %s ${shq(b64)} | base64 -d > ${shq(p)}`),
          signal
        )
        return { result: r.code === 0 ? `Ecrit : ${p}` : r.stderr || 'erreur', isError: r.code !== 0 }
      }
      case 'run_command': {
        const cmd = String(a.command ?? '')
        const r = await ssh.exec(sessionId, inCwd(cmd), signal)
        const out = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.trim()
        return { result: `$ ${cmd}\n(exit ${r.code})\n${out || '(aucune sortie)'}`.slice(0, 12000), isError: r.code !== 0 }
      }
      default:
        return { result: `Outil inconnu : ${call.name}`, isError: true }
    }
  } catch (e: any) {
    return { result: e?.message ?? String(e), isError: true }
  }
}

function runCommand(workdir: string, command: string): Promise<ToolResult> {
  return new Promise((resolveP) => {
    // IMPORTANT (Windows) : on utilise `exec` (et NON execFile('cmd.exe',['/c',cmd])).
    // execFile re-echappe les guillemets en \" que cmd.exe NE comprend pas -> `dir "x"`
    // devient `dir \x\` => « fichier introuvable » alors que le fichier existe.
    // `exec` invoque `cmd.exe /d /s /c "<cmd>"` : /s preserve correctement les guillemets internes.
    // On force aussi la console en UTF-8 (chcp 65001) pour les noms de fichiers accentues.
    const isWin = process.platform === 'win32'
    const toRun = isWin ? `chcp 65001 >nul & ${command}` : command
    exec(
      toRun,
      { cwd: workdir, timeout: 120000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
        const out = `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim()
        const body = `$ ${command}\n(exit ${code})\n${out || '(aucune sortie)'}`
        resolveP({ result: body.slice(0, 12000), isError: code !== 0 })
      }
    )
  })
}
