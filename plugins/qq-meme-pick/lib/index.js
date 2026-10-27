import { normalizeConfig } from './config.js';
import { MemePicker } from './picker.js';
export * from './config.js';
export * from './library.js';
export * from './picker.js';
export const name = 'qq-meme-pick';
export const inject = ['tools'];
export function createQqMemeTool(config = {}) {
    const picker = new MemePicker({ config });
    return {
        name: 'qq_meme',
        description: '按情绪或关键词从本地 dsh-meme 图库挑 1-3 张表情包，返回绝对文件路径与说明。' +
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
            render: (_args, value) => [{
                    type: 'text',
                    text: JSON.stringify(value),
                }],
        },
        execute: async (args) => picker.pick(args),
    };
}
export async function apply(ctx, input = {}) {
    const config = normalizeConfig(input);
    if (ctx.tools === undefined) {
        ctx.logger?.warn?.('[qq-meme-pick] tools service is unavailable; tool not registered');
        return;
    }
    const dispose = ctx.tools.register(createQqMemeTool(config));
    if (typeof dispose === 'function' && ctx.effect !== undefined) {
        ctx.effect(dispose, 'qq-meme-pick.tool');
    }
}
//# sourceMappingURL=index.js.map