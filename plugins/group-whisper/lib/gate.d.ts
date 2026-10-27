import type { GateAction, GroupWhisperConfig, ObservedGroupMessage, SecretaryAction, SecretaryDecision, SecretaryInput, TurnMode } from './types.js';
import { StateStore } from './store.js';
export interface PatrolOutcome {
    mode: TurnMode;
    action: GateAction;
    reason: string;
    energy: number;
    recovered: number;
    cooldown: 'pass' | 'active';
}
export interface SecretaryOutcome {
    mode: TurnMode;
    action: SecretaryAction;
    reason: string;
    dispatched: boolean;
}
export type WhisperOutcome = PatrolOutcome | SecretaryOutcome;
export interface DispatchInput {
    chatId: string;
    mode: TurnMode;
    nickname: string;
    prompt: string;
    messages: readonly ObservedGroupMessage[];
}
export interface WhisperGateOptions {
    config: GroupWhisperConfig;
    store: StateStore;
    decide(input: SecretaryInput): Promise<SecretaryDecision>;
    dispatch(input: DispatchInput): Promise<void>;
    isBusy?(chatId: string): boolean;
    log?(message: string): void;
    now?(): number;
    schedule?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
    cancel?(handle: ReturnType<typeof setTimeout>): void;
}
export declare function topicKey(messages: readonly ObservedGroupMessage[]): string;
export declare function sameTopic(left: string, right: string): boolean;
export declare class WhisperGate {
    readonly config: GroupWhisperConfig;
    readonly store: StateStore;
    private readonly decide;
    private readonly dispatch;
    private readonly isBusy;
    private readonly logLine;
    private readonly now;
    private readonly schedule;
    private readonly cancel;
    private readonly states;
    private closed;
    constructor(options: WhisperGateOptions);
    isEnabled(): boolean;
    private stateOf;
    private log;
    private transition;
    private prune;
    private armTimer;
    private resetTimer;
    private retryLater;
    observe(message: ObservedGroupMessage): boolean;
    private isCooldown;
    patrol(chatId: string): Promise<WhisperOutcome>;
    private secretary;
    private buildPrompt;
    onAssistantMessage(chatId: string, text: string): void;
    settle(chatId: string, text: string, now?: number): {
        mode: TurnMode;
        characters: number;
        cost: number;
        before: number;
        after: number;
    } | undefined;
    onTurnEnd(chatId: string, reason?: string): void;
    dispose(): void;
}
//# sourceMappingURL=gate.d.ts.map