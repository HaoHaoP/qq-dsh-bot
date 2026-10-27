import { DEFAULT_CONFIG } from './config.js'
import { actorFromOptions, withDay, type ScopeWithoutDay } from './identity.js'
import { totalOf, type UsageStore } from './store.js'
import { dayKeyAt, nextResetAt } from './time.js'
import type {
  CommandResult,
  NextStream,
  QuotaConfig,
  StreamChunk,
  StreamOptions,
  TokenUsage,
  UsageDelta,
  UsageRow,
  UsageScope,
} from './types.js'

export interface LimitVerdict {
  allowed: boolean
  day: string
  scope: UsageScope
  groupUsed: number
  userUsed: number
  hit: 'group' | 'user' | undefined
  used: number
  limit: number
}

interface QuotaServiceOptions {
  config: QuotaConfig
  store: UsageStore
  now?: () => Date
  log?: (level: 'warn' | 'info', message: string) => void
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

export function usageDelta(usage: TokenUsage): UsageDelta {
  return {
    // cache writes are input tokens too; the schema has no separate column.
    prompt_tokens: number(usage.inputTokens) + number(usage.cacheWriteTokens),
    completion_tokens: number(usage.outputTokens),
    cached_tokens: number(usage.cacheReadTokens),
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function finishStop(): StreamChunk {
  return { type: 'finish', reason: { kind: 'stop' } }
}

function textStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield finishStop()
  })()
}

function fillNotice(
  template: string,
  used: number,
  limit: number,
  resetAt: string,
): string {
  return template
    .replaceAll('{used}', String(used))
    .replaceAll('{limit}', String(limit))
    .replaceAll('{resetAt}', resetAt)
}

export class QuotaService {
  readonly config: QuotaConfig
  private readonly store: UsageStore
  private readonly now: () => Date
  private readonly log: (level: 'warn' | 'info', message: string) => void

  constructor(options: QuotaServiceOptions) {
    this.config = options.config
    this.store = options.store
    this.now = options.now ?? (() => new Date())
    this.log =
      options.log ??
      ((level, message) => {
        if (level === 'warn') console.warn(`[quota-gate] ${message}`)
      })
  }

  private day(now = this.now()): string {
    return dayKeyAt(now.getTime(), this.config.timezone, this.config.resetAt)
  }

  private isTracked(groupId: string): boolean {
    if (this.config.groups.length === 0 || groupId.startsWith('private:')) {
      return true
    }
    return this.config.groups.includes(groupId)
  }

  isAdmin(userId: string): boolean {
    return this.config.admins.includes(userId)
  }

  evaluate(
    actor: ScopeWithoutDay,
    now = this.now(),
  ): LimitVerdict {
    const day = this.day(now)
    const scope = withDay(actor, day)
    const groupUsed = this.store.groupTotal(scope)
    const userUsed = totalOf(this.store.get(scope))
    const allowedByAdmin = this.isAdmin(actor.userId)
    let hit: 'group' | 'user' | undefined
    if (!allowedByAdmin && this.isTracked(actor.groupId)) {
      if (this.config.groupDaily > 0 && groupUsed >= this.config.groupDaily) {
        hit = 'group'
      } else if (
        this.config.userDaily > 0 &&
        userUsed >= this.config.userDaily
      ) {
        hit = 'user'
      }
    }
    return {
      allowed: hit === undefined,
      day,
      scope,
      groupUsed,
      userUsed,
      hit,
      used: hit === 'group' ? groupUsed : userUsed,
      limit:
        hit === 'group'
          ? this.config.groupDaily
          : hit === 'user'
            ? this.config.userDaily
            : 0,
    }
  }

  record(
    actor: ScopeWithoutDay,
    usage: TokenUsage,
    now = this.now(),
  ): UsageRow {
    const scope = withDay(actor, this.day(now))
    this.store.record(scope, usageDelta(usage), now.toISOString())
    return this.store.get(scope)
  }

  private noticeFor(verdict: LimitVerdict, now: Date): string {
    if (!this.store.markNotice(verdict.scope, now.toISOString())) return ''
    return fillNotice(
      this.config.notifyText,
      verdict.used,
      verdict.limit,
      this.config.resetAt,
    )
  }

