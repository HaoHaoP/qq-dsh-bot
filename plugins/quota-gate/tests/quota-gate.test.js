import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  QuotaService,
  dayKeyAt,
  installOneBotCommandBridge,
  normalizeConfig,
  openUsageStore,
  scopeFromSessionId,
  totalOf,
} from '../lib/index.js'

function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'quota-gate-'))
  const store = openUsageStore(join(dir, 'usage.db'), {
    forceBackend: options.backend ?? 'sqlite',
  })
  let current = new Date(options.now ?? '2026-10-27T10:00:00.000Z')
  const config = normalizeConfig({
    groupDaily: 1_000,
    userDaily: 100,
    groups: ['2002'],
    admins: ['9009'],
    ...options.config,
  })
  const service = new QuotaService({
    config,
    store,
    now: () => new Date(current),
  })
  return {
    dir,
    store,
    service,
    setNow(value) {
      current = new Date(value)
    },
    close() {
      service.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function options(userId = '1001') {
  return {
    sessionId: 'onebot-group-2002',
    messages: [
      {
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'text', text: 'old reply' }],
      },
      {
        role: 'user',
        source: { kind: 'plugin:dsh-onebot' },
        content: [
          {
            type: 'text',
            text: `<user_message qq="${userId}" nickname="tester">\nhello\n</user_message>`,
          },
        ],
      },
    ],
  }
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function textOf(chunks) {
  return chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.text)
    .join('')
}

