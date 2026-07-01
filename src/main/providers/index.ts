import { randomUUID } from 'crypto'
import type { AgentMessage, ReasoningEffort, TokenUsage, ToolCall, ToolDef } from '@shared/types'
import type { ProviderKind } from '@shared/providers'

export interface ProviderContext {
  kind: ProviderKind
  baseUrl: string
  apiKey: string
}

export interface TurnParams {
  model: string
  messages: AgentMessage[]
  system?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDef[]
  reasoningEffort?: ReasoningEffort
}

export interface TurnHandlers {
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
  signal?: AbortSignal
}

export interface AssistantTurn {
  text: string
  toolCalls: ToolCall[]
  /** Blocs de raisonnement bruts (Anthropic) a rejouer au tour suivant. */
  thinkingBlocks?: unknown[]
  /** Consommation REELLE de tokens renvoyee par l'API (taille exacte du contexte). */
  usage?: TokenUsage
}

/* --------------------------------- Listing ------------------------------------ */

/** Un modele liste, avec sa fenetre de contexte REELLE si l'API la fournit. */
export interface ModelListing {
  id: string
  contextWindow?: number
}

export async function listModels(ctx: ProviderContext): Promise<ModelListing[]> {
  switch (ctx.kind) {
    case 'openai':
      return listOpenAiModels(ctx)
    case 'anthropic':
      return listAnthropicModels(ctx)
    case 'gemini':
      return listGeminiModels(ctx)
  }
}

