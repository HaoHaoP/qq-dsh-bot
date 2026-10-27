import { type ScopeWithoutDay } from './identity.js';
import { type UsageStore } from './store.js';
import type { CommandResult, NextStream, QuotaConfig, StreamChunk, StreamOptions, TokenUsage, UsageDelta, UsageRow, UsageScope } from './types.js';
export interface LimitVerdict {
    allowed: boolean;
    day: string;
    scope: UsageScope;
    groupUsed: number;
    userUsed: number;
    hit: 'group' | 'user' | undefined;
    used: number;
    limit: number;
}
interface QuotaServiceOptions {
    config: QuotaConfig;
    store: UsageStore;
    now?: () => Date;
    log?: (level: 'warn' | 'info', message: string) => void;
}
export declare function usageDelta(usage: TokenUsage): UsageDelta;
export declare class QuotaService {
    readonly config: QuotaConfig;
    private readonly store;
    private readonly now;
    private readonly log;
    constructor(options: QuotaServiceOptions);
    private day;
    private isTracked;
    isAdmin(userId: string): boolean;
    evaluate(actor: ScopeWithoutDay, now?: Date): LimitVerdict;
    record(actor: ScopeWithoutDay, usage: TokenUsage, now?: Date): UsageRow;
    private noticeFor;
    handleStream(options: StreamOptions, next: NextStream, now?: () => Date): AsyncIterable<StreamChunk>;
    report(actor: ScopeWithoutDay, now?: Date): string;
    top(actor: ScopeWithoutDay, now?: Date): string;
    reset(actor: ScopeWithoutDay, now?: Date): string;
    executeCommand(actor: ScopeWithoutDay, rawInput: string, now?: Date): CommandResult;
    nextReset(now?: Date): Date;
    close(): void;
}
export declare function fallbackConfig(): QuotaConfig;
export {};
//# sourceMappingURL=core.d.ts.map