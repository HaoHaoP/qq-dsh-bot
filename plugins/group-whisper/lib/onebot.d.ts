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
interface NormalizedInboundLike {
    kind: 'private' | 'group';
    userId: string;
    groupId: string;
    chatId: string;
    segments?: RawSegment[];
    raw: string;
    text: string;
    messageId?: string;
    nickname: string;
}
interface InboundChatLike {
    sessionId?: string;
    agent?: {
        status?: string;
    };
}
interface InboundContextLike {
    policy?: {
        groupPolicy?: string;
        groupAllowFrom?: readonly string[];
    };
    config?: {
        botQQ?: string;
    };
    selfId?(): string;
    getChat?(chatId: string): InboundChatLike | undefined;
    dispatchFollowup?(chatId: string, text: string, role: 'admin' | 'member', nickname?: string): Promise<void>;
}
interface InboundPipelineLike {
    ctx: InboundContextLike;
    processInbound(inbound: NormalizedInboundLike): Promise<void>;
}
type ProcessInbound = (this: InboundPipelineLike, inbound: NormalizedInboundLike) => Promise<void>;
type InboundPipelineConstructor = {
    prototype: InboundPipelineLike & {
        processInbound: ProcessInbound;
    };
};
interface ChatBridgeLike {
    handleInbound(event: RawOneBotEvent, opts?: {
        injected?: boolean;
    }): Promise<void>;
}
type ChatBridgeConstructor = {
    prototype: ChatBridgeLike & {
        handleInbound(event: RawOneBotEvent, opts?: {
            injected?: boolean;
        }): Promise<void>;
    };
};
export interface LoadedOneBotInbound {
    Pipeline: InboundPipelineConstructor;
    isInjected(): boolean;
}
export interface InboundAdapter {
    chatForSession(sessionId: string): string | undefined;
    dispatch(input: DispatchInput): Promise<void>;
    isBusy(chatId: string): boolean;
    pipeline(): InboundPipelineLike | undefined;
    remove(): void;
}
export declare function loadOneBotBridge(): Promise<ChatBridgeConstructor | undefined>;
export declare function loadOneBotInbound(): Promise<LoadedOneBotInbound | undefined>;
export declare function installInboundAdapter(options: {
    Pipeline: InboundPipelineConstructor;
    gate: WhisperGate;
    config: GroupWhisperConfig;
    isInjected?(): boolean;
    now?(): number;
    log?(message: string): void;
}): InboundAdapter;
export {};
//# sourceMappingURL=onebot.d.ts.map