/** Cherche une fenetre de contexte dans les champs courants des reponses /models. */
function ctxFromModel(m: any): number | undefined {
  const raw =
    m?.context_length ??
    m?.context_window ??
    m?.max_context_length ??
    m?.max_model_len ??
    m?.contextWindow ??
    m?.context_size ??
    m?.top_provider?.context_length
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Deduplique par id (garde la fenetre de contexte si l'une des copies la fournit) + tri. */
function dedupListings(arr: ModelListing[]): ModelListing[] {
  const map = new Map<string, ModelListing>()
  for (const m of arr) {
    if (!m.id) continue
    const prev = map.get(m.id)
    if (!prev) map.set(m.id, m)
    else if (m.contextWindow && !prev.contextWindow) map.set(m.id, m)
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id))
}

async function listOpenAiModels(ctx: ProviderContext): Promise<ModelListing[]> {
  const res = await fetch(`${ctx.baseUrl}/models`, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
  if (!res.ok) throw new Error(await errText(res))
  const json: any = await res.json()
  const data = json.data ?? json.models ?? []
  return dedupListings(data.map((m: any) => ({ id: m.id ?? m.name, contextWindow: ctxFromModel(m) })))
}

async function listAnthropicModels(ctx: ProviderContext): Promise<ModelListing[]> {
  const res = await fetch(`${ctx.baseUrl}/v1/models?limit=1000`, {
    headers: { 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' }
  })
  if (!res.ok) throw new Error(await errText(res))
  const json: any = await res.json()
  return dedupListings((json.data ?? []).map((m: any) => ({ id: m.id, contextWindow: ctxFromModel(m) })))
}

async function listGeminiModels(ctx: ProviderContext): Promise<ModelListing[]> {
  const res = await fetch(`${ctx.baseUrl}/models?pageSize=1000&key=${encodeURIComponent(ctx.apiKey)}`)
  if (!res.ok) throw new Error(await errText(res))
  const json: any = await res.json()
  return dedupListings(
    (json.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => ({
        id: String(m.name ?? '').replace(/^models\//, ''),
        // Gemini expose la limite d'entree directement.
        contextWindow: typeof m.inputTokenLimit === 'number' && m.inputTokenLimit > 0 ? m.inputTokenLimit : undefined
      }))
  )
}

/* ------------------------------- Tour de chat --------------------------------- */

export async function runTurn(
  ctx: ProviderContext,
  params: TurnParams,
  h: TurnHandlers
): Promise<AssistantTurn> {
  switch (ctx.kind) {
    case 'openai':
      return runOpenAi(ctx, params, h)
    case 'anthropic':
      return runAnthropic(ctx, params, h)
    case 'gemini':
      return runGemini(ctx, params, h)
  }
}

type ApiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

function effortOn(effort?: ReasoningEffort): boolean {
  return !!effort && effort !== 'off'
}

/** ultracode -> max ; sinon identite (off ne devrait pas arriver ici). */
function canonicalEffort(level: ReasoningEffort): ApiEffort {
  if (level === 'ultracode') return 'max'
  if (level === 'off') return 'low'
  return level
}

/* -- Anthropic : output_config.effort, avec rabattement si le modele ne supporte pas xhigh/max -- */
function anthropicEffort(model: string, level: ReasoningEffort): ApiEffort {
  let e = canonicalEffort(level)
  const m = model.toLowerCase()
  const xhighOk = /opus-4-(7|8)|fable-5|mythos-5/.test(m)
  const maxOk = /opus-4-(5|6|7|8)|sonnet-4-6|fable-5|mythos-5/.test(m)
  if (e === 'xhigh' && !xhighOk) e = 'high'
  if (e === 'max' && !maxOk) e = 'high'
  return e
}

/** Budget pour l'extended thinking legacy (anciens modeles Claude). */
function legacyBudget(level: ReasoningEffort): number {
  return { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 32768 }[canonicalEffort(level)]
}

/** OpenAI : sous-ensemble universellement accepte (xhigh/max rabattus sur high). */
function openaiEffort(level: ReasoningEffort): 'low' | 'medium' | 'high' {
  const e = canonicalEffort(level)
  return e === 'xhigh' || e === 'max' ? 'high' : e
}

/** DeepSeek : seules 'high' et 'max' agissent. */
function deepseekEffort(level: ReasoningEffort): 'high' | 'max' {
  const e = canonicalEffort(level)
  return e === 'xhigh' || e === 'max' ? 'max' : 'high'
}

/** Gemini 2.5 : budget de tokens (null = ne pas envoyer de thinkingConfig). */
function geminiBudget(model: string, level: ReasoningEffort): number | null {
  const m = model.toLowerCase()
  if (!/gemini-2\.5/.test(m)) return null
  let b = { low: 512, medium: 4096, high: 16384, xhigh: 24576, max: 24576 }[canonicalEffort(level)]
  if (/pro/.test(m)) {
    if (canonicalEffort(level) === 'max') b = 32768
    b = Math.min(Math.max(b, 128), 32768)
  } else {
    b = Math.min(Math.max(b, /lite/.test(m) ? 512 : 0), 24576)
  }
  return b
}

/* ---------------------------------- OpenAI ------------------------------------ */

function openaiSupportsReasoning(model: string): boolean {
  return /(^|[-/])(o1|o3|o4|gpt-5)/i.test(model)
}

function mapOpenAiMessages(p: TurnParams): any[] {
  const out: any[] = []
  if (p.system) out.push({ role: 'system', content: p.system })
  for (const m of p.messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const parts: any[] = []
        if (m.content) parts.push({ type: 'text', text: m.content })
        for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })
        out.push({ role: 'user', content: parts })
      } else {
        out.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content || '' }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) }
        }))
      }
      out.push(msg)
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

