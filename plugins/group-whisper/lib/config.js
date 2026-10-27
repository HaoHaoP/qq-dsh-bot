export const DEFAULT_CONFIG = {
    enabled: true,
    groups: [],
    waitingTime: 6,
    secretaryDebounceTime: 6,
    observationTimeout: 90,
    analyzerModel: 'deepseek-flash',
    energy: {
        initialEnergy: 100,
        maxEnergy: 100,
        minEnergy: -100,
        recoveryPerSecond: 0.8,
        baseReplyCost: 9,
        replyCostPerCharacter: 0.12,
    },
    leaveReply: {
        echoDetectionThreshold: 3,
        denseConversationThreshold: 1,
        familiarityCooldownDuration: 1800,
    },
};
function objectOf(value) {
    return typeof value === 'object' && value !== null
        ? value
        : {};
}
function finiteNumber(value, fallback, field, minimum = 0) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        throw new TypeError(`${field} must be a finite number >= ${minimum}`);
    }
    return value;
}
function positiveInteger(value, fallback, field) {
    const number = finiteNumber(value, fallback, field, 1);
    return Math.max(1, Math.floor(number));
}
function boolean(value, fallback, field) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'boolean')
        throw new TypeError(`${field} must be a boolean`);
    return value;
}
function strings(value, fallback, field) {
    if (value === undefined)
        return [...fallback];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new TypeError(`${field} must be an array of strings`);
    }
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}
function pick(object, camel, snake, fallback) {
    return object[camel] ?? object[snake] ?? fallback;
}
export function normalizeConfig(input = {}) {
    const rawEnergy = objectOf(input.energy);
    const rawLeave = objectOf(input.leaveReply ?? input.leave_reply);
    const energy = {
        initialEnergy: finiteNumber(pick(rawEnergy, 'initialEnergy', 'initial_energy', DEFAULT_CONFIG.energy.initialEnergy), DEFAULT_CONFIG.energy.initialEnergy, 'energy.initialEnergy', -Number.MAX_SAFE_INTEGER),
        maxEnergy: finiteNumber(pick(rawEnergy, 'maxEnergy', 'max_energy', DEFAULT_CONFIG.energy.maxEnergy), DEFAULT_CONFIG.energy.maxEnergy, 'energy.maxEnergy'),
        minEnergy: finiteNumber(pick(rawEnergy, 'minEnergy', 'min_energy', DEFAULT_CONFIG.energy.minEnergy), DEFAULT_CONFIG.energy.minEnergy, 'energy.minEnergy', -Number.MAX_SAFE_INTEGER),
        recoveryPerSecond: finiteNumber(pick(rawEnergy, 'recoveryPerSecond', 'recovery_per_second', DEFAULT_CONFIG.energy.recoveryPerSecond), DEFAULT_CONFIG.energy.recoveryPerSecond, 'energy.recoveryPerSecond'),
        baseReplyCost: finiteNumber(pick(rawEnergy, 'baseReplyCost', 'base_reply_cost', DEFAULT_CONFIG.energy.baseReplyCost), DEFAULT_CONFIG.energy.baseReplyCost, 'energy.baseReplyCost'),
        replyCostPerCharacter: finiteNumber(pick(rawEnergy, 'replyCostPerCharacter', 'reply_cost_per_character', DEFAULT_CONFIG.energy.replyCostPerCharacter), DEFAULT_CONFIG.energy.replyCostPerCharacter, 'energy.replyCostPerCharacter'),
    };
    if (energy.maxEnergy < energy.minEnergy) {
        throw new TypeError('energy.maxEnergy must be >= energy.minEnergy');
    }
    energy.initialEnergy = Math.min(energy.maxEnergy, Math.max(energy.minEnergy, energy.initialEnergy));
    const analyzerModelInput = pick(input, 'analyzerModel', 'analyzer_model', DEFAULT_CONFIG.analyzerModel);
    const analyzerModel = typeof analyzerModelInput === 'string'
        ? analyzerModelInput.trim()
        : DEFAULT_CONFIG.analyzerModel;
    if (analyzerModel === '')
        throw new TypeError('analyzerModel must not be empty');
    return {
        enabled: boolean(input.enabled, DEFAULT_CONFIG.enabled, 'enabled'),
        groups: strings(input.groups, DEFAULT_CONFIG.groups, 'groups'),
        waitingTime: finiteNumber(pick(input, 'waitingTime', 'waiting_time', DEFAULT_CONFIG.waitingTime), DEFAULT_CONFIG.waitingTime, 'waitingTime'),
        secretaryDebounceTime: finiteNumber(pick(input, 'secretaryDebounceTime', 'secretary_debounce_time', DEFAULT_CONFIG.secretaryDebounceTime), DEFAULT_CONFIG.secretaryDebounceTime, 'secretaryDebounceTime'),
        observationTimeout: finiteNumber(pick(input, 'observationTimeout', 'observation_timeout', DEFAULT_CONFIG.observationTimeout), DEFAULT_CONFIG.observationTimeout, 'observationTimeout', 0.001),
        analyzerModel,
        energy,
        leaveReply: {
            echoDetectionThreshold: positiveInteger(pick(rawLeave, 'echoDetectionThreshold', 'echo_detection_threshold', DEFAULT_CONFIG.leaveReply.echoDetectionThreshold), DEFAULT_CONFIG.leaveReply.echoDetectionThreshold, 'leaveReply.echoDetectionThreshold'),
            denseConversationThreshold: positiveInteger(pick(rawLeave, 'denseConversationThreshold', 'dense_conversation_threshold', DEFAULT_CONFIG.leaveReply.denseConversationThreshold), DEFAULT_CONFIG.leaveReply.denseConversationThreshold, 'leaveReply.denseConversationThreshold'),
            familiarityCooldownDuration: finiteNumber(pick(rawLeave, 'familiarityCooldownDuration', 'familiarity_cooldown_duration', DEFAULT_CONFIG.leaveReply.familiarityCooldownDuration), DEFAULT_CONFIG.leaveReply.familiarityCooldownDuration, 'leaveReply.familiarityCooldownDuration'),
        },
    };
}
//# sourceMappingURL=config.js.map