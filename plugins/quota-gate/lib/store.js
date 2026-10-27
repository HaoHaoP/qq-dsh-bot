import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function totalOf(row) {
    return row.prompt_tokens + row.completion_tokens + row.cached_tokens;
}
function emptyRow(scope) {
    return {
        day: scope.day,
        group_id: scope.groupId,
        user_id: scope.userId,
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        requests: 0,
        updated_at: '',
    };
}
function keyOf(scope) {
    return `${scope.day}\u0000${scope.groupId}\u0000${scope.userId}`;
}
class JsonUsageStore {
    path;
    backend = 'json';
    state;
    constructor(path) {
        this.path = path;
        this.state = this.read();
    }
    read() {
        if (!existsSync(this.path))
            return { version: 1, usage: {}, notices: {} };
        try {
            const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
            return {
                version: 1,
                usage: parsed.usage ?? {},
                notices: parsed.notices ?? {},
            };
        }
        catch {
            return { version: 1, usage: {}, notices: {} };
        }
    }
    write() {
        const temp = `${this.path}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify(this.state), 'utf8');
        renameSync(temp, this.path);
    }
    record(scope, delta, updatedAt) {
        const key = keyOf(scope);
        const current = this.state.usage[key] ?? emptyRow(scope);
        this.state.usage[key] = {
            ...current,
            prompt_tokens: current.prompt_tokens + delta.prompt_tokens,
            completion_tokens: current.completion_tokens + delta.completion_tokens,
            cached_tokens: current.cached_tokens + delta.cached_tokens,
            requests: current.requests + 1,
            updated_at: updatedAt,
        };
        this.write();
    }
    get(scope) {
        return { ...(this.state.usage[keyOf(scope)] ?? emptyRow(scope)) };
    }
    groupTotal(scope) {
        let total = 0;
        for (const row of Object.values(this.state.usage)) {
            if (row.day === scope.day && row.group_id === scope.groupId)
                total += totalOf(row);
        }
        return total;
    }
    top(scope, limit) {
        return Object.values(this.state.usage)
            .filter((row) => row.day === scope.day && row.group_id === scope.groupId)
            .sort((a, b) => totalOf(b) - totalOf(a) || a.user_id.localeCompare(b.user_id))
            .slice(0, limit)
            .map((row) => ({ ...row }));
    }
    resetGroup(scope) {
        let removed = 0;
        for (const [key, row] of Object.entries(this.state.usage)) {
            if (row.day === scope.day && row.group_id === scope.groupId) {
                delete this.state.usage[key];
                removed += 1;
            }
        }
        for (const key of Object.keys(this.state.notices)) {
            const [day, groupId] = key.split('\u0000');
            if (day === scope.day && groupId === scope.groupId)
                delete this.state.notices[key];
        }
        this.write();
        return removed;
    }
    markNotice(scope, updatedAt) {
        const key = keyOf(scope);
        if (this.state.notices[key] !== undefined)
            return false;
        this.state.notices[key] = updatedAt;
        this.write();
        return true;
    }
    close() { }
}
class SqliteUsageStore {
    db;
    backend = 'sqlite';
    constructor(db) {
        this.db = db;
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
    `);
    }
    record(scope, delta, updatedAt) {
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
            .run(scope.day, scope.groupId, scope.userId, delta.prompt_tokens, delta.completion_tokens, delta.cached_tokens, updatedAt);
    }
    get(scope) {
        const row = this.db
            .prepare(`
        SELECT day, group_id, user_id, prompt_tokens, completion_tokens,
               cached_tokens, requests, updated_at
        FROM usage WHERE day = ? AND group_id = ? AND user_id = ?
      `)
            .get(scope.day, scope.groupId, scope.userId);
        return row ?? emptyRow(scope);
    }
    groupTotal(scope) {
        const row = this.db
            .prepare(`
        SELECT COALESCE(SUM(prompt_tokens + completion_tokens + cached_tokens), 0) AS total
        FROM usage WHERE day = ? AND group_id = ?
      `)
            .get(scope.day, scope.groupId);
        return Number(row?.total ?? 0);
    }
    top(scope, limit) {
        return this.db
            .prepare(`
        SELECT day, group_id, user_id, prompt_tokens, completion_tokens,
               cached_tokens, requests, updated_at
        FROM usage
        WHERE day = ? AND group_id = ?
        ORDER BY prompt_tokens + completion_tokens + cached_tokens DESC, user_id ASC
        LIMIT ?
      `)
            .all(scope.day, scope.groupId, limit);
    }
    resetGroup(scope) {
        const result = this.db
            .prepare('DELETE FROM usage WHERE day = ? AND group_id = ?')
            .run(scope.day, scope.groupId);
        this.db
            .prepare('DELETE FROM quota_notice WHERE day = ? AND group_id = ?')
            .run(scope.day, scope.groupId);
        return Number(result.changes);
    }
    markNotice(scope, updatedAt) {
        const result = this.db
            .prepare(`
        INSERT OR IGNORE INTO quota_notice (day, group_id, user_id, notified_at)
        VALUES (?, ?, ?, ?)
      `)
            .run(scope.day, scope.groupId, scope.userId, updatedAt);
        return Number(result.changes) > 0;
    }
    close() {
        this.db.close();
    }
}
export function openUsageStore(databasePath, options = {}) {
    mkdirSync(join(databasePath, '..'), { recursive: true });
    if (options.forceBackend === 'json') {
        const jsonPath = databasePath.replace(/\.db$/i, '.json');
        return new JsonUsageStore(jsonPath);
    }
    try {
        const require = createRequire(import.meta.url);
        const sqlite = require('node:sqlite');
        return new SqliteUsageStore(new sqlite.DatabaseSync(databasePath));
    }
    catch (error) {
        if (options.forceBackend === 'sqlite')
            throw error;
        const jsonPath = databasePath.replace(/\.db$/i, '.json');
        options.log?.('warn', `node:sqlite unavailable; falling back to ${jsonPath}: ${error instanceof Error ? error.message : String(error)}`);
        return new JsonUsageStore(jsonPath);
    }
}
//# sourceMappingURL=store.js.map