async function runOpenAi(ctx: ProviderContext, p: TurnParams, h: TurnHandlers): Promise<AssistantTurn> {
  const on = effortOn(p.reasoningEffort)
  const isDeepSeek = /deepseek/i.test(ctx.baseUrl)
  const oaReasoningModel = openaiSupportsReasoning(p.model)
  const body: any = { model: p.model, messages: mapOpenAiMessages(p), stream: true, stream_options: { include_usage: true } }
  if (p.tools?.length) {
    body.tools = p.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    body.tool_choice = 'auto'
  }
  if (isDeepSeek) {
    // DeepSeek (compatible OpenAI) : le raisonnement passe par le mode thinking + reasoning_effort.
    if (on) {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = deepseekEffort(p.reasoningEffort!)
    } else {
      body.thinking = { type: 'disabled' }
    }
  } else if (on && oaReasoningModel) {
    body.reasoning_effort = openaiEffort(p.reasoningEffort!)
  }
  if (p.temperature != null && !oaReasoningModel && !isDeepSeek) body.temperature = p.temperature

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.apiKey}`,
    'HTTP-Referer': 'https://copieclaudecode.app',
    'X-Title': 'CopieClaudeCode'
  }
  const send = (): Promise<Response> =>
    fetch(`${ctx.baseUrl}/chat/completions`, { method: 'POST', signal: h.signal, headers, body: JSON.stringify(body) })

  let res = await send()
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    // Certains gateways compatibles OpenAI rejettent stream_options : on retente sans
    // (le usage retombe alors sur l'estimation cote app, pas de blocage du tour).
    if (body.stream_options && /stream_options|include_usage/i.test(errBody)) {
      delete body.stream_options
      res = await send()
    } else {
      throw new Error(errBody.trim().slice(0, 600) || `HTTP ${res.status}`)
    }
  }
  if (!res.ok || !res.body) throw new Error(await errText(res))

  let text = ''
  let usage: TokenUsage | undefined
  const tcAcc: { id: string; name: string; args: string }[] = []
  await consumeSSE(res, h.signal, (data) => {
    if (data === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    // Le dernier chunk (stream_options.include_usage) porte le usage exact, choices vide.
    if (json.usage) usage = { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
    const delta = json.choices?.[0]?.delta
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content
      h.onText(delta.content)
    }
    // Raisonnement : `reasoning` (OpenAI/OpenRouter) OU `reasoning_content` (DeepSeek).
    if (typeof delta.reasoning === 'string' && delta.reasoning) h.onReasoning(delta.reasoning)
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) h.onReasoning(delta.reasoning_content)
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? 0
        if (!tcAcc[i]) tcAcc[i] = { id: tc.id ?? randomUUID(), name: '', args: '' }
        if (tc.id) tcAcc[i].id = tc.id
        if (tc.function?.name) tcAcc[i].name = tc.function.name
        if (tc.function?.arguments) tcAcc[i].args += tc.function.arguments
      }
    }
  })

  return {
    text,
    usage,
    toolCalls: tcAcc.filter(Boolean).map((t) => {
      const parsed = parseArgs(t.args)
      return { id: t.id, name: t.name, arguments: parsed.value, argsError: parsed.error }
    })
  }
}

/* --------------------------------- Anthropic ---------------------------------- */

/** Modeles 4.6+ : thinking adaptatif + output_config.effort. Anciens : enabled+budget_tokens. */
function anthropicThinkingMode(model: string): 'adaptive' | 'legacy' | 'none' {
  const m = model.toLowerCase()
  if (/opus-4-(6|7|8)|sonnet-4-6|fable-5|mythos-5/.test(m)) return 'adaptive'
  if (/opus-4-(0|1|5)|sonnet-4-(0|5)|3-7-sonnet/.test(m)) return 'legacy'
  return 'none'
}

function mapAnthropicMessages(p: TurnParams, thinkingEnabled: boolean): any[] {
  const out: any[] = []
  for (const m of p.messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const blocks: any[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const img of m.images) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })
        out.push({ role: 'user', content: blocks })
      } else {
        out.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      const blocks: any[] = []
      // Rejouer les blocs de raisonnement (avec signature) tels quels — requis par l'API quand thinking est actif.
      if (thinkingEnabled && Array.isArray(m.thinkingBlocks)) blocks.push(...m.thinkingBlocks)
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} })
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block)
      else out.push({ role: 'user', content: [block] })
    }
  }
  return out
}

async function runAnthropic(ctx: ProviderContext, p: TurnParams, h: TurnHandlers): Promise<AssistantTurn> {
  const mode = effortOn(p.reasoningEffort) ? anthropicThinkingMode(p.model) : 'none'
  const thinkingEnabled = mode !== 'none'

  const body: any = { model: p.model, stream: true, messages: mapAnthropicMessages(p, thinkingEnabled) }
  if (p.system) body.system = p.system
  if (p.tools?.length) body.tools = p.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))

  if (mode === 'adaptive') {
    body.max_tokens = p.maxTokens ?? 16000
    body.thinking = { type: 'adaptive', display: 'summarized' }
    body.output_config = { effort: anthropicEffort(p.model, p.reasoningEffort!) } // low|medium|high|xhigh|max (rabattu)
  } else if (mode === 'legacy') {
    const budget = legacyBudget(p.reasoningEffort!)
    body.max_tokens = budget + 8192
    body.thinking = { type: 'enabled', budget_tokens: budget }
  } else {
    body.max_tokens = p.maxTokens ?? 4096
    if (p.temperature != null) body.temperature = p.temperature
  }

  const res = await fetch(`${ctx.baseUrl}/v1/messages`, {
    method: 'POST',
    signal: h.signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) throw new Error(await errText(res))

  let text = ''
  let stopReason = ''
  let inTok = 0
  let outTok = 0
  const blocks = new Map<
    number,
    { type: string; id?: string; name?: string; json: string; thinking: string; signature: string; data?: string }
  >()

  await consumeSSE(res, h.signal, (data) => {
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    if (json.type === 'message_start' && json.message?.usage) inTok = json.message.usage.input_tokens ?? 0
    if (json.usage?.output_tokens != null) outTok = json.usage.output_tokens
    if (json.type === 'message_delta' && json.usage?.output_tokens != null) outTok = json.usage.output_tokens
    if (json.type === 'content_block_start') {
      const b = json.content_block
      blocks.set(json.index, { type: b.type, id: b.id, name: b.name, json: '', thinking: '', signature: '', data: b.data })
    } else if (json.type === 'content_block_delta') {
      const d = json.delta
      const blk = blocks.get(json.index)
      if (d.type === 'text_delta') {
        text += d.text
        h.onText(d.text)
      } else if (d.type === 'thinking_delta') {
        if (blk) blk.thinking += d.thinking ?? ''
        h.onReasoning(d.thinking ?? '')
      } else if (d.type === 'signature_delta') {
        if (blk) blk.signature += d.signature ?? ''
      } else if (d.type === 'input_json_delta') {
        if (blk) blk.json += d.partial_json ?? ''
      }
    } else if (json.type === 'message_delta') {
      if (json.delta?.stop_reason) stopReason = json.delta.stop_reason
    }
  })

  const toolCalls: ToolCall[] = []
  const thinkingBlocks: unknown[] = []
  for (const b of blocks.values()) {
    if (b.type === 'tool_use') {
      const parsed = parseArgs(b.json)
      toolCalls.push({ id: b.id ?? randomUUID(), name: b.name ?? '', arguments: parsed.value, argsError: parsed.error })
    } else if (b.type === 'thinking') {
      thinkingBlocks.push({ type: 'thinking', thinking: b.thinking, signature: b.signature })
    } else if (b.type === 'redacted_thinking') {
      thinkingBlocks.push({ type: 'redacted_thinking', data: b.data })
    }
  }

  if (stopReason === 'refusal' && !text) {
    h.onText('⚠️ Requête refusée par le modèle (refus de sécurité).')
  }

  return {
    text,
    toolCalls,
    thinkingBlocks: thinkingBlocks.length ? thinkingBlocks : undefined,
    usage: inTok || outTok ? { inputTokens: inTok, outputTokens: outTok } : undefined
  }
}

/* ---------------------------------- Gemini ------------------------------------ */

function mapGeminiContents(p: TurnParams): any[] {
  const out: any[] = []
  for (const m of p.messages) {
    if (m.role === 'user') {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const img of m.images ?? []) parts.push({ inlineData: { mimeType: img.mime, data: img.data } })
      out.push({ role: 'user', parts: parts.length ? parts : [{ text: m.content }] })
    } else if (m.role === 'assistant') {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const tc of m.toolCalls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.arguments ?? {} } })
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
    } else if (m.role === 'tool') {
      out.push({ role: 'user', parts: [{ functionResponse: { name: m.toolName ?? 'tool', response: { result: m.content } } }] })
    }
  }
  return out
}

async function runGemini(ctx: ProviderContext, p: TurnParams, h: TurnHandlers): Promise<AssistantTurn> {
  const body: any = { contents: mapGeminiContents(p) }
  if (p.system) body.systemInstruction = { parts: [{ text: p.system }] }
  if (p.tools?.length)
    body.tools = [{ functionDeclarations: p.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  const gen: any = {}
  if (p.temperature != null) gen.temperature = p.temperature
  if (effortOn(p.reasoningEffort)) {
    const budget = geminiBudget(p.model, p.reasoningEffort!)
    if (budget != null) gen.thinkingConfig = { thinkingBudget: budget, includeThoughts: true }
  }
  if (Object.keys(gen).length) body.generationConfig = gen

  const url = `${ctx.baseUrl}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(ctx.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    signal: h.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) throw new Error(await errText(res))

  let text = ''
  let usage: TokenUsage | undefined
  const toolCalls: ToolCall[] = []
  await consumeSSE(res, h.signal, (data) => {
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    if (json.usageMetadata) {
      usage = { inputTokens: json.usageMetadata.promptTokenCount ?? 0, outputTokens: json.usageMetadata.candidatesTokenCount ?? 0 }
    }
    const parts = json.candidates?.[0]?.content?.parts ?? []
    for (const part of parts) {
      if (typeof part.text === 'string') {
        if (part.thought === true) h.onReasoning(part.text)
        else {
          text += part.text
          h.onText(part.text)
        }
      }
      if (part.functionCall) {
        toolCalls.push({ id: randomUUID(), name: part.functionCall.name, arguments: part.functionCall.args ?? {} })
      }
    }
  })
  return { text, toolCalls, usage }
}

