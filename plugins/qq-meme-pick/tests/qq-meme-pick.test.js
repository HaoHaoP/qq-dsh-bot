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
      'SELECT path, source, name, keywords, indexed_at, mtime_ms FROM memes ORDER BY path',
    ).all()
  } finally {
    db.close()
  }
}

test('scans both built-in and user directories and stores source metadata', (t) => {
  const f = fixture(t)
  f.addFiles(f.builtinDir, {
    'happy/deyi.png': 'builtin-image',
  })
  f.addFiles(f.userDir, {
    'pack-a/angry/shengqi.jpg': 'user-image',
  })

  const library = loadMemeLibrary(f.config())
  assert.equal(library.memes.length, 2)
  assert.deepEqual(new Set(library.memes.map(record => record.source)), new Set([
    'builtin',
    'user',
  ]))
  const rows = indexRows(f)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => typeof row.name === 'string'))
  assert.ok(rows.every(row => typeof row.keywords === 'string'))
  assert.ok(rows.every(row => Number.isInteger(row.indexed_at)))
})

test('works when only one scan directory exists', (t) => {
  const f = fixture(t)
  f.addFiles(f.builtinDir, {
    'daily/ganfan.webp': 'only-builtin',
  })

  const result = pickerFor(f).pick({ mood: 'daily' })
  assert.equal(result.files.length, 1)
  assert.match(result.files[0], /ganfan\.webp$/)
  assert.equal(isAbsolute(result.files[0]), true)

  const second = fixture(t)
  second.addFiles(second.userDir, {
    'pack-a/happy/smile.gif': 'only-user',
  })
  const resultWithUser = pickerFor(second).pick({ mood: 'happy' })
  assert.equal(resultWithUser.files.length, 1)
  assert.match(resultWithUser.files[0], /smile\.gif$/)
})

test('returns an empty array without throwing when both directories are empty', (t) => {
  const f = fixture(t)
  mkdirSync(f.builtinDir, { recursive: true })
  mkdirSync(f.userDir, { recursive: true })

  const result = pickerFor(f).pick({ keyword: 'anything' })
  assert.deepEqual(result.files, [])
  assert.match(result.caption, /图库为空/)
})

test('incremental index picks up a new file on rescan', (t) => {
  const f = fixture(t)
  f.addFiles(f.userDir, {
    'pack-a/happy/old.jpg': 'old-image',
  })
  const picker = pickerFor(f)
  assert.match(picker.pick({ keyword: 'old' }).files[0], /old\.jpg$/)

  f.addFiles(f.userDir, {
    'pack-a/happy/fresh-new.jpg': 'new-image',
  })
  const result = picker.pick({ keyword: 'fresh', rescan: true })
  assert.match(result.files[0], /fresh-new\.jpg$/)
  assert.equal(indexRows(f).length, 2)
})

test('cooldown prevents the same image from being returned again', (t) => {
  const f = fixture(t)
  f.addFiles(f.userDir, {
    'pack-a/happy/only.png': 'single-image',
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

test('tool schema exposes rescan with a false default', () => {
  const tool = createQqMemeTool()
  assert.deepEqual(tool.parameters.rescan, {
    type: 'boolean',
    description: '为 true 时先完整重扫文件系统索引再挑图，默认 false。',
    default: false,
  })
})
