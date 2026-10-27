import type { StreamMessage, StreamOptions, UsageScope } from './types.js';
export interface ScopeWithoutDay {
    groupId: string;
    userId: string;
}
export declare function scopeFromChatId(chatId: string, userId: string): ScopeWithoutDay;
export declare function scopeFromSessionId(sessionId: string): ScopeWithoutDay | undefined;
export declare function textOf(message: StreamMessage): string;
export declare function qqUserIdFromMessage(message: StreamMessage): string | undefined;
export declare function actorFromOptions(options: StreamOptions): ScopeWithoutDay | undefined;
export declare function userIdFromSessionMessages(messages: readonly unknown[]): string | undefined;
export declare function withDay(scope: ScopeWithoutDay, day: string): UsageScope;
//# sourceMappingURL=identity.d.ts.map