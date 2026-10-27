import type { PluginContext, QuotaConfig } from './types.js';
export * from './config.js';
export * from './core.js';
export * from './identity.js';
export * from './onebot-command.js';
export * from './store.js';
export * from './time.js';
export type * from './types.js';
export declare const name = "quota-gate";
export declare const inject: string[];
export declare function apply(ctx: PluginContext, input?: Partial<QuotaConfig>): Promise<void>;
//# sourceMappingURL=index.d.ts.map