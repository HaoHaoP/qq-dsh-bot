export interface EnergyConfig {
  initialEnergy: number
  maxEnergy: number
  minEnergy: number
  recoveryPerSecond: number
  baseReplyCost: number
  replyCostPerCharacter: number
}

export interface LeaveReplyConfig {
  echoDetectionThreshold: number
  denseConversationThreshold: number
  familiarityCooldownDuration: number
}

export interface GroupWhisperConfig {
  enabled: boolean
  groups: string[]
  waitingTime: number
  secretaryDebounceTime: number
  observationTimeout: number
  analyzerModel: string
  energy: EnergyConfig
  leaveReply: LeaveReplyConfig
}

export type TurnMode = 'mention' | 'ordinary'
export type GateAction = 'process' | 'skip'
export type SecretaryAction = 'reply' | 'no_reply'

export interface ObservedGroupMessage {
  chatId: string
  groupId: string
  userId: string
  nickname: string
  text: string
  messageId?: string
  mentioned: boolean
  at: number
}

export interface SecretaryDecision {
  action: SecretaryAction
  reason: string
}

export interface SecretaryInput {
  chatId: string
  mode: TurnMode
  energy: number
  messages: readonly ObservedGroupMessage[]
  echoDetected: boolean
  recentReplyTopic?: string
}

export interface EnergyChange {
  before: number
  recovered: number
  after: number
}

export interface EnergyCharge extends EnergyChange {
  cost: number
  characters: number
}

export interface TurnRow {
  chat_id: string
  at: number
  mode: TurnMode
  action: string
  reason: string
  chars: number
  cost: number
}

export interface PluginLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export interface StreamChunkLike {
  type?: string
  text?: string
  block?: {
    type?: string
    text?: string
  }
  reason?: {
    kind?: string
    failure?: {
      code?: string
      message?: string
    }
  }
}

export interface LlmLike {
  listProviders?(): Array<{ id?: string }>
  listModels?(provider: string): Promise<readonly { id?: string }[]>
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: Array<{
      role: 'user'
      content: Array<{ type: 'text'; text: string }>
    }>
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<StreamChunkLike>
}

export interface PluginContext {
  on(
    event: 'session/event',
    listener: (session: { id: string }, event: {
      type?: string
      data?: {
        message?: {
          content?: readonly {
            type?: string
            text?: string
          }[]
        }
        reason?: {
          kind?: string
        }
      }
    }) => void,
  ): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
  llm?: LlmLike
  logger?: PluginLogger
}
