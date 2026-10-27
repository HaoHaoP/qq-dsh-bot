import assert from 'node:assert/strict'

import {
  WhisperGate,
  installInboundAdapter,
  normalizeConfig,
  openStateStore,
} from '../lib/index.js'

function normalize(event) {
  return {
    kind: event.message_type,
    userId: String(event.user_id ?? ''),
    groupId: String(event.group_id ?? ''),
    chatId: `group:${String(event.group_id ?? '')}`,
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
    this.originalCalls = 0
  }

  async processInbound() {
    this.originalCalls += 1
  }
}

class FakeChatBridge {
  constructor(ctx) {
    this.inbound = new FakeInboundPipeline(ctx)
  }

  async handleInbound(event) {
    await this.inbound.processInbound(normalize(event))
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for group-whisper decision')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const store = openStateStore(':memory:')
const logs = []
const config = normalizeConfig({
  waitingTime: 0,
  secretaryDebounceTime: 0,
  observationTimeout: 90,
})
const gate = new WhisperGate({
  config,
  store,
  decide: async () => ({ action: 'no_reply', reason: 'self_check' }),
  dispatch: async () => {
    throw new Error('self-check must not dispatch')
  },
  isBusy: () => false,
  log: line => logs.push(JSON.parse(line)),
  now: () => 1_000,
})
const bridge = new FakeChatBridge({
  selfId: () => '10000',
  getChat: () => undefined,
  dispatchFollowup: async () => undefined,
})
const adapter = installInboundAdapter({
  Pipeline: FakeInboundPipeline,
  gate,
  config,
  now: () => 1_000,
})

try {
  await bridge.handleInbound({
    message_type: 'group',
    group_id: 2002,
    user_id: 1001,
    message_id: 1,
    raw_message: '[CQ:at,qq=10000] ping',
    sender: { nickname: 'tester' },
  })
  await waitFor(() => store.turns('group:2002').length === 1)

  const patrol = logs.find(line => line.stage === 'patrol')
  assert.equal(patrol.chat_id, 'group:2002')
  assert.equal(patrol.mode, 'mention')
  assert.equal(patrol.action, 'process', JSON.stringify(logs))
  assert.equal(bridge.inbound.originalCalls, 0)
  assert.equal(store.turns('group:2002')[0].reason, 'self_check')

  console.log(JSON.stringify({
    ok: true,
    hook: 'InboundPipeline.processInbound',
    instance_wrapped: Object.hasOwn(bridge.inbound, 'processInbound'),
    stage: patrol.stage,
    chat_id: patrol.chat_id,
    mode: patrol.mode,
    action: patrol.action,
    turn_reason: store.turns('group:2002')[0].reason,
  }))
} finally {
  adapter.remove()
  gate.dispose()
  store.close()
}
