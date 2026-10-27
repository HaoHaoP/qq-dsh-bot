export interface QuotaConfig {
  groupDaily: number
  userDaily: number
  resetAt: string
  timezone: string
  groups: string[]
  overLimit: 'silent' | 'notify-once'
  notifyText: string
  admins: string[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: 'text' }
  | { type: 'text-delta'; index: number; text: string }
  | {
      type: 'block-end'
      index: number
      block: { type: 'text'; text: string }
    }
  | { type: 'usage'; usage: TokenUsage }
  | {
      type: 'finish'
      reason:
        | { kind: 'stop' }
        | { kind: 'tool-calls' }
        | { kind: 'max-tokens' }
        | { kind: 'aborted'; failure: unknown }
        | { kind: 'error'; failure: unknown }
      replayState?: unknown
    }

export interface StreamMessage {
  role?: string
  source?: { kind?: string }
  content?: readonly { type?: string; text?: string }[]
}

export interface StreamOptions {
  sessionId?: string
  purpose?: string
  messages?: readonly StreamMessage[]
}

export type NextStream = () => AsyncIterable<StreamChunk>

export interface UsageRow {
  day: string
  group_id: string
  user_id: string
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  requests: number
  updated_at: string
}

export interface UsageDelta {
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
}

export interface UsageScope {
  day: string
  groupId: string
  userId: string
}

export interface CommandResult {
  kind: 'success' | 'error'
  text: string
}

export interface PluginLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export interface CommandDefinitionLike {
  name: string
  description: string
  input?: { hint: string }
  handler: (invocation: {
    agent: {
      session?: {
        id: string
        deriveMessages?(): readonly unknown[]
      }
    }
    rawInput: string
  }) => CommandResult | Promise<CommandResult>
}

export interface PluginContext {
  on(
    event: 'llm/stream',
    listener: (
      options: StreamOptions,
      next: NextStream,
    ) => AsyncIterable<StreamChunk>,
  ): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
  commands?: {
    register(definition: CommandDefinitionLike): () => void
  }
  logger?: PluginLogger
}