/* --------------------------------- Helpers ------------------------------------ */

/**
 * Lecteur SSE conforme : accumule les lignes `data:` d'un meme evenement (jointes par \n)
 * et n'emet le payload qu'a la frontiere (ligne vide).
 */
async function consumeSSE(res: Response, signal: AbortSignal | undefined, onEvent: (data: string) => void): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  const flush = (): void => {
    if (dataLines.length) {
      const payload = dataLines.join('\n')
      dataLines = []
      onEvent(payload)
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (line === '') {
          flush()
        } else if (line.startsWith('data:')) {
          let d = line.slice(5)
          if (d.startsWith(' ')) d = d.slice(1)
          dataLines.push(d)
        }
        // les lignes event:/id:/retry: sont ignorees
      }
    }
    flush()
  } catch (e: any) {
    if (e?.name === 'AbortError' || signal?.aborted) return
    throw e
  }
}

function parseArgs(s: string): { value: Record<string, unknown>; error?: string } {
  if (!s || !s.trim()) return { value: {} }
  try {
    return { value: JSON.parse(s) }
  } catch (e: any) {
    return { value: {}, error: `Arguments JSON invalides (${e?.message ?? 'parse error'}). Reformule l'appel d'outil.` }
  }
}

async function errText(res: Response): Promise<string> {
  let body = ''
  try {
    body = await res.text()
  } catch {
    /* ignore */
  }
  let detail = body
  try {
    const json = JSON.parse(body)
    detail = json.error?.message ?? json.message ?? json.error ?? body
  } catch {
    /* texte brut */
  }
  return `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
}

function uniqSort(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b))
}
