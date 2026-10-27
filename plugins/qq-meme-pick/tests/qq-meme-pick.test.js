import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { MemePicker } from '../lib/index.js'

const SCHEMA = `
CREATE TABLE memes (
  path TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  caption TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  mtime REAL,
  captioned_at REAL
)
`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qq-meme-pick-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  function addPack(id, rows) {
    const pack = join(root, id)
    mkdirSync(pack, { recursive: true })
    const db = new DatabaseSync(join(pack, 'index.db'))
    db.exec(SCHEMA)
    const insert = db.prepare(`
      INSERT INTO memes
        (path, tag, file_name, file_hash, caption, keywords, mtime, captioned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of rows) {
      const file = join(pack, row.path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, row.bytes ?? `image:${row.hash}`)
      insert.run(
        row.path,
        row.tag,
        row.path.split('/').at(-1),
        row.hash,
        row.caption,
        row.keywords ?? '',
        Date.now(),
        Date.now(),
      )
    }
    db.close()
  }

  return { root, addPack }
}

function pickerFor(root, overrides = {}) {
  return new MemePicker({
    config: { packsDir: root, cooldownSeconds: 300 },
    random: () => 0,
    ...overrides,
  })
}

test('keyword match wins before mood match', (t) => {
  const f = fixture(t)
  f.addPack('pack-a', [
    {
      path: 'memes/angry/shengqi.jpg',
      tag: 'angry',
      hash: 'a1',
      caption: '气鼓鼓',
      keywords: '生气 愤怒',
    },
    {
      path: 'memes/daily/ganfan.jpg',
      tag: 'daily',
      hash: 'a2',
      caption: '捧着碗干饭',
      keywords: '干饭 吃饭',
    },
  ])

  const result = pickerFor(f.root).pick({ mood: 'angry', keyword: '干饭' })
  assert.equal(result.files.length, 1)
  assert.match(result.files[0], /ganfan\.jpg$/)
  assert.equal(result.caption, '捧着碗干饭')
})

test('mood match is used when keyword is absent', (t) => {
  const f = fixture(t)
  f.addPack('pack-a', [
    {
      path: 'memes/angry/shengqi.jpg',
      tag: 'angry',
      hash: 'b1',
      caption: '气鼓鼓',
      keywords: '生气',
    },
    {
      path: 'memes/happy/deyi.jpg',
      tag: 'happy',
      hash: 'b2',
      caption: '好耶',
      keywords: '开心',
    },
  ])

  const result = pickerFor(f.root).pick({ mood: '生气' })
  assert.match(result.files[0], /shengqi\.jpg$/)
})

test('random fallback returns an absolute path when keyword and mood miss', (t) => {
  const f = fixture(t)
  f.addPack('pack-a', [
    {
      path: 'memes/happy/ok.png',
      tag: 'happy',
      hash: 'c1',
      caption: 'OK',
    },
    {
      path: 'memes/sad/yun.gif',
      tag: 'sad',
      hash: 'c2',
      caption: '晕了',
    },
  ])

  const result = pickerFor(f.root).pick({
    mood: '不存在的情绪',
    keyword: '不存在的关键词',
  })
  assert.equal(result.files.length, 1)
  assert.equal(isAbsolute(result.files[0]), true)
})

test('cooldown prevents returning the same image again', (t) => {
  const f = fixture(t)
  f.addPack('pack-a', [
    {
      path: 'memes/happy/ok.jpg',
      tag: 'happy',
      hash: 'd1',
      caption: 'OK',
    },
    {
      path: 'memes/happy/deyi.jpg',
      tag: 'happy',
      hash: 'd2',
      caption: '好耶',
    },
  ])

  const picker = pickerFor(f.root)
  const first = picker.pick({ count: 1 })
  const second = picker.pick({ count: 1 })
  const third = picker.pick({ count: 1 })

  assert.equal(first.files.length, 1)
  assert.equal(second.files.length, 1)
  assert.notEqual(first.files[0], second.files[0])
  assert.deepEqual(third.files, [])
  assert.match(third.caption, /冷却期/)
})

test('empty library returns empty files and a caption without throwing', (t) => {
  const f = fixture(t)
  const result = pickerFor(f.root).pick({ keyword: '开心' })
  assert.deepEqual(result.files, [])
  assert.match(result.caption, /图库为空/)
})

test('count is capped at three and duplicate hashes across packs are deduplicated', (t) => {
  const f = fixture(t)
  f.addPack('pack-a', [
    {
      path: 'memes/daily/a.jpg',
      tag: 'daily',
      hash: 'same-hash',
      caption: '重复内容',
      bytes: 'same bytes',
    },
    {
      path: 'memes/daily/b.jpg',
      tag: 'daily',
      hash: 'e2',
      caption: 'B',
    },
    {
      path: 'memes/daily/c.jpg',
      tag: 'daily',
      hash: 'e3',
      caption: 'C',
    },
  ])
  f.addPack('pack-b', [
    {
      path: 'memes/daily/copy.jpg',
      tag: 'daily',
      hash: 'same-hash',
      caption: '重复内容副本',
      bytes: 'same bytes',
    },
    {
      path: 'memes/daily/d.jpg',
      tag: 'daily',
      hash: 'e4',
      caption: 'D',
    },
  ])

  const deduplicated = pickerFor(f.root).pick({ keyword: '重复内容', count: 1 })
  assert.equal(deduplicated.files.length, 1)
  assert.match(deduplicated.files[0], /a\.jpg|copy\.jpg$/)

  const capped = pickerFor(f.root).pick({ mood: 'daily', count: 99 })
  assert.equal(capped.files.length, 3)
  assert.equal(new Set(capped.files).size, 3)
})
