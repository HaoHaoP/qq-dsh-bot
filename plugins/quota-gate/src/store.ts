import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageDelta, UsageRow, UsageScope } from './types.js'

export interface UsageStore {
  readonly backend: 'sqlite' | 'json'
  record(scope: UsageScope, delta: UsageDelta, updatedAt: string): void
  get(scope: UsageScope): UsageRow
  groupTotal(scope: Pick<UsageScope, 'day' | 'groupId'>): number
  top(scope: Pick<UsageScope, 'day' | 'groupId'>, limit: number): UsageRow[]
  resetGroup(scope: Pick<UsageScope, 'day' | 'groupId'>): number
  markNotice(scope: UsageScope, updatedAt: string): boolean
  close(): void
}

export function totalOf(row: UsageRow): number {
  return row.prompt_tokens + row.completion_tokens + row.cached_tokens
}

function emptyRow(scope: UsageScope): UsageRow {
  return {
    day: scope.day,
    group_id: scope.groupId,
    user_id: scope.userId,
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
    requests: 0,
    updated_at: '',
  }
}

function keyOf(scope: Pick<UsageScope, 'day' | 'groupId' | 'userId'>): string {
  return `${scope.day}\u0000${scope.groupId}\u0000${scope.userId}`
}

interface JsonState {
  version: 1
  usage: Record<string, UsageRow>
  notices: Record<string, string>
}

class JsonUsageStore implements UsageStore {
  readonly backend = 'json' as const
  private readonly state: JsonState

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): JsonState {
    if (!existsSync(this.path)) return { version: 1, usage: {}, notices: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<JsonState>
      return {
        version: 1,
        usage: parsed.usage ?? {},
        notices: parsed.notices ?? {},
      }
    } catch {
      return { version: 1, usage: {}, notices: {} }
    }
  }

  private write(): void {
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(this.state), 'utf8')
    renameSync(temp, this.path)
  }

  record(scope: UsageScope, delta: UsageDelta, updatedAt: string): void {
    const key = keyOf(scope)
    const current = this.state.usage[key] ?? emptyRow(scope)
    this.state.usage[key] = {
      ...current,
      prompt_tokens: current.prompt_tokens + delta.prompt_tokens,
      completion_tokens: current.completion_tokens + delta.completion_tokens,
      cached_tokens: current.cached_tokens + delta.cached_tokens,
      requests: current.requests + 1,
      updated_at: updatedAt,
    }
    this.write()
  }

  get(scope: UsageScope): UsageRow {
    return { ...(this.state.usage[keyOf(scope)] ?? emptyRow(scope)) }
  }

  groupTotal(scope: Pick<UsageScope, 'day' | 'groupId'>): number {
    let total = 0
    for (const row of Object.values(this.state.usage)) {
      if (row.day === scope.day && row.group_id === scope.groupId) total += totalOf(row)
    }
    return total
  }

  top(scope: Pick<UsageScope, 'day' | 'groupId'>, limit: number): UsageRow[] {
    return Object.values(this.state.usage)
      .filter((row) => row.day === scope.day && row.group_id === scope.groupId)
      .sort((a, b) => totalOf(b) - totalOf(a) || a.user_id.localeCompare(b.user_id))
      .slice(0, limit)
      .map((row) => ({ ...row }))
  }

  resetGroup(scope: Pick<UsageScope, 'day' | 'groupId'>): number {
    let removed = 0
    for (const [key, row] of Object.entries(this.state.usage)) {
      if (row.day === scope.day && row.group_id === scope.groupId) {
        delete this.state.usage[key]
        removed += 1
      }
    }
    for (const key of Object.keys(this.state.notices)) {
      const [day, groupId] = key.split('\u0000')
      if (day === scope.day && groupId === scope.groupId) delete this.state.notices[key]
    }
    this.write()
    return removed
  }

  markNotice(scope: UsageScope, updatedAt: string): boolean {
    const key = keyOf(scope)
    if (this.state.notices[key] !== undefined) return false
    this.state.notices[key] = updatedAt
    this.write()
    return true
  }

  close(): void {}
}

type SqliteModule = typeof import('node:sqlite')

class SqliteUsageStore implements UsageStore {
  readonly backend = 'sqlite' as const

