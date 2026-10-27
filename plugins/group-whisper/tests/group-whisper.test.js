import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  DEFAULT_CONFIG,
  WhisperGate,
  apply,
  createModelDecider,
  installInboundAdapter,
  normalizeConfig,
  openStateStore,
  replyCost,
} from '../lib/index.js'

function message(overrides = {}) {
  return {
    chatId: 'group:2002',
    groupId: '2002',
    userId: '1001',
    nickname: 'tester',
    text: 'hello',
    messageId: String(Math.random()),
    mentioned: false,
    at: 1_000,
    ...overrides,
  }
}

function fixture(options = {}) {
  const store = openStateStore(':memory:')
  let now = options.now ?? 1_000
  const dispatches = []
  const decisions = []
  const logs = []
  const config = normalizeConfig({
    waitingTime: 0,
    secretaryDebounceTime: 0,
    observationTimeout: 90,
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
    ...options.config,
  })
  const gate = new WhisperGate({
    config,
    store,
    decide: async input => {
      decisions.push(input)
      return options.decide?.(input) ?? { action: 'reply', reason: 'test_reply' }
    },
    dispatch: async input => {
      dispatches.push(input)
    },
    isBusy: () => false,
    log: line => logs.push(JSON.parse(line)),
    now: () => now,
    schedule: () => 0,
    cancel: () => undefined,
  })
  return {
    gate,
    store,
    config,
    dispatches,
    decisions,
    logs,
    setNow(value) {
      now = value
    },
    now() {
      return now
    },
    close() {
      gate.dispose()
      store.close()
    },
  }
}

test('copies every reference threshold as the default', () => {
  const config = normalizeConfig()
  assert.equal(config.waitingTime, 6)
  assert.equal(config.secretaryDebounceTime, 6)
  assert.equal(config.observationTimeout, 90)
  assert.equal(config.analyzerModel, 'deepseek-flash')
  assert.deepEqual(config.energy, DEFAULT_CONFIG.energy)
  assert.deepEqual(config.leaveReply, DEFAULT_CONFIG.leaveReply)
})

test('recovers by elapsed seconds and clamps energy at both configured bounds', (t) => {
  const f = fixture({
    now: 0,
    config: {
      energy: {
        initialEnergy: 0,
        maxEnergy: 10,
        minEnergy: -5,
        recoveryPerSecond: 1,
        baseReplyCost: 2,
        replyCostPerCharacter: 0.5,
      },
    },
  })
  t.after(() => f.close())

  const minimum = f.store.charge('group:2002', 100, f.config.energy, 0)
  assert.equal(minimum.cost, replyCost(100, f.config.energy))
  assert.equal(minimum.after, -5)

  const maximum = f.store.recover('group:2002', f.config.energy, 120_000)
  assert.equal(maximum.after, 10)
  assert.equal(
    f.store.recover('group:2002', f.config.energy, 240_000).after,
    10,
  )
})

test('energy recovery occurs before a reply charge', (t) => {
  const f = fixture({
    now: 0,
    config: {
      energy: {
        initialEnergy: 5,
        maxEnergy: 100,
        minEnergy: -100,
        recoveryPerSecond: 1,
        baseReplyCost: 2,
        replyCostPerCharacter: 0.5,
      },
    },
  })
  t.after(() => f.close())
  f.store.ensureEnergy('group:2002', 5, 0)

  const change = f.store.charge('group:2002', 2, f.config.energy, 3_000)
  assert.equal(change.before, 8)
  assert.equal(change.recovered, 3)
  assert.equal(change.cost, 3)
  assert.equal(change.after, 5)
})

test('persists only the specified energy and turn columns in SQLite', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'group-whisper-'))
  const path = join(dir, 'state.db')
  const store = openStateStore(path)
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const db = new DatabaseSync(path)
  try {
    const energyColumns = db.prepare('PRAGMA table_info(energy)').all()
      .map(row => row.name)
    const turnColumns = db.prepare('PRAGMA table_info(turn)').all()
      .map(row => row.name)
    assert.deepEqual(energyColumns, ['chat_id', 'value', 'updated_at'])
    assert.deepEqual(turnColumns, ['chat_id', 'at', 'mode', 'action', 'reason', 'chars', 'cost'])
  } finally {
    db.close()
  }
})

test('leave state ignores ordinary chatter and enters on a mention', async (t) => {
  const f = fixture()
  t.after(() => f.close())

  assert.equal(f.gate.observe(message({ text: 'ordinary' })), true)
  const ignored = await f.gate.patrol('group:2002')
  assert.equal(ignored.action, 'skip')
  assert.equal(ignored.reason, 'leave_state')
  assert.equal(f.decisions.length, 0)
  assert.equal(f.dispatches.length, 0)

  f.gate.observe(message({
    text: '@bot ping',
    mentioned: true,
    messageId: 'mention-1',
  }))
  const mentioned = await f.gate.patrol('group:2002')
  assert.equal(mentioned.mode, 'mention')
  assert.equal(mentioned.action, 'reply')
  assert.equal(f.decisions.length, 1)
  assert.equal(f.dispatches.length, 1)
})

