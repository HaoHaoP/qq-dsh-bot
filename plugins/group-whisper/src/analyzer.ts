import type {
  LlmLike,
  SecretaryDecision,
  SecretaryInput,
  StreamChunkLike,
} from './types.js'

interface AnalyzerOptions {
  llm: LlmLike | undefined
  model: string
  preferredProvider?: string
  log?(message: string): void
}

interface Route {
  provider: string
  model: string
}

const SYSTEM_PROMPT = [
  '你是群聊主动发言门控的秘书，只判断此刻是否应由机器人接话。',
  '只输出一个 JSON 对象，不要 Markdown，不要额外解释。',
  '格式固定为 {"action":"reply"|"no_reply","reason":"不超过40字的理由"}。',
  '适合接话：有人提问或求助、有人明显需要回应、玩梗或复读适合跟一句、冷场需要自然收尾。',
  '不该接话：吵架、已有完整答案、纯表情、只是重复机器人刚说过的话、信息不足。',
  '这是主动接话，不是每个问题都必须回答；宁可 no_reply，也不要为了存在感插话。',
].join('\n')

function textOfBlocks(chunks: readonly string[]): string {
  return chunks.join('').trim()
}

function jsonObject(text: string): Record<string, unknown> | undefined {
  const stripped = text.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  for (const candidate of [
    stripped,
    stripped.slice(stripped.indexOf('{'), stripped.lastIndexOf('}') + 1),
  ]) {
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue
    try {
      const value = JSON.parse(candidate) as unknown
      if (typeof value === 'object' && value !== null) {
        return value as Record<string, unknown>
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

function parseDecision(text: string): SecretaryDecision {
  const value = jsonObject(text)
  if (value === undefined) return { action: 'no_reply', reason: 'analyzer_invalid' }

  let action: SecretaryDecision['action']
  if (value.action === 'reply' || value.action === 'no_reply') {
    action = value.action
  } else if (typeof value.should_reply === 'boolean') {
    action = value.should_reply ? 'reply' : 'no_reply'
  } else {
    action = 'no_reply'
  }
  const reasonValue = value.reason ?? value.reply_strategy
  const reason =
    typeof reasonValue === 'string' && reasonValue.trim() !== ''
      ? reasonValue.trim().replace(/[\r\n]+/gu, ' ').slice(0, 80)
      : action === 'reply'
        ? '适合接话'
        : '继续观察'
  return { action, reason }
}

function userText(input: SecretaryInput): string {
  const lines: string[] = []
  let used = 0
  for (const message of input.messages.slice(-16)) {
    const text = message.text.replace(/\s+/gu, ' ').trim().slice(0, 600)
    const line = `[${message.nickname || message.userId}] ${text}`
    if (used + line.length > 8000) break
    lines.push(line)
    used += line.length
  }
  return [
    `mode=${input.mode}`,
    `energy=${input.energy.toFixed(2)}`,
    `echo_detected=${input.echoDetected ? 'true' : 'false'}`,
    input.recentReplyTopic === undefined
      ? 'recent_reply_topic=none'
      : `recent_reply_topic=${input.recentReplyTopic.slice(0, 120)}`,
    '最近群聊：',
    ...lines,
    '请判断此刻是否应该主动接一句。',
  ].join('\n')
}

export class ModelDecider {
  private readonly llm: LlmLike | undefined
  private readonly model: string
  private readonly preferredProvider: string | undefined
  private route: Promise<Route> | undefined

  constructor(options: AnalyzerOptions) {
    this.llm = options.llm
    this.model = options.model
    this.preferredProvider = options.preferredProvider
  }

  private resolveRoute(): Promise<Route> {
    if (this.route !== undefined) return this.route
    this.route = (async () => {
      const llm = this.llm
      if (llm === undefined) throw new Error('llm service is unavailable')
      const providers = (llm.listProviders?.() ?? [])
        .map(provider => provider.id)
        .filter((provider): provider is string => typeof provider === 'string' && provider !== '')

      const candidates = [
        this.preferredProvider,
        ...providers.filter(provider => provider !== this.preferredProvider),
      ].filter((provider): provider is string => provider !== undefined)

      for (const provider of candidates) {
        if (llm.listModels === undefined) {
          return { provider, model: this.model }
        }
        try {
          const models = await llm.listModels(provider)
          if (models.some(model => model.id === this.model)) {
            return { provider, model: this.model }
          }
        } catch {
          // A live route may still accept the configured model directly.
        }
      }
      if (candidates[0] !== undefined) {
        return { provider: candidates[0], model: this.model }
      }
      return { provider: 'deepseek', model: this.model }
    })()
    return this.route
  }

  async decide(input: SecretaryInput): Promise<SecretaryDecision> {
    const llm = this.llm
    if (llm === undefined) throw new Error('llm service is unavailable')
    const route = await this.resolveRoute()
    const chunks: string[] = []
    let fallback = ''
    let finishKind = ''

    for await (const chunk of llm.stream({
      ...route,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: userText(input) }],
      }],
      temperature: 0,
      maxTokens: 300,
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        chunks.push(chunk.text)
      } else if (
        chunk.type === 'block-end' &&
        chunk.block?.type === 'text' &&
        typeof chunk.block.text === 'string'
      ) {
        fallback = chunk.block.text
      } else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? ''
      }
    }

    if (finishKind === 'error' || finishKind === 'aborted') {
      throw new Error(`analyzer finished with ${finishKind}`)
    }
    return parseDecision(textOfBlocks(chunks) || fallback)
  }
}

export function createModelDecider(options: AnalyzerOptions): ModelDecider {
  return new ModelDecider(options)
}
