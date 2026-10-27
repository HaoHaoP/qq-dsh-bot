import type { UsageDelta, UsageRow, UsageScope } from './types.js';
export interface UsageStore {
    readonly backend: 'sqlite' | 'json';
    record(scope: UsageScope, delta: UsageDelta, updatedAt: string): void;
    get(scope: UsageScope): UsageRow;
    groupTotal(scope: Pick<UsageScope, 'day' | 'groupId'>): number;
    top(scope: Pick<UsageScope, 'day' | 'groupId'>, limit: number): UsageRow[];
    resetGroup(scope: Pick<UsageScope, 'day' | 'groupId'>): number;
    markNotice(scope: UsageScope, updatedAt: string): boolean;
    close(): void;
}
export declare function totalOf(row: UsageRow): number;
export interface OpenStoreOptions {
    forceBackend?: 'sqlite' | 'json';
    log?: (level: 'warn' | 'info', message: string) => void;
}
export declare function openUsageStore(databasePath: string, options?: OpenStoreOptions): UsageStore;
//# sourceMappingURL=store.d.ts.map