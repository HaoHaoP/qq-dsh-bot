import type { QuotaService } from './core.js'
import { scopeFromChatId } from './identity.js'

interface OneBotBridge {
  sendToChat(chatId: string, text: string): Promise<unknown>
}

interface OneBotBridgeClass {
  prototype: {
    tryHandleCommand: (
      this: OneBotBridge,
      chatId: string,
      text: string,
      userId: string,
      nickname?: string,
    ) => Promise<boolean>
  }
}

const patchKey = Symbol.for('quota-gate.onebot-bridge-patch')

function parseQuotaCommand(text: string): string | undefined {
  const normalized = text.replace(/^@\d+\s*/, '').trim()
  if (/^\/quota$/i.test(normalized)) return ''
  const match = /^\/quota\s+(top|reset)$/i.exec(normalized)
  return match?.[1]?.toLowerCase()
}

export function installOneBotCommandBridge(
  ChatBridge: OneBotBridgeClass,
  quota: QuotaService,
): () => void {
  const prototype = ChatBridge.prototype as OneBotBridgeClass['prototype'] & {
    [patchKey]?: { dispose(): void }
  }
  prototype[patchKey]?.dispose()
  const original = prototype.tryHandleCommand
  const replacement = async function (
    this: OneBotBridge,
    chatId: string,
    text: string,
    userId: string,
    nickname?: string,
  ): Promise<boolean> {
    const input = parseQuotaCommand(String(text))
    if (input === undefined) {
      return original.call(this, chatId, text, userId, nickname)
    }
    const actor = scopeFromChatId(chatId, userId)
    const result = quota.executeCommand(actor, input)
    await this.sendToChat(chatId, result.text)
    return true
  }
  prototype.tryHandleCommand = replacement
  const patch = {
    dispose() {
      if (prototype.tryHandleCommand === replacement) {
        prototype.tryHandleCommand = original
      }
      if (prototype[patchKey] === patch) delete prototype[patchKey]
    },
  }
  prototype[patchKey] = patch
  return () => patch.dispose()
}
