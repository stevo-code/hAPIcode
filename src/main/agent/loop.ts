import type { AgentMessage, ChatEvent, ReasoningEffort, StreamId, TokenUsage } from '@shared/types'
import { contextWindowFor, effectiveWindow } from '@shared/providers'
import { runTurn, type ProviderContext } from '../providers'
import { NEEDS_APPROVAL, executeTool, executeToolSsh, toolsetFor } from './tools'
import * as tasks from './tasks'

export interface AgentOptions {
  ctx: ProviderContext
  model: string
  system?: string
  messages: AgentMessage[]
  temperature?: number
  reasoningEffort?: ReasoningEffort
  workdir?: string
  /** Si renseigne, les outils s'executent sur cette machine SSH. */
  ssh?: { sessionId: string; cwd: string }
  useTools: boolean
  streamId: StreamId
  signal: AbortSignal
  emit: (e: ChatEvent) => void
  requestApproval: (callId: string) => Promise<boolean>
  /** Remontee de la consommation REELLE de tokens (agent principal uniquement). */
  onUsage?: (u: TokenUsage) => void
  /** Profondeur d'agent (0 = agent principal). */
  depth?: number
}

/**
 * Borne le contexte ENVOYE au modele pendant un tour long : tronque les plus anciens
 * resultats d'outils quand l'historique approche la fenetre du modele. Evite qu'un seul
 * tour d'agent (dizaines de commandes) ne fasse exploser le contexte (modele qui deraille,
 * PC qui rame). Les 6 resultats les plus recents restent intacts.
 */
function trimContext(messages: AgentMessage[], model: string): void {
  // Fenetre EFFECTIVE (plafonnee) : meme un modele 1M rame en pratique -> on borne le
  // contexte API a ~3 car/token, 70% de marge, pour garder l'agent vif et l'app fluide.
  const budget = effectiveWindow(contextWindowFor(model)) * 3 * 0.7
  let total = 0
  for (const m of messages) total += m.content.length
  if (total <= budget) return

  const recentToolIdx = new Set<number>()
  let seen = 0
  for (let i = messages.length - 1; i >= 0 && seen < 6; i--) {
    if (messages[i].role === 'tool') {
      recentToolIdx.add(i)
      seen++
    }
  }
  for (let i = 0; i < messages.length && total > budget; i++) {
    const m = messages[i]
    if (m.role === 'tool' && !recentToolIdx.has(i) && m.content.length > 300) {
      total -= m.content.length - 300
      m.content = m.content.slice(0, 300) + '\n…[résultat ancien tronqué pour libérer du contexte]'
    }
  }
}

// L'agent racine peut enchainer beaucoup d'etapes (taches longues : analyse, refactor…).
// Les sous-agents restent plus limites pour eviter l'emballement.
const MAX_ITERS_ROOT = 80
const MAX_ITERS_SUB = 25
const MAX_DEPTH = 2

