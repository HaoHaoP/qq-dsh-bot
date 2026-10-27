import type { QuotaService } from './core.js';
interface OneBotBridge {
    sendToChat(chatId: string, text: string): Promise<unknown>;
}
interface OneBotBridgeClass {
    prototype: {
        tryHandleCommand: (this: OneBotBridge, chatId: string, text: string, userId: string, nickname?: string) => Promise<boolean>;
    };
}
export declare function installOneBotCommandBridge(ChatBridge: OneBotBridgeClass, quota: QuotaService): () => void;
export {};
//# sourceMappingURL=onebot-command.d.ts.map