test('familiarity cooldown blocks a repeated ordinary topic', async (t) => {
  const f = fixture()
  t.after(() => f.close())

  f.gate.observe(message({
    text: '@bot enter',
    mentioned: true,
    messageId: 'm1',
  }))
  await f.gate.patrol('group:2002')
  f.gate.onAssistantMessage('group:2002', 'mention reply')
  f.gate.onTurnEnd('group:2002')
  assert.equal(f.dispatches.length, 1)

  f.setNow(f.now() + 1_000)
  f.gate.observe(message({
    text: 'same topic please',
    messageId: 'm2',
  }))
  await f.gate.patrol('group:2002')
  f.gate.onAssistantMessage('group:2002', 'ordinary reply')
  f.gate.onTurnEnd('group:2002')
  assert.equal(f.dispatches.length, 2)

  f.setNow(f.now() + 10_000)
  f.gate.observe(message({
    text: 'same topic please',
    messageId: 'm3',
  }))
  const blocked = await f.gate.patrol('group:2002')
  assert.equal(blocked.action, 'skip')
  assert.equal(blocked.reason, 'familiarity_cooldown')
  assert.equal(blocked.cooldown, 'active')
  assert.equal(f.dispatches.length, 2)
})

test('no_reply records a decision but never dispatches a turn', async (t) => {
  const f = fixture({
    decide: async () => ({ action: 'no_reply', reason: 'already_answered' }),
  })
  t.after(() => f.close())

  f.gate.observe(message({
    text: '@bot maybe answer',
    mentioned: true,
    messageId: 'm1',
  }))
  const outcome = await f.gate.patrol('group:2002')
  assert.equal(outcome.action, 'no_reply')
  assert.equal(outcome.dispatched, false)
  assert.equal(f.dispatches.length, 0)
  const row = f.store.turns('group:2002').at(-1)
  assert.equal(row.action, 'no_reply')
  assert.equal(row.chars, 0)
  assert.equal(row.cost, 0)
})

test('settles an assistant reply with base plus per-character energy cost', async (t) => {
  const f = fixture()
  t.after(() => f.close())

  f.gate.observe(message({
    text: '@bot hello',
    mentioned: true,
    messageId: 'm1',
  }))
  await f.gate.patrol('group:2002')
  f.gate.onAssistantMessage('group:2002', '你好呀')
  f.gate.onTurnEnd('group:2002')

  const row = f.store.turns('group:2002').at(-1)
  assert.equal(row.mode, 'mention')
  assert.equal(row.action, 'reply')
  assert.equal(row.chars, 3)
  assert.equal(row.cost, 9 + 3 * 0.12)
  const settlement = f.logs.find(line => line.stage === 'settlement')
  assert.equal(settlement.characters, 3)
  assert.equal(settlement.cost, 9 + 3 * 0.12)
  assert.equal(settlement.energy, '100.00->90.64')
  assert.equal(settlement.energy_before, 100)
  assert.equal(settlement.energy_after, 100 - (9 + 3 * 0.12))
})

test('inspection logs carry mode, action, energy, recovered and cooldown', async (t) => {
  const f = fixture()
  t.after(() => f.close())
  f.gate.observe(message({ mentioned: true, text: '@bot', messageId: 'm1' }))
  await f.gate.patrol('group:2002')

  const patrol = f.logs.find(line => line.stage === 'patrol')
  assert.equal(patrol.mode, 'mention')
  assert.equal(patrol.action, 'process')
  assert.equal(typeof patrol.energy, 'number')
  assert.equal(typeof patrol.recovered, 'number')
  assert.equal(patrol.cooldown, 'pass')
})

test('analyzer uses analyzerModel and parses its structured action', async () => {
  const calls = []
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => [{ id: 'deepseek-flash' }],
    async *stream(options) {
      calls.push(options)
      yield { type: 'text-delta', text: '{"action":"reply","reason":"有人提问"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const decider = createModelDecider({
    llm,
    model: 'deepseek-flash',
  })
  const decision = await decider.decide({
    chatId: 'group:2002',
    mode: 'ordinary',
    energy: 50,
    echoDetected: false,
    messages: [message({ text: '这是怎么回事？' })],
  })

  assert.deepEqual(decision, { action: 'reply', reason: '有人提问' })
  assert.equal(calls[0].provider, 'deepseek')
  assert.equal(calls[0].model, 'deepseek-flash')
})

test('enabled false returns without touching the context or opening a database', async () => {
  let onCalls = 0
  let effectCalls = 0
  const ctx = {
    on() {
      onCalls += 1
      return () => undefined
    },
    effect() {
      effectCalls += 1
      return () => undefined
    },
  }

  await apply(ctx, { enabled: false }, {
    databasePath: '/definitely/not/writable/group-whisper.db',
  })
  assert.equal(onCalls, 0)
  assert.equal(effectCalls, 0)
})

