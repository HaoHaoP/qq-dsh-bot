import { type QqMemeConfig } from './config.js';
export * from './config.js';
export * from './library.js';
export * from './picker.js';
export declare const name = "qq-meme-pick";
export declare const inject: string[];
interface PluginContext {
    tools?: {
        register(tool: unknown): unknown;
    };
    effect?: (dispose: () => void, label: string) => unknown;
    logger?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
    };
}
export declare function createQqMemeTool(config?: QqMemeConfig): unknown;
export declare function apply(ctx: PluginContext, input?: QqMemeConfig): Promise<void>;
//# sourceMappingURL=index.d.ts.map