test('records real prompt, completion and cached usage fields', async (t) => {
  const f = fixture()
  t.after(() => f.close())
  let upstreamCalls = 0

  const chunks = await collect(
    f.service.handleStream(options(), async function* () {
      upstreamCalls += 1
      yield {
        type: 'usage',
        usage: {
          inputTokens: 20,
          outputTokens: 5,
          cacheReadTokens: 10,
          cacheWriteTokens: 2,
        },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  assert.equal(upstreamCalls, 1)
  assert.equal(chunks.at(-1).type, 'finish')
  const day = dayKeyAt(
    new Date('2026-10-27T10:00:00.000Z').getTime(),
    'Asia/Shanghai',
    '00:00',
  )
  const row = f.store.get({
    day,
    groupId: '2002',
    userId: '1001',
  })
  assert.equal(row.prompt_tokens, 22)
  assert.equal(row.completion_tokens, 5)
  assert.equal(row.cached_tokens, 10)
  assert.equal(row.requests, 1)
  assert.equal(totalOf(row), 37)
})

test('blocks the next model call after the user budget is reached', async (t) => {
  const f = fixture({ config: { userDaily: 10 } })
  t.after(() => f.close())

  await collect(
    f.service.handleStream(options(), async function* () {
      yield {
        type: 'usage',
        usage: { inputTokens: 8, outputTokens: 2 },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  let upstreamCalls = 0
  const blocked = await collect(
    f.service.handleStream(options(), async function* () {
      upstreamCalls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  assert.equal(upstreamCalls, 0)
  assert.match(textOf(blocked), /今天不聊了/)
  assert.equal(blocked.at(-1).reason.kind, 'stop')
})

test('crosses the Asia/Shanghai midnight boundary without restarting', (t) => {
  const f = fixture({ now: '2026-10-27T15:59:59.000Z' })
  t.after(() => f.close())

  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 9, outputTokens: 1 },
  )
  assert.equal(
    dayKeyAt(
      new Date('2026-10-27T15:59:59.000Z').getTime(),
      'Asia/Shanghai',
      '00:00',
    ),
    '2026-10-27',
  )

  f.setNow('2026-10-28T00:00:00.000Z')
  const afterMidnight = f.service.evaluate(
    { groupId: '2002', userId: '1001' },
  )
  const beforeMidnight = f.store.groupTotal({
    day: '2026-10-27',
    groupId: '2002',
  })
  const afterMidnightTotal = f.store.groupTotal({
    day: '2026-10-28',
    groupId: '2002',
  })

  assert.equal(beforeMidnight, 10)
  assert.equal(afterMidnightTotal, 0)
  assert.equal(afterMidnight.allowed, true)
  assert.equal(afterMidnight.day, '2026-10-28')
})

test('recognizes rotated onebot session ids after /new', () => {
  assert.deepEqual(scopeFromSessionId('onebot-group-2002-mabc123'), {
    groupId: '2002',
    userId: '',
  })
  assert.deepEqual(scopeFromSessionId('onebot-private-1001-mabc123'), {
    groupId: 'private:1001',
    userId: '1001',
  })
})

test('notify-once emits one notice per user per day', async (t) => {
  const f = fixture({ config: { userDaily: 1 } })
  t.after(() => f.close())
  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 1, outputTokens: 0 },
  )

  const next = async function* () {
    throw new Error('upstream must not be called')
  }
  const first = await collect(f.service.handleStream(options(), next))
  const second = await collect(f.service.handleStream(options(), next))

  assert.match(textOf(first), /1\/1/)
  assert.equal(textOf(second), '')
  assert.equal(second.length, 1)
  assert.equal(second[0].type, 'finish')
})

test('group budget blocks after usage from multiple members reaches it', async (t) => {
  const f = fixture({
    config: { groupDaily: 15, userDaily: 1_000 },
  })
  t.after(() => f.close())

  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 10, outputTokens: 0 },
  )
  f.service.record(
    { groupId: '2002', userId: '1002' },
    { inputTokens: 5, outputTokens: 0 },
  )

  let upstreamCalls = 0
  const blocked = await collect(
    f.service.handleStream(options('1003'), async function* () {
      upstreamCalls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  assert.equal(upstreamCalls, 0)
  assert.match(textOf(blocked), /15\/15/)
})

test('admin is counted and blocked by the personal budget', async (t) => {
  const f = fixture({
    config: { groupDaily: 1_000, userDaily: 10, admins: ['9009'] },
  })
  t.after(() => f.close())
  const admin = { groupId: '2002', userId: '9009' }

  f.service.record(admin, { inputTokens: 9, outputTokens: 1 })
  const verdict = f.service.evaluate(admin)
  let upstreamCalls = 0
  const blocked = await collect(
    f.service.handleStream(options('9009'), async function* () {
      upstreamCalls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  assert.equal(verdict.allowed, false)
  assert.equal(verdict.hit, 'user')
  assert.equal(verdict.userUsed, 10)
  assert.equal(upstreamCalls, 0)
  assert.match(textOf(blocked), /10\/10/)
})

test('admin is counted and blocked by the group budget', async (t) => {
  const f = fixture({
    config: { groupDaily: 10, userDaily: 1_000, admins: ['9009'] },
  })
  t.after(() => f.close())
  const admin = { groupId: '2002', userId: '9009' }

  f.service.record(admin, { inputTokens: 10, outputTokens: 0 })
  const verdict = f.service.evaluate(admin)

  assert.equal(verdict.allowed, false)
  assert.equal(verdict.hit, 'group')
  assert.equal(verdict.groupUsed, 10)
})

test('admin can still reset the group budget after being blocked', (t) => {
  const f = fixture({
    config: { groupDaily: 10, userDaily: 10, admins: ['9009'] },
  })
  t.after(() => f.close())
  const admin = { groupId: '2002', userId: '9009' }

  f.service.record(admin, { inputTokens: 10, outputTokens: 0 })
  assert.equal(f.service.evaluate(admin).allowed, false)

  const result = f.service.executeCommand(admin, 'reset')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已重置本群今日额度/)
  assert.equal(f.service.evaluate(admin).allowed, true)
})

test('budgetExempt users bypass blocking and are not billed', async (t) => {
  const f = fixture({
    config: {
      groupDaily: 10,
      userDaily: 10,
      admins: [],
      budgetExempt: ['9008'],
    },
  })
  t.after(() => f.close())

  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 10, outputTokens: 0 },
  )
  let upstreamCalls = 0
  await collect(
    f.service.handleStream(options('9008'), async function* () {
      upstreamCalls += 1
      yield {
        type: 'usage',
        usage: { inputTokens: 500, outputTokens: 100 },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  )

  const exempt = { groupId: '2002', userId: '9008' }
  const verdict = f.service.evaluate(exempt)
  assert.equal(upstreamCalls, 1)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.userUsed, 0)
  assert.equal(verdict.groupUsed, 10)
})

test('empty permission lists keep normal budget behavior', (t) => {
  const config = normalizeConfig({
    groupDaily: 100,
    userDaily: 10,
    admins: [],
    budgetExempt: [],
  })
  assert.deepEqual(config.admins, [])
  assert.deepEqual(config.budgetExempt, [])
  assert.equal(config.onebotCommandBridge, false)

  const f = fixture({
    config: {
      groupDaily: config.groupDaily,
      userDaily: config.userDaily,
      admins: config.admins,
      budgetExempt: config.budgetExempt,
    },
  })
  t.after(() => f.close())
  const actor = { groupId: '2002', userId: '1001' }

  f.service.record(actor, { inputTokens: 10, outputTokens: 0 })
  assert.equal(f.service.evaluate(actor).allowed, false)
  assert.equal(f.service.evaluate(actor).hit, 'user')
})

test('OneBot compatibility routes /quota commands and restores the method on dispose', async (t) => {
  const f = fixture({ config: { admins: ['9009'] } })
  t.after(() => f.close())
  class FakeBridge {
    sent = []
    originals = []

    async sendToChat(chatId, text) {
      this.sent.push({ chatId, text })
      return ['message-id']
    }

    async tryHandleCommand(chatId, text, userId) {
      this.originals.push({ chatId, text, userId })
      return false
    }
  }

  const dispose = installOneBotCommandBridge(FakeBridge, f.service)
  const bridge = new FakeBridge()

  assert.equal(
    await bridge.tryHandleCommand('group:2002', '/quota', '1001'),
    true,
  )
  assert.match(bridge.sent.at(-1).text, /本群今日/)

  await bridge.tryHandleCommand('group:2002', '/quota top', '1001')
  assert.equal(bridge.sent.at(-1).text, '该命令仅管理员可用。')

  await bridge.tryHandleCommand('group:2002', '/quota reset', '9009')
  assert.match(bridge.sent.at(-1).text, /已重置本群今日额度/)

  dispose()
  await bridge.tryHandleCommand('group:2002', '/quota', '1001')
  assert.equal(bridge.originals.at(-1).text, '/quota')
})

test('/quota report reads the same numbers stored in the database', (t) => {
  const f = fixture({ config: { groupDaily: 500, userDaily: 100 } })
  t.after(() => f.close())

  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 40, outputTokens: 10, cacheReadTokens: 5 },
  )
  f.service.record(
    { groupId: '2002', userId: '1002' },
    { inputTokens: 20, outputTokens: 5 },
  )

  const day = dayKeyAt(
    new Date('2026-10-27T10:00:00.000Z').getTime(),
    'Asia/Shanghai',
    '00:00',
  )
  const own = f.store.get({ day, groupId: '2002', userId: '1001' })
  const group = f.store.groupTotal({ day, groupId: '2002' })
  const report = f.service.executeCommand(
    { groupId: '2002', userId: '1001' },
    '',
  )

  assert.equal(totalOf(own), 55)
  assert.equal(group, 80)
  assert.match(report.text, /本群今日：80 \/ 500，剩余 420/)
  assert.match(report.text, /本人今日：55 \/ 100，剩余 45/)
})

test('JSON fallback persists the same accounting fields', (t) => {
  const f = fixture({
    backend: 'json',
    config: { groupDaily: 500, userDaily: 100 },
  })
  t.after(() => f.close())

  f.service.record(
    { groupId: '2002', userId: '1001' },
    { inputTokens: 3, outputTokens: 4, cacheReadTokens: 5 },
  )
  const day = dayKeyAt(
    new Date('2026-10-27T10:00:00.000Z').getTime(),
    'Asia/Shanghai',
    '00:00',
  )
  const row = f.store.get({ day, groupId: '2002', userId: '1001' })

  assert.equal(f.store.backend, 'json')
  assert.equal(row.prompt_tokens, 3)
  assert.equal(row.completion_tokens, 4)
  assert.equal(row.cached_tokens, 5)
  assert.equal(row.requests, 1)
})
