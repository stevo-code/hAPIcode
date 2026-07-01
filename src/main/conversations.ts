import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Conversation } from '@shared/types'

let filePath = ''
let cache: Conversation[] | null = null

function file(): string {
  if (!filePath) filePath = join(app.getPath('userData'), 'cccc-conversations.json')
  return filePath
}

function load(): Conversation[] {
  if (cache) return cache
  if (existsSync(file())) {
    try {
      cache = JSON.parse(readFileSync(file(), 'utf-8')) as Conversation[]
      return cache
    } catch {
      /* fichier corrompu */
    }
  }
  cache = []
  return cache
}

function persist(): void {
  if (cache) writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf-8')
}

/** On ne stocke pas les drapeaux de streaming volatils. */
function clean(c: Conversation): Conversation {
  return {
    ...c,
    messages: c.messages.map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      // `blocks` contient les appels d'outils ET leurs RESULTATS : indispensable pour que le
      // contexte survive a un redemarrage (sinon l'agent reperd tout et refait le travail).
      // (Les `attachments` images base64 restent NON persistes pour ne pas gonfler le fichier.)
      blocks: m.blocks,
      tools: m.tools,
      error: m.error
    }))
  }
}

export function list(): Conversation[] {
  return load()
}

export function upsert(conv: Conversation): void {
  const all = load()
  const i = all.findIndex((c) => c.id === conv.id)
  const cleaned = clean(conv)
  if (i >= 0) all[i] = cleaned
  else all.push(cleaned)
  persist()
}

export function remove(id: string): void {
  cache = load().filter((c) => c.id !== id)
  persist()
}