test('constructor-captured tryHandleCommand arrow still sees a later prototype patch', async () => {
  class CapturingInboundPipeline {
    constructor(ctx) {
      this.ctx = ctx
    }

    async processInbound(inbound) {
      await this.ctx.tryHandleCommand(inbound.chatId, inbound.text)
    }
  }

  class FakeChatBridge {
    constructor() {
      this.inbound = new CapturingInboundPipeline({
        tryHandleCommand: (...args) => this.tryHandleCommand(...args),
      })
    }

    async handleInbound(event) {
      await this.inbound.processInbound({
        kind: 'group',
        chatId: 'group:2002',
        text: String(event.raw_message ?? ''),
      })
    }

    async tryHandleCommand() {
      return false
    }
  }

  const bridge = new FakeChatBridge()
  const original = FakeChatBridge.prototype.tryHandleCommand
  let patchedCalls = 0
  FakeChatBridge.prototype.tryHandleCommand = async () => {
    patchedCalls += 1
    return false
  }
  try {
    await bridge.handleInbound({ raw_message: 'hello' })
  } finally {
    FakeChatBridge.prototype.tryHandleCommand = original
  }

  assert.equal(
    patchedCalls,
    1,
    'the arrow captures the receiver, while the method is resolved when it is called',
  )
})

test('wraps an already-constructed inbound pipeline and observes group messages', async () => {
  function normalized(event) {
    return {
      kind: event.message_type ?? 'group',
      userId: String(event.user_id ?? ''),
      groupId: String(event.group_id ?? ''),
      chatId: event.message_type === 'private'
        ? `private:${String(event.user_id ?? '')}`
        : `group:${String(event.group_id ?? '')}`,
      segments: Array.isArray(event.message) ? event.message : undefined,
      raw: String(event.raw_message ?? ''),
      text: String(event.raw_message ?? ''),
      messageId: event.message_id === undefined ? undefined : String(event.message_id),
      nickname: event.sender?.nickname ?? String(event.user_id ?? ''),
    }
  }

  class FakeInboundPipeline {
    constructor(ctx) {
      this.ctx = ctx
      this.calls = []
    }

    async processInbound(inbound) {
      this.calls.push(inbound)
    }
  }

  class FakeChatBridge {
    constructor(ctx) {
      this.inbound = new FakeInboundPipeline(ctx)
    }

    async handleInbound(event) {
      await this.inbound.processInbound(normalized(event))
    }
  }

  const observed = []
  const dispatches = []
  const chats = new Map([
    ['group:2002', {
      sessionId: 'session-2002',
      agent: { status: 'idle' },
    }],
  ])
  const bridge = new FakeChatBridge({
    selfId: () => '9999',
    getChat: chatId => chats.get(chatId),
    async dispatchFollowup(chatId, text, role, nickname) {
      dispatches.push({ chatId, text, role, nickname })
    },
  })
  const gate = { observe: value => observed.push(value) }
  const adapter = installInboundAdapter({
    Pipeline: FakeInboundPipeline,
    gate,
    config: normalizeConfig(),
    now: () => 1_000,
  })

  assert.equal(Object.hasOwn(bridge.inbound, 'processInbound'), false)

  await bridge.handleInbound({
    message_type: 'group',
    group_id: 2002,
    user_id: 1001,
    message_id: 9,
    raw_message: 'not mentioned',
    sender: { nickname: 'tester' },
  })
  assert.equal(Object.hasOwn(bridge.inbound, 'processInbound'), true)
  assert.equal(bridge.inbound.calls.length, 0)
  assert.equal(observed.length, 1)
  assert.equal(observed[0].mentioned, false)

  await adapter.dispatch({
    chatId: 'group:2002',
    mode: 'ordinary',
    nickname: 'tester',
    prompt: 'proactive prompt',
    messages: [],
  })
  assert.deepEqual(dispatches, [{
    chatId: 'group:2002',
    text: 'proactive prompt',
    role: 'member',
    nickname: 'tester',
  }])
  assert.equal(adapter.chatForSession('session-2002'), 'group:2002')
  assert.equal(adapter.isBusy('group:2002'), false)

  await bridge.handleInbound({
    message_type: 'group',
    group_id: 2002,
    user_id: 1001,
    raw_message: '/help',
    sender: { nickname: 'tester' },
  })
  assert.equal(bridge.inbound.calls.length, 1)
  assert.equal(observed.length, 1)

  await bridge.handleInbound({
    message_type: 'private',
    user_id: 1001,
    raw_message: 'private',
  })
  assert.equal(bridge.inbound.calls.length, 2)
  adapter.remove()
  assert.equal(Object.hasOwn(bridge.inbound, 'processInbound'), false)
})

test('ordinary chatter after the observation window leaves presence', async (t) => {
  const f = fixture()
  t.after(() => f.close())

  f.gate.observe(message({ mentioned: true, text: '@bot', messageId: 'm1' }))
  await f.gate.patrol('group:2002')
  f.gate.onAssistantMessage('group:2002', 'reply')
  f.gate.onTurnEnd('group:2002')

  f.setNow(f.now() + 91_000)
  f.gate.observe(message({
    text: 'ordinary after timeout',
    messageId: 'm2',
    at: f.now(),
  }))
  const left = await f.gate.patrol('group:2002')
  assert.equal(left.action, 'skip')
  assert.equal(left.reason, 'leave_state')
  assert.equal(f.dispatches.length, 1)
})