export async function runAgent(o: AgentOptions): Promise<void> {
  const depth = o.depth ?? 0
  const maxIters = depth === 0 ? MAX_ITERS_ROOT : MAX_ITERS_SUB
  const messages: AgentMessage[] = [...o.messages]
  const hasTarget = !!o.workdir || !!o.ssh
  const tools = o.useTools && hasTarget ? toolsetFor(depth, depth < MAX_DEPTH) : undefined

  for (let iter = 0; iter < maxIters; iter++) {
    if (o.signal.aborted) return

    // Borne le contexte avant chaque appel (tronque les vieux resultats d'outils si besoin).
    trimContext(messages, o.model)

    const turn = await runTurn(
      o.ctx,
      { model: o.model, messages, system: o.system, temperature: o.temperature, reasoningEffort: o.reasoningEffort, tools },
      {
        onText: (delta) => o.emit({ streamId: o.streamId, type: 'text', delta }),
        onReasoning: (delta) => o.emit({ streamId: o.streamId, type: 'reasoning', delta }),
        signal: o.signal
      }
    )
    // Remonte le usage REEL (agent racine uniquement : runSubAgent ne passe pas onUsage,
    // car chaque sous-agent a son propre contexte separe — il ne s'ajoute pas a la conversation).
    if (turn.usage) o.onUsage?.(turn.usage)

    messages.push({
      role: 'assistant',
      content: turn.text,
      toolCalls: turn.toolCalls.length ? turn.toolCalls : undefined,
      thinkingBlocks: turn.thinkingBlocks
    })

    if (turn.toolCalls.length === 0) return

    const results = new Map<string, { result: string; isError: boolean }>()
    const spawnPromises: Promise<void>[] = []
    const setResult = (id: string, result: string, isError: boolean): void => {
      results.set(id, { result, isError })
      o.emit({ streamId: o.streamId, type: 'tool_result', callId: id, result, isError })
    }

    // 1. Sous-agents : annonce + lancement EN PARALLELE.
    for (const call of turn.toolCalls) {
      if (call.name !== 'spawn_subagent' || call.argsError) continue
      o.emit({ streamId: o.streamId, type: 'tool_call', callId: call.id, tool: call.name, args: call.arguments, needsApproval: false })
      if (depth >= MAX_DEPTH) {
        setResult(call.id, 'Profondeur maximale de sous-agents atteinte.', true)
        continue
      }
      const desc = String((call.arguments as { description?: string }).description ?? '')
      tasks.create({ id: call.id, kind: 'subagent', title: desc.slice(0, 80) || 'Sous-agent', agentCount: 1 })
      spawnPromises.push(
        runSubAgent(o, desc, depth)
          .then((text) => {
            tasks.update(call.id, { status: 'done', detail: text.slice(-240) })
            setResult(call.id, text, false)
          })
          .catch((e) => {
            const msg = e?.message ?? String(e)
            tasks.update(call.id, { status: 'error', detail: msg })
            setResult(call.id, msg, true)
          })
      )
    }

    // 2. Autres outils : SEQUENTIELS, une approbation a la fois (le tool_call n'est
    //    annonce qu'au moment de le traiter, donc un seul popup d'approbation s'affiche).
    for (const call of turn.toolCalls) {
      if (call.name === 'spawn_subagent') continue
      if (o.signal.aborted) return
      const needs = NEEDS_APPROVAL.has(call.name) && !call.argsError
      o.emit({ streamId: o.streamId, type: 'tool_call', callId: call.id, tool: call.name, args: call.arguments, needsApproval: needs })

      if (call.argsError) {
        setResult(call.id, call.argsError, true)
        continue
      }
      if (NEEDS_APPROVAL.has(call.name) && !(await o.requestApproval(call.id))) {
        setResult(call.id, "Action refusee par l'utilisateur.", true)
        continue
      }
      if (o.signal.aborted) return

      let cmdTask: string | null = null
      if (call.name === 'run_command') {
        cmdTask = call.id
        tasks.create({ id: cmdTask, kind: 'command', title: String((call.arguments as { command?: string }).command ?? '').slice(0, 80) })
      }
      const r = o.ssh ? await executeToolSsh(o.ssh.sessionId, o.ssh.cwd, call, o.signal) : await executeTool(o.workdir!, call)
      if (cmdTask) tasks.update(cmdTask, { status: r.isError ? 'error' : 'done', detail: r.result.slice(0, 240) })
      setResult(call.id, r.result, r.isError)
    }

    // 3. Attendre la fin des sous-agents.
    await Promise.all(spawnPromises)

    // 4. Empiler les resultats dans l'ordre d'origine.
    for (const call of turn.toolCalls) {
      const r = results.get(call.id) ?? { result: '', isError: false }
      messages.push({ role: 'tool', content: r.result, toolCallId: call.id, toolName: call.name })
    }
  }

  o.emit({
    streamId: o.streamId,
    type: 'text',
    delta: `\n\n_(L'agent a atteint sa limite de ${maxIters} etapes pour ce tour. Envoie « continue » pour poursuivre.)_`
  })
}

/** Lance un sous-agent autonome sur la meme cible, renvoie son resume final. */
async function runSubAgent(o: AgentOptions, description: string, depth: number): Promise<string> {
  let text = ''
  await runAgent({
    ctx: o.ctx,
    model: o.model,
    system: `${o.system ?? ''}\n\nTu es un SOUS-AGENT autonome. Accomplis UNIQUEMENT la sous-tache demandee, puis termine par un resume concis de ce que tu as fait (fichiers crees/modifies, resultat).`,
    messages: [{ role: 'user', content: description }],
    temperature: o.temperature,
    reasoningEffort: o.reasoningEffort,
    workdir: o.workdir,
    ssh: o.ssh,
    useTools: true,
    depth: depth + 1,
    streamId: o.streamId,
    signal: o.signal,
    emit: (ev) => {
      if (ev.type === 'text') text += ev.delta
    },
    requestApproval: async () => true
  })
  return text.trim() || '(sous-agent termine sans sortie)'
}
