import type { GroupWhisperConfig } from './types.js';
import type { DispatchInput, WhisperGate } from './gate.js';
interface RawSegment {
    type?: string;
    data?: {
        text?: string;
        qq?: string | number;
        name?: string;
    };
}
interface RawOneBotEvent {
    post_type?: string;
    message_type?: string;
    message_id?: string | number;
    group_id?: string | number;
    user_id?: string | number;
    raw_message?: string;
    self_id?: string | number;
    message?: string | RawSegment[];
    sender?: {
        card?: string;
        nickname?: string;
    };
}
interface BridgeChat {
    agent?: {
        status?: string;
    };
}
interface ChatBridgeLike {
    deps?: {
        connection?: {
            selfId?: string;
        };
        policy?: {
            groupPolicy?: string;
            groupAllowFrom?: readonly string[];
        };
        config?: {
            ignoreSelf?: boolean;
        };
    };
    chats?: Map<string, BridgeChat>;
    bySession?: Map<string, string>;
    handleInbound(event: RawOneBotEvent, opts?: {
        injected?: boolean;
    }): Promise<void>;
    ensureChat?(chatId: string, nickname: string): Promise<unknown>;
    dispatchFollowup?(chatId: string, text: string, role: 'admin' | 'member', nickname?: string): Promise<void>;
}
type ChatBridgeConstructor = {
    prototype: ChatBridgeLike & {
        handleInbound(event: RawOneBotEvent, opts?: {
            injected?: boolean;
        }): Promise<void>;
    };
};
export interface InboundAdapter {
    chatForSession(sessionId: string): string | undefined;
    dispatch(input: DispatchInput): Promise<void>;
    isBusy(chatId: string): boolean;
    bridge(): ChatBridgeLike | undefined;
    remove(): void;
}
export declare function loadOneBotBridge(): Promise<ChatBridgeConstructor | undefined>;
export declare function installInboundAdapter(options: {
    Bridge: ChatBridgeConstructor;
    gate: WhisperGate;
    config: GroupWhisperConfig;
    now?(): number;
    log?(message: string): void;
}): InboundAdapter;
export {};
//# sourceMappingURL=onebot.d.ts.map