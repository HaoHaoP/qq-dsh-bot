import { homedir } from 'node:os';
import { join } from 'node:path';
import { createModelDecider } from './analyzer.js';
import { normalizeConfig } from './config.js';
import { WhisperGate } from './gate.js';
import { installInboundAdapter, loadOneBotInbound } from './onebot.js';
import { openStateStore } from './store.js';
export * from './analyzer.js';
export * from './config.js';
export * from './gate.js';
export * from './onebot.js';
export * from './store.js';
export const name = 'group-whisper';
export const inject = ['llm'];
function defaultDatabasePath() {
    const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
        ? process.env.DSH_HOME
        : join(homedir(), '.dsh');
    return join(home, 'group-whisper', 'state.db');
}
function assistantText(event) {
    return (event.data?.message?.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text ?? '')
        .join('')
        .trim();
}
export async function apply(ctx, input = {}, options = {}) {
    const config = normalizeConfig(input);
    if (!config.enabled)
        return;
    const logger = ctx.logger ?? console;
    const onebot = await loadOneBotInbound();
    if (onebot === undefined) {
        logger.warn?.('[group-whisper] dsh-onebot-qq/lib/inbound.js is unavailable; group gate is inactive');
        return;
    }
    const store = openStateStore(options.databasePath ?? defaultDatabasePath());
    const decider = createModelDecider({
        llm: ctx.llm,
        model: config.analyzerModel,
    });
    let adapter;
    const gate = new WhisperGate({
        config,
        store,
        decide: secretary => decider.decide(secretary),
        dispatch: dispatch => {
            if (adapter === undefined)
                throw new Error('onebot adapter is not installed');
            return adapter.dispatch(dispatch);
        },
        isBusy: chatId => adapter?.isBusy(chatId) === true,
        log: message => logger.info?.(message),
    });
    adapter = installInboundAdapter({
        Pipeline: onebot.Pipeline,
        gate,
        config,
        isInjected: onebot.isInjected,
        log: message => logger.info?.(message),
    });
    ctx.on('session/event', (session, event) => {
        const chatId = adapter?.chatForSession(session.id);
        if (chatId === undefined)
            return;
        if (event.type === 'assistant/message') {
            gate.onAssistantMessage(chatId, assistantText(event));
            return;
        }
        if (event.type === 'turn/end') {
            gate.onTurnEnd(chatId, event.data?.reason?.kind);
        }
    });
    const dispose = () => {
        adapter?.remove();
        gate.dispose();
        store.close();
    };
    if (ctx.effect !== undefined) {
        ctx.effect(() => dispose, 'group-whisper.lifecycle');
    }
}
//# sourceMappingURL=index.js.map