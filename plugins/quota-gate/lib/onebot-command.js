import { scopeFromChatId } from './identity.js';
const patchKey = Symbol.for('quota-gate.onebot-bridge-patch');
function parseQuotaCommand(text) {
    const normalized = text.replace(/^@\d+\s*/, '').trim();
    if (/^\/quota$/i.test(normalized))
        return '';
    const match = /^\/quota\s+(top|reset)$/i.exec(normalized);
    return match?.[1]?.toLowerCase();
}
export function installOneBotCommandBridge(ChatBridge, quota) {
    const prototype = ChatBridge.prototype;
    prototype[patchKey]?.dispose();
    const original = prototype.tryHandleCommand;
    const replacement = async function (chatId, text, userId, nickname) {
        const input = parseQuotaCommand(String(text));
        if (input === undefined) {
            return original.call(this, chatId, text, userId, nickname);
        }
        const actor = scopeFromChatId(chatId, userId);
        const result = quota.executeCommand(actor, input);
        await this.sendToChat(chatId, result.text);
        return true;
    };
    prototype.tryHandleCommand = replacement;
    const patch = {
        dispose() {
            if (prototype.tryHandleCommand === replacement) {
                prototype.tryHandleCommand = original;
            }
            if (prototype[patchKey] === patch)
                delete prototype[patchKey];
        },
    };
    prototype[patchKey] = patch;
    return () => patch.dispose();
}
//# sourceMappingURL=onebot-command.js.map