import type { BgTask } from '@shared/types'

const tasks: BgTask[] = []
type Listener = (tasks: BgTask[]) => void
const listeners = new Set<Listener>()

function emit(): void {
  const snapshot = tasks.slice()
  for (const l of listeners) l(snapshot)
}

export function onChange(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function list(): BgTask[] {
  return tasks.slice()
}

export function create(t: { id: string; kind: BgTask['kind']; title: string; agentCount?: number; convId?: string }): string {
  const task: BgTask = { status: 'running', startedAt: Date.now(), ...t }
  tasks.unshift(task)
  if (tasks.length > 200) tasks.length = 200
  emit()
  return task.id
}

export function update(id: string, patch: Partial<BgTask>): void {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  Object.assign(t, patch)
  if (patch.status && patch.status !== 'running' && !t.endedAt) t.endedAt = Date.now()
  emit()
}

export function clear(): void {
  // Ne retire que les tâches terminées (garde celles en cours).
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].status !== 'running') tasks.splice(i, 1)
  emit()
}