  handleStream(
    options: StreamOptions,
    next: NextStream,
    now: () => Date = this.now,
  ): AsyncIterable<StreamChunk> {
    return (async function* (service: QuotaService) {
      const actor = actorFromOptions(options)
      if (actor === undefined) {
        yield* next()
        return
      }

      const decisionNow = now()
      const verdict = service.evaluate(actor, decisionNow)
      if (!verdict.allowed) {
        service.log(
          'info',
          `blocked ${verdict.hit} budget for ${actor.groupId}/${actor.userId}`,
        )
        if (service.config.overLimit === 'notify-once') {
          const text = service.noticeFor(verdict, decisionNow)
          if (text !== '') {
            yield* textStream(text)
            return
          }
        }
        yield finishStop()
        return
      }

      let latestUsage: TokenUsage | undefined
      let recorded = false
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'usage') latestUsage = chunk.usage
          yield chunk
        }
      } finally {
        if (latestUsage !== undefined && !recorded) {
          recorded = true
          service.record(actor, latestUsage, now())
        }
      }
    })(this)
  }

  report(actor: ScopeWithoutDay, now = this.now()): string {
    const day = this.day(now)
    const scope = withDay(actor, day)
    const groupUsed = this.store.groupTotal(scope)
    const userUsed = totalOf(this.store.get(scope))
    const groupLeft =
      this.config.groupDaily === 0
        ? '不限额'
        : formatNumber(Math.max(0, this.config.groupDaily - groupUsed))
    const userLeft =
      this.config.userDaily === 0
        ? '不限额'
        : formatNumber(Math.max(0, this.config.userDaily - userUsed))
    const groupLimit =
      this.config.groupDaily === 0
        ? '不限额'
        : formatNumber(this.config.groupDaily)
    const userLimit =
      this.config.userDaily === 0
        ? '不限额'
        : formatNumber(this.config.userDaily)
    return [
      `本群今日：${formatNumber(groupUsed)} / ${groupLimit}，剩余 ${groupLeft}`,
      `本人今日：${formatNumber(userUsed)} / ${userLimit}，剩余 ${userLeft}`,
      `重置：${this.config.resetAt}（${this.config.timezone}）`,
    ].join('\n')
  }

  top(actor: ScopeWithoutDay, now = this.now()): string {
    const rows = this.store.top(withDay(actor, this.day(now)), 5)
    if (rows.length === 0) return '本群今日还没有用量。'
    return [
      '本群今日 Token 消耗前五：',
      ...rows.map(
        (row, index) =>
          `${index + 1}. ${row.user_id} — ${formatNumber(totalOf(row))}`,
      ),
    ].join('\n')
  }

  reset(actor: ScopeWithoutDay, now = this.now()): string {
    const scope = withDay(actor, this.day(now))
    const count = this.store.resetGroup(scope)
    return `已重置本群今日额度（${count} 条用量记录）。`
  }

  executeCommand(
    actor: ScopeWithoutDay,
    rawInput: string,
    now = this.now(),
  ): CommandResult {
    const input = rawInput.trim()
    if (input === '') {
      return { kind: 'success', text: this.report(actor, now) }
    }
    if (input === 'top') {
      if (!this.isAdmin(actor.userId)) {
        return { kind: 'error', text: '该命令仅管理员可用。' }
      }
      return { kind: 'success', text: this.top(actor, now) }
    }
    if (input === 'reset') {
      if (!this.isAdmin(actor.userId)) {
        return { kind: 'error', text: '该命令仅管理员可用。' }
      }
      return { kind: 'success', text: this.reset(actor, now) }
    }
    return {
      kind: 'error',
      text: '用法：/quota、/quota top（管理员）、/quota reset（管理员）',
    }
  }

  nextReset(now = this.now()): Date {
    return nextResetAt(now.getTime(), this.config.timezone, this.config.resetAt)
  }

  close(): void {
    this.store.close()
  }
}

export function fallbackConfig(): QuotaConfig {
  return { ...DEFAULT_CONFIG, groups: [], admins: [] }
}
