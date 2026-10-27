export function scopeFromChatId(chatId, userId) {
    if (chatId.startsWith('group:')) {
        return { groupId: chatId.slice('group:'.length), userId };
    }
    if (chatId.startsWith('private:')) {
        const id = chatId.slice('private:'.length);
        return { groupId: `private:${id}`, userId };
    }
    return { groupId: chatId, userId };
}
export function scopeFromSessionId(sessionId) {
    const group = /^onebot-group-(\d+)(?:-|$)/.exec(sessionId);
    if (group?.[1] !== undefined)
        return { groupId: group[1], userId: '' };
    const privateChat = /^onebot-private-(\d+)(?:-|$)/.exec(sessionId);
    if (privateChat?.[1] !== undefined) {
        return { groupId: `private:${privateChat[1]}`, userId: privateChat[1] };
    }
    return undefined;
}
export function textOf(message) {
    return (message.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('');
}
export function qqUserIdFromMessage(message) {
    if (message.role !== 'user')
        return undefined;
    if (message.source?.kind !== 'plugin:dsh-onebot')
        return undefined;
    return /<user_message\s+qq="(\d+)"/.exec(textOf(message))?.[1];
}
export function actorFromOptions(options) {
    if (options.purpose === 'compaction' || options.purpose === 'session-title') {
        return undefined;
    }
    if (options.sessionId === undefined)
        return undefined;
    const scope = scopeFromSessionId(options.sessionId);
    if (scope === undefined)
        return undefined;
    const messages = options.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const userId = qqUserIdFromMessage(messages[index]);
        if (userId !== undefined)
            return { groupId: scope.groupId, userId };
    }
    return scope.userId === '' ? undefined : scope;
}
export function userIdFromSessionMessages(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const value = messages[index];
        if (value === null || typeof value !== 'object')
            continue;
        const candidate = value;
        const userId = qqUserIdFromMessage(candidate);
        if (userId !== undefined)
            return userId;
    }
    return undefined;
}
export function withDay(scope, day) {
    return { day, groupId: scope.groupId, userId: scope.userId };
}
//# sourceMappingURL=identity.js.map