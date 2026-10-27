import { normalizeConfig, type QqMemeConfig } from './config.js'
import { MemePicker, type QqMemeRequest, type QqMemeResult } from './picker.js'

export * from './config.js'
export * from './library.js'
export * from './picker.js'

export const name = 'qq-meme-pick'
export const inject = ['tools']

interface ToolDisposer {
  (): void
}

interface PluginContext {
  tools?: {
    register(tool: unknown): unknown
  }
  effect?: (dispose: () => void, label: string) => unknown
  logger?: {
    info?: (message: string) => void
    warn?: (message: string) => void
  }
}

export function createQqMemeTool(config: QqMemeConfig = {}): unknown {
  const picker = new MemePicker({ config })
  return {
    name: 'qq_meme',
    description:
      '按情绪或关键词从本地 dsh-meme 图库挑 1-3 张表情包，返回绝对文件路径与说明。' +
      '本工具不发送图片；发出去请配合 qq_send_image 使用，把 files 原样传给 qq_send_image。',
    parameters: {
      mood: {
        type: 'string',
        description: '情绪，例如 happy/angry/sad/shy/confused/daily，也可写开心、生气、无语、害羞、困惑、日常。',
      },
      keyword: {
        type: 'string',
        description: '关键词，优先匹配分类、说明、关键词和文件名；可空格分隔多个词。',
      },
      count: {
        type: 'number',
        description: '返回张数，默认 1，最多 3。',
        default: 1,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
          },
          caption: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args: unknown, value: QqMemeResult) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    execute: async (args: QqMemeRequest): Promise<QqMemeResult> => picker.pick(args),
  }
}

export async function apply(
  ctx: PluginContext,
  input: QqMemeConfig = {},
): Promise<void> {
  const config = normalizeConfig(input)
  if (ctx.tools === undefined) {
    ctx.logger?.warn?.('[qq-meme-pick] tools service is unavailable; tool not registered')
    return
  }

  const dispose = ctx.tools.register(createQqMemeTool(config))
  if (typeof dispose === 'function' && ctx.effect !== undefined) {
    ctx.effect(dispose as ToolDisposer, 'qq-meme-pick.tool')
  }
}
