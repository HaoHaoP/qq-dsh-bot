import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  EnergyChange,
  EnergyCharge,
  EnergyConfig,
  TurnMode,
  TurnRow,
} from './types.js'

interface EnergyRow {
  chat_id: string
  value: number
  updated_at: number
}

export function replyCost(characters: number, config: EnergyConfig): number {
  return config.baseReplyCost + Math.max(0, characters) * config.replyCostPerCharacter
}

export function recoverValue(
  value: number,
  updatedAt: number,
  now: number,
  config: EnergyConfig,
): { value: number; recovered: number } {
  const elapsedSeconds = Math.max(0, now - updatedAt) / 1000
  const recovered = elapsedSeconds * config.recoveryPerSecond
  const next = Math.min(config.maxEnergy, value + recovered)
  return { value: next, recovered: Math.max(0, next - value) }
}

export class StateStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS energy (
        chat_id TEXT PRIMARY KEY,
        value REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turn (
        chat_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        mode TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        chars INTEGER NOT NULL,
        cost REAL NOT NULL
      );
    `)
  }

  getEnergy(chatId: string): EnergyRow | undefined {
    return this.db
      .prepare('SELECT chat_id, value, updated_at FROM energy WHERE chat_id = ?')
      .get(chatId) as EnergyRow | undefined
  }

  ensureEnergy(chatId: string, initial: number, now: number): EnergyRow {
    const existing = this.getEnergy(chatId)
    if (existing !== undefined) return existing
    this.db
      .prepare('INSERT INTO energy (chat_id, value, updated_at) VALUES (?, ?, ?)')
      .run(chatId, initial, now)
    return { chat_id: chatId, value: initial, updated_at: now }
  }

  recover(chatId: string, config: EnergyConfig, now: number): EnergyChange {
    const row = this.ensureEnergy(chatId, config.initialEnergy, now)
    const next = recoverValue(row.value, row.updated_at, now, config)
    this.db
      .prepare('UPDATE energy SET value = ?, updated_at = ? WHERE chat_id = ?')
      .run(next.value, now, chatId)
    return {
      before: row.value,
      recovered: next.recovered,
      after: next.value,
    }
  }

  charge(
    chatId: string,
    characters: number,
    config: EnergyConfig,
    now: number,
  ): EnergyCharge {
    const recovered = this.recover(chatId, config, now)
    const cost = replyCost(characters, config)
    const after = Math.max(config.minEnergy, recovered.after - cost)
    this.db
      .prepare('UPDATE energy SET value = ?, updated_at = ? WHERE chat_id = ?')
      .run(after, now, chatId)
    return {
      before: recovered.after,
      recovered: recovered.recovered,
      after,
      cost,
      characters,
    }
  }

  recordTurn(input: {
    chatId: string
    at: number
    mode: TurnMode
    action: string
    reason: string
    characters?: number
    cost?: number
  }): void {
    this.db
      .prepare(`
        INSERT INTO turn (chat_id, at, mode, action, reason, chars, cost)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.chatId,
        input.at,
        input.mode,
        input.action,
        input.reason,
        input.characters ?? 0,
        input.cost ?? 0,
      )
  }

  turns(chatId?: string): TurnRow[] {
    const rows = chatId === undefined
      ? this.db.prepare('SELECT * FROM turn ORDER BY at ASC, rowid ASC').all()
      : this.db
        .prepare('SELECT * FROM turn WHERE chat_id = ? ORDER BY at ASC, rowid ASC')
        .all(chatId)
    return rows as unknown as TurnRow[]
  }

  close(): void {
    this.db.close()
  }
}

export function openStateStore(path: string): StateStore {
  return new StateStore(path)
}
