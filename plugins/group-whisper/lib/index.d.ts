import type { GroupWhisperConfig, PluginContext } from './types.js';
export * from './analyzer.js';
export * from './config.js';
export * from './gate.js';
export * from './onebot.js';
export * from './store.js';
export type * from './types.js';
export declare const name = "group-whisper";
export declare const inject: string[];
export declare function apply(ctx: PluginContext, input?: Partial<GroupWhisperConfig> & Record<string, unknown>, options?: {
    databasePath?: string;
}): Promise<void>;
//# sourceMappingURL=index.d.ts.map