  constructor(private readonly db: import('node:sqlite').DatabaseSync) {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS usage (
        day TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (day, group_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS usage_day_group ON usage (day, group_id);
      CREATE TABLE IF NOT EXISTS quota_notice (
        day TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        notified_at TEXT NOT NULL,
        PRIMARY KEY (day, group_id, user_id)
      );
    `)
  }

  record(scope: UsageScope, delta: UsageDelta, updatedAt: string): void {
    this.db
      .prepare(`
        INSERT INTO usage (
          day, group_id, user_id, prompt_tokens, completion_tokens,
          cached_tokens, requests, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(day, group_id, user_id) DO UPDATE SET
          prompt_tokens = prompt_tokens + excluded.prompt_tokens,
          completion_tokens = completion_tokens + excluded.completion_tokens,
          cached_tokens = cached_tokens + excluded.cached_tokens,
          requests = requests + 1,
          updated_at = excluded.updated_at
      `)
      .run(
        scope.day,
        scope.groupId,
        scope.userId,
        delta.prompt_tokens,
        delta.completion_tokens,
        delta.cached_tokens,
        updatedAt,
      )
  }

  get(scope: UsageScope): UsageRow {
    const row = this.db
      .prepare(`
        SELECT day, group_id, user_id, prompt_tokens, completion_tokens,
               cached_tokens, requests, updated_at
        FROM usage WHERE day = ? AND group_id = ? AND user_id = ?
      `)
      .get(scope.day, scope.groupId, scope.userId) as UsageRow | undefined
    return row ?? emptyRow(scope)
  }

  groupTotal(scope: Pick<UsageScope, 'day' | 'groupId'>): number {
    const row = this.db
      .prepare(`
        SELECT COALESCE(SUM(prompt_tokens + completion_tokens + cached_tokens), 0) AS total
        FROM usage WHERE day = ? AND group_id = ?
      `)
      .get(scope.day, scope.groupId) as { total: number } | undefined
    return Number(row?.total ?? 0)
  }

  top(scope: Pick<UsageScope, 'day' | 'groupId'>, limit: number): UsageRow[] {
    return this.db
      .prepare(`
        SELECT day, group_id, user_id, prompt_tokens, completion_tokens,
               cached_tokens, requests, updated_at
        FROM usage
        WHERE day = ? AND group_id = ?
        ORDER BY prompt_tokens + completion_tokens + cached_tokens DESC, user_id ASC
        LIMIT ?
      `)
      .all(scope.day, scope.groupId, limit) as unknown as UsageRow[]
  }

  resetGroup(scope: Pick<UsageScope, 'day' | 'groupId'>): number {
    const result = this.db
      .prepare('DELETE FROM usage WHERE day = ? AND group_id = ?')
      .run(scope.day, scope.groupId)
    this.db
      .prepare('DELETE FROM quota_notice WHERE day = ? AND group_id = ?')
      .run(scope.day, scope.groupId)
    return Number(result.changes)
  }

  markNotice(scope: UsageScope, updatedAt: string): boolean {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO quota_notice (day, group_id, user_id, notified_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(scope.day, scope.groupId, scope.userId, updatedAt)
    return Number(result.changes) > 0
  }

  close(): void {
    this.db.close()
  }
}

export interface OpenStoreOptions {
  forceBackend?: 'sqlite' | 'json'
  log?: (level: 'warn' | 'info', message: string) => void
}

export function openUsageStore(
  databasePath: string,
  options: OpenStoreOptions = {},
): UsageStore {
  mkdirSync(join(databasePath, '..'), { recursive: true })
  if (options.forceBackend === 'json') {
    const jsonPath = databasePath.replace(/\.db$/i, '.json')
    return new JsonUsageStore(jsonPath)
  }

  try {
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as SqliteModule
    return new SqliteUsageStore(new sqlite.DatabaseSync(databasePath))
  } catch (error) {
    if (options.forceBackend === 'sqlite') throw error
    const jsonPath = databasePath.replace(/\.db$/i, '.json')
    options.log?.(
      'warn',
      `node:sqlite unavailable; falling back to ${jsonPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return new JsonUsageStore(jsonPath)
  }
}
