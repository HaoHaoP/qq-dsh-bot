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
function groupAllowed(ctx, groupId) {
    const policy = ctx.policy;
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
function normalize(pipeline, inbound, now) {
    if (inbound.kind !== 'group')
        return undefined;
    const groupId = inbound.groupId;
    const userId = inbound.userId;
    if (groupId === '' || userId === '')
        return undefined;
    const selfId = pipeline.ctx.selfId?.() ?? pipeline.ctx.config?.botQQ ?? '';
    if (userId === selfId)
        return undefined;
    const parsed = parseText({
        message: inbound.segments,
        raw_message: inbound.raw,
    }, selfId);
    const nickname = sanitizeNickname(inbound.nickname);
    return {
        chatId: `group:${groupId}`,
        groupId,
        userId,
        nickname: nickname === '' ? userId : nickname,
        text: parsed.text,
        messageId: inbound.messageId,
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
export async function loadOneBotInbound() {
    try {
        const packageUrl = import.meta.resolve('dsh-onebot-qq/package.json');
        const inboundUrl = new URL('lib/inbound.js', packageUrl).href;
        const injectUrl = new URL('lib/inject.js', packageUrl).href;
        const inboundModule = await import(inboundUrl);
        if (inboundModule.InboundPipeline === undefined)
            return undefined;
        let currentInjectRound;
        try {
            const injectModule = await import(injectUrl);
            currentInjectRound = injectModule.currentInjectRound;
        }
        catch {
            // Injection is a debug-only channel. Losing that marker must not disable
            // the ordinary inbound hook.
        }
        return {
            Pipeline: inboundModule.InboundPipeline,
            isInjected: () => currentInjectRound?.() !== undefined,
        };
    }
    catch {
        return undefined;
    }
}
export function installInboundAdapter(options) {
    const { Pipeline, gate, config } = options;
    const now = options.now ?? Date.now;
    const prototype = Pipeline.prototype;
    const original = prototype.processInbound;
    const instanceWrappers = new Map();
    const knownChats = new Set();
    const pipelineByChat = new Map();
    const sessionToChat = new Map();
    let activePipeline;
    const intercept = async function processInbound(inbound) {
        activePipeline = this;
        if (options.isInjected?.() === true) {
            return original.call(this, inbound);
        }
        if (inbound.kind !== 'group') {
            return original.call(this, inbound);
        }
        const groupId = inbound.groupId;
        if (groupId === '' ||
            !groupAllowed(this.ctx, groupId) ||
            (config.groups.length > 0 && !config.groups.includes(groupId))) {
            return original.call(this, inbound);
        }
        const message = normalize(this, inbound, now());
        if (message === undefined)
            return original.call(this, inbound);
        if (isCommand(message.text)) {
            return original.call(this, inbound);
        }
        knownChats.add(message.chatId);
        pipelineByChat.set(message.chatId, this);
        gate.observe(message);
    };
    // The bridge looks up processInbound on its live InboundPipeline instance for
    // every event. This prototype function is only a discovery trampoline: on the
    // first event it installs an own property on that already-constructed
    // instance, so routing does not depend on constructor-time callback snapshots.
    const discoverAndWrap = async function processInbound(inbound) {
        const pipeline = this;
        let wrapped = instanceWrappers.get(pipeline);
        if (wrapped === undefined) {
            wrapped = async function installedProcessInbound(value) {
                return intercept.call(this, value);
            };
            instanceWrappers.set(pipeline, wrapped);
            Object.defineProperty(pipeline, 'processInbound', {
                configurable: true,
                enumerable: false,
                value: wrapped,
                writable: true,
            });
        }
        return wrapped.call(pipeline, inbound);
    };
    prototype.processInbound = discoverAndWrap;
    options.log?.('[group-whisper] inbound hook mounted on InboundPipeline.processInbound');
    const pipelineForChat = (chatId) => pipelineByChat.get(chatId) ?? activePipeline;
    return {
        chatForSession(sessionId) {
            const mapped = sessionToChat.get(sessionId);
            if (mapped !== undefined)
                return mapped;
            for (const chatId of knownChats) {
                const pipeline = pipelineByChat.get(chatId);
                if (pipeline?.ctx.getChat?.(chatId)?.sessionId === sessionId) {
                    sessionToChat.set(sessionId, chatId);
                    return chatId;
                }
            }
            return undefined;
        },
        isBusy(chatId) {
            return pipelineForChat(chatId)?.ctx.getChat?.(chatId)?.agent?.status === 'running';
        },
        pipeline() {
            return activePipeline;
        },
        async dispatch(input) {
            const pipeline = pipelineForChat(input.chatId);
            if (pipeline?.ctx.dispatchFollowup === undefined) {
                throw new Error('dsh-onebot InboundPipeline is unavailable');
            }
            await pipeline.ctx.dispatchFollowup(input.chatId, input.prompt, 'member', input.nickname);
            const sessionId = pipeline.ctx.getChat?.(input.chatId)?.sessionId;
            if (sessionId !== undefined)
                sessionToChat.set(sessionId, input.chatId);
        },
        remove() {
            for (const [pipeline, wrapped] of instanceWrappers) {
                if (pipeline.processInbound === wrapped) {
                    delete pipeline.processInbound;
                }
            }
            instanceWrappers.clear();
            knownChats.clear();
            pipelineByChat.clear();
            sessionToChat.clear();
            activePipeline = undefined;
            if (prototype.processInbound === discoverAndWrap) {
                prototype.processInbound = original;
            }
        },
    };
}
//# sourceMappingURL=onebot.js.map