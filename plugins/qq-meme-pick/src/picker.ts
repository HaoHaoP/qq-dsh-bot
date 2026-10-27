import {
  normalizeConfig,
  type QqMemeConfig,
} from './config.js'
import {
  loadMemeLibrary,
  type MemeRecord,
} from './library.js'
import { normalizeMoodQuery } from './moods.js'

export interface QqMemeRequest {
  mood?: string
  keyword?: string
  count?: number
  rescan?: boolean
}

export interface QqMemeResult {
  files: string[]
  caption: string
}

export interface MemePickerOptions {
  config?: QqMemeConfig
  now?: () => number
  random?: () => number
}

export function normalizeCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(count)) return 1
  return Math.max(1, Math.min(3, Math.floor(count)))
}

function keywordScore(record: MemeRecord, keyword: string): number {
  const normalized = keyword.trim().toLowerCase()
  if (normalized === '') return 0
  if (record.haystack.includes(normalized)) return 2

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const hits = tokens.filter(token => record.haystack.includes(token)).length
  return hits > 0 ? 1 : 0
}

function bestKeywordMatches(records: readonly MemeRecord[], keyword: string): MemeRecord[] {
  let best = 0
  let matches: MemeRecord[] = []
  for (const record of records) {
    const score = keywordScore(record, keyword)
    if (score === 0) continue
    if (score > best) {
      best = score
      matches = [record]
    } else if (score === best) {
      matches.push(record)
    }
  }
  return matches
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const raw = random()
    const normalized = Number.isFinite(raw) ? Math.max(0, Math.min(0.999999, raw)) : 0
    const swap = Math.floor(normalized * (index + 1))
    const current = out[index]
    out[index] = out[swap] as T
    out[swap] = current as T
  }
  return out
}

export class MemePicker {
  private readonly config
  private readonly now: () => number
  private readonly random: () => number
  private readonly lastShown = new Map<string, number>()

  constructor(options: MemePickerOptions = {}) {
    this.config = normalizeConfig(options.config)
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
  }

  pick(input: QqMemeRequest = {}): QqMemeResult {
    const count = normalizeCount(input.count)
    const currentTime = this.now()
    this.expireCooldowns(currentTime)

    const library = loadMemeLibrary(this.config, input.rescan === true)
    if (library.memes.length === 0) {
      return {
        files: [],
        caption: '内置与用户图库为空或图片文件不可读，没有可发送的表情包。',
      }
    }

    const eligible = library.memes.filter(record => !this.isCooling(record, currentTime))
    if (eligible.length === 0) {
      return {
        files: [],
        caption: '匹配范围里的表情包都在冷却期内，请稍后再试。',
      }
    }

    const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : ''
    const mood = typeof input.mood === 'string' ? input.mood.trim() : ''
    const keywordMatches = keyword === '' ? [] : bestKeywordMatches(eligible, keyword)
    const moodQuery = normalizeMoodQuery(mood)
    const moodMatches = mood === ''
      ? []
      : eligible.filter(record => record.moods.some(item => item === moodQuery))

    let primary = eligible
    let secondary: MemeRecord[] = []
    if (keywordMatches.length > 0) {
      primary = keywordMatches
      secondary = moodMatches
    } else if (moodMatches.length > 0) {
      primary = moodMatches
    }

    const selected: MemeRecord[] = []
    const used = new Set<string>()
    const ordered = [
      ...shuffled(primary, this.random),
      ...shuffled(secondary, this.random),
      ...shuffled(eligible, this.random),
    ]
    for (const record of ordered) {
      if (selected.length >= count) break
      if (used.has(record.identity)) continue
      used.add(record.identity)
      selected.push(record)
    }

    const shownAt = this.now()
    for (const record of selected) this.lastShown.set(record.identity, shownAt)

    const captions = selected.map(record => record.caption).filter(Boolean)
    return {
      files: selected.map(record => record.file),
      caption: captions.length > 0
        ? captions.join('；')
        : `已挑到 ${selected.length} 张表情包。`,
    }
  }

  private expireCooldowns(now: number): void {
    if (this.config.cooldownSeconds <= 0) {
      this.lastShown.clear()
      return
    }
    const cooldownMs = this.config.cooldownSeconds * 1000
    for (const [identity, shownAt] of this.lastShown) {
      if (shownAt + cooldownMs <= now) this.lastShown.delete(identity)
    }
  }

  private isCooling(record: MemeRecord, now: number): boolean {
    if (this.config.cooldownSeconds <= 0) return false
    const shownAt = this.lastShown.get(record.identity)
    if (shownAt === undefined) return false
    return shownAt + this.config.cooldownSeconds * 1000 > now
  }
}

export function pickMeme(
  input: QqMemeRequest = {},
  config: QqMemeConfig = {},
  options: Pick<MemePickerOptions, 'now' | 'random'> = {},
): QqMemeResult {
  return new MemePicker({ config, ...options }).pick(input)
}
