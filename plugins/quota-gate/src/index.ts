import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig } from './config.js'
import { QuotaService } from './core.js'
import {
  scopeFromSessionId,
  userIdFromSessionMessages,
} from './identity.js'
import { installOneBotCommandBridge } from './onebot-command.js'
import { openUsageStore } from './store.js'
import type {
  PluginContext,
  QuotaConfig,
  StreamOptions,
} from './types.js'

export * from './config.js'
export * from './core.js'
export * from './identity.js'
export * from './onebot-command.js'
export * from './store.js'
export * from './time.js'
export type * from './types.js'

export const name = 'quota-gate'
export const inject = ['llm', 'commands']

async function loadOneBotBridge(): Promise<(new (...args: never[]) => unknown) | undefined> {
  try {
    const packageUrl = import.meta.resolve('dsh-onebot-qq/package.json')
    const bridgeUrl = new URL('lib/bridge.js', packageUrl).href
    const module = (await import(bridgeUrl)) as { ChatBridge?: new (...args: never[]) => unknown }
    return module.ChatBridge
  } catch {
    return undefined
  }
}

function defaultDatabasePath(): string {
  const home =
    process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
  return join(home, 'quota-gate', 'usage.db')
}

function loggerOf(ctx: PluginContext) {
  return ctx.logger ?? console
}

export async function apply(
  ctx: PluginContext,
  input: Partial<QuotaConfig> = {},
): Promise<void> {
  const config = normalizeConfig(input)
  const logger = loggerOf(ctx)
  const store = openUsageStore(defaultDatabasePath(), {
    log: (level, message) => {
      if (level === 'warn') logger.warn?.(message)
      else logger.info?.(message)
    },
  })
  const quota = new QuotaService({
    config,
    store,
    log: (level, message) => {
      if (level === 'warn') logger.warn?.(message)
      else logger.info?.(message)
    },
  })

  ctx.on('llm/stream', (options: StreamOptions, next) =>
    quota.handleStream(options, next),
  )

  ctx.commands?.register({
    name: 'quota',
    description: '查看本群与本人的当日 token 用量',
    input: { hint: '[top|reset]' },
    handler: ({ agent, rawInput }) => {
      const sessionId = agent.session?.id
      if (sessionId === undefined) {
        return { kind: 'error', text: '当前会话没有可识别的 dsh session。' }
      }
      const scope = scopeFromSessionId(sessionId)
      if (scope === undefined) {
        return { kind: 'error', text: 'quota 只统计 dsh-onebot-qq 会话。' }
      }
      const messages = agent.session?.deriveMessages?.() ?? []
      const userId = userIdFromSessionMessages(messages) ?? scope.userId
      if (userId === '') {
        return { kind: 'error', text: '当前会话没有可识别的 QQ 发送人。' }
      }
      return quota.executeCommand(
        { groupId: scope.groupId, userId },
        rawInput,
      )
    },
  })

  let removeOneBotPatch: (() => void) | undefined
  if (config.onebotCommandBridge) {
    const oneBotBridgeClass = await loadOneBotBridge()
    if (oneBotBridgeClass === undefined) {
      logger.warn?.(
        'onebotCommandBridge is enabled, but dsh-onebot-qq/lib/bridge.js is unavailable; /quota is only registered through the host commands service.',
      )
    } else {
      removeOneBotPatch = installOneBotCommandBridge(
        oneBotBridgeClass as never,
        quota,
      )
    }
  }

  const dispose = () => {
    removeOneBotPatch?.()
    quota.close()
  }
  if (ctx.effect !== undefined) {
    ctx.effect(() => dispose, 'quota-gate.lifecycle')
  }
}
