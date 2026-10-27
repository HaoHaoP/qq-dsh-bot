import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  createQqMemeTool,
  loadMemeLibrary,
  MemePicker,
  normalizeConfig,
} from '../lib/index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qq-meme-pick-'))
  const userDir = join(root, 'meme-packs')
  const builtinDir = join(root, 'builtin', 'memes')
  const dshHome = join(root, '.dsh')
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome

  t.after(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    rmSync(root, { recursive: true, force: true })
  })

  function addFiles(rootDir, files) {
    for (const [relativePath, bytes] of Object.entries(files)) {
      const file = join(rootDir, relativePath)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
  }

  return {
    root,
    userDir,
    builtinDir,
    dshHome,
    addFiles,
    config(overrides = {}) {
      return normalizeConfig({
        packsDir: userDir,
        builtinDir,
        cooldownSeconds: 300,
        ...overrides,
      })
    },
  }
}

function pickerFor(f, overrides = {}) {
  return new MemePicker({
    config: f.config(overrides.config),
    random: () => 0,
    ...overrides,
  })
}

function indexRows(f) {
  const db = new DatabaseSync(join(f.dshHome, 'qq-meme-pick', 'index.db'), {
    readOnly: true,
  })
  try {
    return db.prepare(
      'SELECT path, pack, source, emotion, name, keywords, indexed_at, mtime FROM memes ORDER BY path',
    ).all()
  } finally {
    db.close()
  }
}

test('scans nested packages, legacy emotion directories, and flat packs', (t) => {
  const f = fixture(t)
  f.addFiles(f.builtinDir, {
    'dafeiyu-001/manifest.json': '{"name":"dafeiyu"}',
    'dafeiyu-001/index.db': 'not-a-database',
    'dafeiyu-001/memes/morning/zaoshanghao.jpg': 'builtin-morning',
    'dafeiyu-001/memes/sad/qiurao.png': 'builtin-sad',
  })
  f.addFiles(f.userDir, {
    'legacy-pack/angry/shengqi.jpg': 'user-angry',
    'flat-pack/flat.webp': 'user-flat',
  })

  const library = loadMemeLibrary(f.config())
  assert.equal(library.memes.length, 4)
  assert.deepEqual(new Set(library.memes.map(record => record.source)), new Set([
    'builtin',
    'user',
  ]))
  const byName = new Map(library.memes.map(record => [record.name, record]))
  assert.deepEqual(
    {
      pack: byName.get('zaoshanghao')?.pack,
      source: byName.get('zaoshanghao')?.source,
      emotion: byName.get('zaoshanghao')?.emotion,
    },
    { pack: 'dafeiyu-001', source: 'builtin', emotion: 'morning' },
  )
  assert.equal(byName.get('qiurao')?.emotion, 'sad')
  assert.equal(byName.get('shengqi')?.emotion, 'angry')
  assert.equal(byName.get('flat')?.emotion, '')

  const rows = indexRows(f)
  assert.equal(rows.length, 4)
  assert.ok(rows.every(row => typeof row.name === 'string'))
  assert.ok(rows.every(row => typeof row.keywords === 'string'))
  assert.ok(rows.every(row => Number.isInteger(row.indexed_at)))
  assert.ok(rows.every(row => typeof row.mtime === 'number'))
  assert.ok(rows.every(row => row.path.endsWith('.jpg')
    || row.path.endsWith('.png')
    || row.path.endsWith('.webp')))
  assert.ok(rows.every(row => !/manifest|index\.db/.test(row.path)))
})

test('index contains the required package and emotion fields', (t) => {
  const f = fixture(t)
  f.addFiles(f.builtinDir, {
    'dafeiyu-001/memes/morning/zaoshanghao.jpg': 'required-fields',
  })
  loadMemeLibrary(f.config())

  const db = new DatabaseSync(join(f.dshHome, 'qq-meme-pick', 'index.db'), {
    readOnly: true,
  })
  try {
    const columns = db.prepare('PRAGMA table_info(memes)').all()
    const names = new Set(columns.map(column => column.name))
    for (const required of ['path', 'pack', 'source', 'emotion', 'name', 'mtime']) {
      assert.equal(names.has(required), true, `missing index column: ${required}`)
    }
  } finally {
    db.close()
  }
})

test('migrates and rebuilds an index created by the previous schema', (t) => {
  const f = fixture(t)
  const indexPath = join(f.dshHome, 'qq-meme-pick', 'index.db')
  mkdirSync(dirname(indexPath), { recursive: true })
  const oldDb = new DatabaseSync(indexPath)
  oldDb.exec(`
    CREATE TABLE memes (
      path TEXT NOT NULL PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      size_bytes INTEGER NOT NULL,
      hash TEXT NOT NULL,
      moods TEXT NOT NULL
    );
  `)
  oldDb.close()

  f.addFiles(f.builtinDir, {
    'dafeiyu-001/memes/morning/zaoshanghao.jpg': 'migrated-image',
  })
  const library = loadMemeLibrary(f.config())
  assert.equal(library.memes.length, 1)
  assert.equal(library.memes[0].pack, 'dafeiyu-001')
  assert.equal(library.memes[0].emotion, 'morning')
  const rows = indexRows(f)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].pack, 'dafeiyu-001')
  assert.equal(rows[0].emotion, 'morning')
})

