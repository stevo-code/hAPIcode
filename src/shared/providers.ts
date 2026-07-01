// Presets de fournisseurs. La plupart des fournisseurs sont "compatibles OpenAI"
// (meme format /chat/completions), donc on les regroupe sous kind = 'openai'.

export type ProviderKind = 'openai' | 'anthropic' | 'gemini'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  docsUrl: string
  keyHint: string
  /** Modeles de secours si l'API de listing n'est pas disponible. */
  fallbackModels: string[]
  /** true = l'utilisateur doit fournir lui-meme l'URL de base. */
  custom?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    fallbackModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini']
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    fallbackModels: [
      'claude-opus-4-1',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest'
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza...',
    fallbackModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-...',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    fallbackModels: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001']
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    fallbackModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://console.mistral.ai/api-keys',
    keyHint: '...',
    fallbackModels: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest']
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://console.x.ai',
    keyHint: 'xai-...',
    fallbackModels: ['grok-2-latest', 'grok-beta']
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    keyHint: '...',
    fallbackModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  {
    id: 'custom',
    name: 'Personnalise (compatible OpenAI)',
    kind: 'openai',
    baseUrl: '',
    docsUrl: '',
    keyHint: '...',
    fallbackModels: [],
    custom: true
  }
]

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}

/**
 * Fenetre de contexte (en tokens) d'un modele.
 * Si `apiWindow` est fourni (valeur REELLE renvoyee par l'API du fournisseur), on l'utilise.
 * Sinon, heuristique sur l'identifiant (les API n'exposent pas toutes cette valeur).
 */
export function contextWindowFor(model: string, apiWindow?: number): number {
  if (apiWindow && apiWindow > 0) return apiWindow
  const m = model.toLowerCase()
  // Anthropic
  if (/claude/.test(m)) {
    if (/(opus|sonnet)-4|fable-5|mythos-5/.test(m)) return 1_000_000
    return 200_000 // claude 3.x / haiku
  }
  // Gemini
  if (/gemini/.test(m)) {
    if (/1\.5-pro/.test(m)) return 2_000_000
    return 1_000_000
  }
  // DeepSeek (V3.x : 128k ; certains deploiements 1M)
  if (/deepseek/.test(m)) return /v3\.2|deepseek-(chat|reasoner)/.test(m) ? 128_000 : 1_000_000
  // Zhipu GLM (GLM-5/5.2 : 1M ; GLM-4.6 : 200k ; GLM-4.5 : 128k)
  if (/\bglm/.test(m) || /glm-?[45]/.test(m)) {
    if (/glm-?5/.test(m)) return 1_000_000
    if (/glm-?4\.6/.test(m)) return 200_000
    return 128_000
  }
  // Qwen (turbo : 1M ; sinon 128k)
  if (/qwen/.test(m)) return /turbo/.test(m) ? 1_000_000 : 128_000
  // Moonshot / Kimi
  if (/kimi|moonshot/.test(m)) return 200_000
  // OpenAI & compatibles
  if (/(^|[-/])(o1|o3|o4|gpt-5)/.test(m)) return 400_000
  if (/gpt-4\.1/.test(m)) return 1_000_000
  if (/gpt-4o|gpt-4-turbo|gpt-4-0125|gpt-4-1106/.test(m)) return 128_000
  if (/gpt-4/.test(m)) return 8_192
  if (/gpt-3\.5/.test(m)) return 16_385
  // Meta Llama 4 (contexte massif) / Llama 3
  if (/llama-?4/.test(m)) return 1_000_000
  if (/llama-?3/.test(m)) return 128_000
  if (/mistral-large|codestral|mixtral|ministral/.test(m)) return 128_000
  if (/grok/.test(m)) return 131_072
  if (/command-?r/.test(m)) return 128_000
  return 128_000
}

/**
 * Estimation du nombre de tokens. ~3.2 caracteres / token : le code/JSON des sorties
 * d'outils (≈3) domine en mode agent — on prefere sur-estimer legerement que sous-estimer
 * (une jauge qui sous-compte laisse le contexte exploser sans compactage).
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.2)
}

/**
 * Fenetre de contexte EFFECTIVE, plafonnee a une valeur PRATIQUE.
 * Meme si un modele annonce 1M, l'app (rendu Electron) rame bien avant ; on compacte
 * a un seuil atteignable pour rester fluide. Les petites fenetres ne sont pas affectees.
 */
export const MAX_EFFECTIVE_CONTEXT = 500_000
export function effectiveWindow(realWindow: number): number {
  return Math.min(realWindow, MAX_EFFECTIVE_CONTEXT)
}

/**
 * Estime la taille (en caracteres) d'une conversation, OUTILS INCLUS : args + resultats.
 * En mode agent, les sorties d'outils (commandes, lecture de fichiers) dominent largement
 * le contexte — les ignorer fausse completement la jauge et empeche le compactage auto.
 */
type Toolish = { args?: unknown; result?: string }
export function messagesChars(
  messages: {
    content?: string
    reasoning?: string
    tools?: Toolish[]
    blocks?: ({ type: 'tool'; tool: Toolish } | { type: 'text'; text?: string })[]
  }[]
): number {
  let n = 0
  for (const m of messages) {
    // `content` contient deja tout le texte (y compris celui des blocs texte) -> pas de double compte.
    n += (m.content?.length ?? 0) + (m.reasoning?.length ?? 0)
    const tools: Toolish[] = m.blocks
      ? m.blocks.filter((b): b is { type: 'tool'; tool: Toolish } => b.type === 'tool').map((b) => b.tool)
      : m.tools ?? []
    for (const tool of tools) {
      n += tool.result?.length ?? 0
      if (tool.args != null) {
        try {
          n += JSON.stringify(tool.args).length
        } catch {
          /* args non serialisables : ignore */
        }
      }
    }
  }
  return n
}
