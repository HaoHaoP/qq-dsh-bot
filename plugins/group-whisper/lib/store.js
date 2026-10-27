import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function replyCost(characters, config) {
    return config.baseReplyCost + Math.max(0, characters) * config.replyCostPerCharacter;
}
export function recoverValue(value, updatedAt, now, config) {
    const elapsedSeconds = Math.max(0, now - updatedAt) / 1000;
    const recovered = elapsedSeconds * config.recoveryPerSecond;
    const next = Math.min(config.maxEnergy, value + recovered);
    return { value: next, recovered: Math.max(0, next - value) };
}
export class StateStore {
    db;
    constructor(path) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
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
    `);
    }
    getEnergy(chatId) {
        return this.db
            .prepare('SELECT chat_id, value, updated_at FROM energy WHERE chat_id = ?')
            .get(chatId);
    }
    ensureEnergy(chatId, initial, now) {
        const existing = this.getEnergy(chatId);
        if (existing !== undefined)
            return existing;
        this.db
            .prepare('INSERT INTO energy (chat_id, value, updated_at) VALUES (?, ?, ?)')
            .run(chatId, initial, now);
        return { chat_id: chatId, value: initial, updated_at: now };
    }
    recover(chatId, config, now) {
        const row = this.ensureEnergy(chatId, config.initialEnergy, now);
        const next = recoverValue(row.value, row.updated_at, now, config);
        this.db
            .prepare('UPDATE energy SET value = ?, updated_at = ? WHERE chat_id = ?')
            .run(next.value, now, chatId);
        return {
            before: row.value,
            recovered: next.recovered,
            after: next.value,
        };
    }
    charge(chatId, characters, config, now) {
        const recovered = this.recover(chatId, config, now);
        const cost = replyCost(characters, config);
        const after = Math.max(config.minEnergy, recovered.after - cost);
        this.db
            .prepare('UPDATE energy SET value = ?, updated_at = ? WHERE chat_id = ?')
            .run(after, now, chatId);
        return {
            before: recovered.after,
            recovered: recovered.recovered,
            after,
            cost,
            characters,
        };
    }
    recordTurn(input) {
        this.db
            .prepare(`
        INSERT INTO turn (chat_id, at, mode, action, reason, chars, cost)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
            .run(input.chatId, input.at, input.mode, input.action, input.reason, input.characters ?? 0, input.cost ?? 0);
    }
    turns(chatId) {
        const rows = chatId === undefined
            ? this.db.prepare('SELECT * FROM turn ORDER BY at ASC, rowid ASC').all()
            : this.db
                .prepare('SELECT * FROM turn WHERE chat_id = ? ORDER BY at ASC, rowid ASC')
                .all(chatId);
        return rows;
    }
    close() {
        this.db.close();
    }
}
export function openStateStore(path) {
    return new StateStore(path);
}
//# sourceMappingURL=store.js.map