test('works when only one scan directory exists', (t) => {
  const f = fixture(t)
  f.addFiles(f.builtinDir, {
    'builtin-pack/memes/daily/ganfan.webp': 'only-builtin',
  })

  const result = pickerFor(f).pick({ mood: 'daily' })
  assert.equal(result.files.length, 1)
  assert.match(result.files[0], /ganfan\.webp$/)
  assert.equal(isAbsolute(result.files[0]), true)

  const second = fixture(t)
  second.addFiles(second.userDir, {
    'user-pack/happy/smile.gif': 'only-user',
  })
  const resultWithUser = pickerFor(second).pick({ mood: 'happy' })
  assert.equal(resultWithUser.files.length, 1)
  assert.match(resultWithUser.files[0], /smile\.gif$/)
})

test('returns an empty array without throwing for empty roots and packages', (t) => {
  const f = fixture(t)
  mkdirSync(f.builtinDir, { recursive: true })
  mkdirSync(f.userDir, { recursive: true })
  mkdirSync(join(f.builtinDir, 'empty-builtin', 'memes'), { recursive: true })
  mkdirSync(join(f.userDir, 'empty-user'), { recursive: true })

  const result = pickerFor(f).pick({ keyword: 'anything' })
  assert.deepEqual(result.files, [])
  assert.match(result.caption, /图库为空/)
})

test('incremental index picks up a new file on rescan', (t) => {
  const f = fixture(t)
  f.addFiles(f.userDir, {
    'pack-a/memes/happy/old.jpg': 'old-image',
  })
  const picker = pickerFor(f)
  assert.match(picker.pick({ keyword: 'old' }).files[0], /old\.jpg$/)

  f.addFiles(f.userDir, {
    'pack-a/memes/happy/fresh-new.jpg': 'new-image',
  })
  const result = picker.pick({ keyword: 'fresh', rescan: true })
  assert.match(result.files[0], /fresh-new\.jpg$/)
  assert.equal(indexRows(f).length, 2)
})

test('cooldown prevents the same image from being returned again', (t) => {
  const f = fixture(t)
  f.addFiles(f.userDir, {
    'pack-a/memes/happy/only.png': 'single-image',
  })
  const picker = pickerFor(f)

  const first = picker.pick({})
  const second = picker.pick({})
  assert.equal(first.files.length, 1)
  assert.deepEqual(second.files, [])
  assert.match(second.caption, /冷却期/)
})

test('keyword matching wins before inferred mood and unknown input falls back', (t) => {
  const f = fixture(t)
  f.addFiles(f.userDir, {
    'pack-a/angry/shengqi.png': 'angry-image',
    'pack-a/daily/ganfan.png': 'daily-image',
  })

  const picker = pickerFor(f)
  const keywordWins = picker.pick({ mood: 'angry', keyword: '干饭' })
  assert.match(keywordWins.files[0], /ganfan\.png$/)

  const noMatch = pickerFor(f).pick({ mood: '未知情绪', keyword: '不存在' })
  assert.equal(noMatch.files.length, 1)
  assert.equal(isAbsolute(noMatch.files[0]), true)
})

test('indexes and picks all 24 package images with random selection and cooldown', (t) => {
  const f = fixture(t)
  const files = {}
  for (let index = 1; index <= 24; index += 1) {
    const number = String(index).padStart(2, '0')
    files[`dafeiyu-001/memes/morning/zaoshanghao-${number}.jpg`] = `image-${number}`
  }
  f.addFiles(f.builtinDir, files)

  let randomState = 123456789
  let randomCalls = 0
  const picker = new MemePicker({
    config: f.config(),
    random: () => {
      randomCalls += 1
      randomState = (randomState * 1103515245 + 12345) >>> 0
      return randomState / 0x100000000
    },
  })

  const picked = []
  for (let call = 0; call < 24; call += 1) {
    const result = picker.pick({ mood: 'daily' })
    assert.equal(result.files.length, 1)
    assert.match(result.files[0], /dafeiyu-001\/memes\/morning\/zaoshanghao-\d{2}\.jpg$/)
    picked.push(result.files[0])
  }

  assert.equal(indexRows(f).length, 24)
  assert.equal(new Set(picked).size, 24)
  assert.ok(randomCalls >= 24)
  const exhausted = picker.pick({ mood: 'daily' })
  assert.deepEqual(exhausted.files, [])
  assert.match(exhausted.caption, /冷却期/)
})

test('tool schema exposes rescan with a false default', () => {
  const tool = createQqMemeTool()
  assert.deepEqual(tool.parameters.rescan, {
    type: 'boolean',
    description: '为 true 时先完整重扫文件系统索引再挑图，默认 false。',
    default: false,
  })
})
