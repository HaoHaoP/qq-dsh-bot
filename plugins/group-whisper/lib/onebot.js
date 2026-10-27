function sanitizeNickname(value) {
    return value
        .replace(/[\u0000-\u001f\u007f-\u009f<>&"']/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 32);
}
function stripCq(raw) {
    return raw
        .replace(/\[CQ:at,[^\]]+\]/gu, ' ')
        .replace(/\[CQ:image,[^\]]+\]/gu, '[图片]')
        .replace(/\[CQ:face,[^\]]+\]/gu, '[表情]')
        .replace(/\[CQ:record,[^\]]+\]/gu, '[语音]')
        .replace(/\[CQ:[^\]]+\]/gu, '')
        .replace(/&amp;/gu, '&')
        .replace(/&#91;/gu, '[')
        .replace(/&#93;/gu, ']')
        .replace(/&#44;/gu, ',')
        .replace(/\s+/gu, ' ')
        .trim();
}
function parseText(event, selfId) {
    let mentioned = false;
    const parts = [];
    if (Array.isArray(event.message)) {
        for (const segment of event.message) {
            if (segment.type === 'text') {
                parts.push(segment.data?.text ?? '');
            }
            else if (segment.type === 'at') {
                const target = String(segment.data?.qq ?? '');
                if (selfId !== '' && target === selfId) {
                    mentioned = true;
                    parts.push('[@我] ');
                }
                else if (target !== '') {
                    parts.push(`@${target} `);
                }
            }
            else if (segment.type === 'image') {
                parts.push('[图片]');
            }
            else if (segment.type === 'face') {
                parts.push('[表情]');
            }
            else if (segment.type === 'record') {
                parts.push('[语音]');
            }
            else if (segment.type === 'file') {
                parts.push('[文件]');
            }
            else if (segment.type === 'reply') {
                parts.push('[引用]');
            }
        }
    }
    const raw = typeof event.raw_message === 'string'
        ? event.raw_message
        : typeof event.message === 'string'
            ? event.message
            : '';
    if (selfId !== '') {
        const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        if (new RegExp(`\\[CQ:at,qq=${escaped}(?:,[^\\]]*)?\\]`, 'u').test(raw)) {
            mentioned = true;
        }
    }
    const text = parts.join('').trim() || stripCq(raw);
    return { text, mentioned };
}
function groupAllowed(bridge, groupId) {
    const policy = bridge.deps?.policy;
    if (policy === undefined)
        return true;
    if (policy.groupPolicy === 'disabled')
        return false;
    if (policy.groupPolicy === 'allowlist' &&
        !(policy.groupAllowFrom ?? []).includes(groupId))
        return false;
    return true;
}
function isCommand(text) {
    return text
        .replace(/^(?:\[@我\]|@\d+)\s*/u, '')
        .trim()
        .startsWith('/');
}
function normalize(bridge, event, now) {
    if (event.message_type !== 'group')
        return undefined;
    const groupId = String(event.group_id ?? '');
    const userId = String(event.user_id ?? '');
    if (groupId === '' || userId === '')
        return undefined;
    const selfId = String(event.self_id ?? bridge.deps?.connection?.selfId ?? '');
    if (userId === selfId)
        return undefined;
    const parsed = parseText(event, selfId);
    const nickname = sanitizeNickname(event.sender?.card !== undefined && event.sender.card !== ''
        ? event.sender.card
        : event.sender?.nickname !== undefined && event.sender.nickname !== ''
            ? event.sender.nickname
            : userId);
    return {
        chatId: `group:${groupId}`,
        groupId,
        userId,
        nickname: nickname === '' ? userId : nickname,
        text: parsed.text,
        messageId: event.message_id === undefined ? undefined : String(event.message_id),
        mentioned: parsed.mentioned,
        at: now,
    };
}
export async function loadOneBotBridge() {
    try {
        const packageUrl = import.meta.resolve('dsh-onebot-qq/package.json');
        const bridgeUrl = new URL('lib/bridge.js', packageUrl).href;
        const module = await import(bridgeUrl);
        return module.ChatBridge;
    }
    catch {
        return undefined;
    }
}
export function installInboundAdapter(options) {
    const { Bridge, gate, config } = options;
    const now = options.now ?? Date.now;
    const prototype = Bridge.prototype;
    const original = prototype.handleInbound;
    let activeBridge;
    const wrappedHandleInbound = async function handleInbound(event, opts) {
        activeBridge = this;
        if (opts?.injected === true) {
            return original.call(this, event, opts);
        }
        if (event.message_type !== 'group') {
            return original.call(this, event, opts);
        }
        const groupId = String(event.group_id ?? '');
        if (groupId === '' ||
            !groupAllowed(this, groupId) ||
            (config.groups.length > 0 && !config.groups.includes(groupId))) {
            return original.call(this, event, opts);
        }
        const message = normalize(this, event, now());
        if (message === undefined)
            return original.call(this, event, opts);
        if (isCommand(message.text)) {
            return original.call(this, event, opts);
        }
        gate.observe(message);
    };
    prototype.handleInbound = wrappedHandleInbound;
    return {
        chatForSession(sessionId) {
            return activeBridge?.bySession?.get(sessionId);
        },
        isBusy(chatId) {
            return activeBridge?.chats?.get(chatId)?.agent?.status === 'running';
        },
        bridge() {
            return activeBridge;
        },
        async dispatch(input) {
            const bridge = activeBridge;
            if (bridge === undefined || bridge.dispatchFollowup === undefined) {
                throw new Error('dsh-onebot bridge is unavailable');
            }
            await bridge.dispatchFollowup(input.chatId, input.prompt, 'member', input.nickname);
        },
        remove() {
            if (prototype.handleInbound === wrappedHandleInbound) {
                prototype.handleInbound = original;
            }
        },
    };
}
//# sourceMappingURL=onebot.js.map