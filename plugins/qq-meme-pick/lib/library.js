import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { inferMoods, splitTerms, } from './moods.js';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MOOD_KEYWORDS = {
    happy: ['happy', '开心', '高兴', '快乐', '好耶'],
    angry: ['angry', '生气', '愤怒'],
    sad: ['sad', '难过', '伤心', '哭'],
    shy: ['shy', '害羞', '脸红'],
    confused: ['confused', '困惑', '疑惑', '惊讶'],
    daily: ['daily', '日常', '睡觉', '上班', '摸鱼', '干饭'],
};
const SCHEMA = `
CREATE TABLE IF NOT EXISTS memes (
  path TEXT NOT NULL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  size_bytes INTEGER NOT NULL,
  hash TEXT NOT NULL,
  moods TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memes_source_idx ON memes(source);
`;
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function asNumber(value) {
    return typeof value === 'number' ? value : Number.NaN;
}
function packageRootFromUrl(url) {
    return dirname(fileURLToPath(url));
}
/**
 * Locate dsh-meme through Node's package resolver. A host may omit the package;
 * that is treated as an absent optional scan directory.
 */
export function resolveBuiltinMemesDir() {
    try {
        return join(packageRootFromUrl(import.meta.resolve('dsh-meme/package.json')), 'memes');
    }
    catch {
        return undefined;
    }
}
function scanRoot(root, source) {
    if (root === undefined)
        return [];
    let rootReal;
    try {
        rootReal = realpathSync(root);
        if (!statSync(rootReal).isDirectory())
            return [];
        accessSync(rootReal, constants.R_OK);
    }
    catch {
        return [];
    }
    const found = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const candidate = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(candidate);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
                continue;
            try {
                const path = realpathSync(candidate);
                const stat = statSync(path);
                if (!stat.isFile())
                    continue;
                accessSync(path, constants.R_OK);
                found.push({
                    path,
                    source,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size,
                });
            }
            catch {
                // A file can disappear while scanning. Ignore only that entry.
            }
        }
    };
    walk(rootReal);
    return found;
}
function humanizeName(file) {
    const stem = basename(file, extname(file));
    const words = splitTerms(stem);
    return words.length > 0 ? words.join(' ') : stem;
}
function buildMetadata(file, root) {
    const name = humanizeName(file);
    const relativePath = relative(root, file);
    const terms = [...new Set([
            ...splitTerms(relativePath),
            ...splitTerms(name),
        ])];
    const moods = inferMoods(`${relativePath} ${name}`);
    const keywords = [...new Set([
            ...terms,
            ...moods,
            ...moods.flatMap(mood => MOOD_KEYWORDS[mood]),
        ])].join(' ');
    return { name, keywords, moods };
}
function contentHash(file) {
    return createHash('sha1').update(readFileSync(file)).digest('hex');
}
function rootForSource(source, roots) {
    return source === 'builtin' ? roots.builtin : roots.user;
}
function loadExisting(db) {
    const rows = db.prepare(`SELECT path, source, name, keywords, mtime_ms, size_bytes, hash, moods
     FROM memes`).all();
    const existing = new Map();
    for (const row of rows) {
        const path = asString(row.path);
        if (path !== '')
            existing.set(path, row);
    }
    return existing;
}
function refreshIndex(db, files, roots, rescan) {
    const existing = loadExisting(db);
    const upsert = db.prepare(`
    INSERT INTO memes
      (path, source, name, keywords, indexed_at, mtime_ms, size_bytes, hash, moods)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      source = excluded.source,
      name = excluded.name,
      keywords = excluded.keywords,
      indexed_at = excluded.indexed_at,
      mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes,
      hash = excluded.hash,
      moods = excluded.moods
  `);
    const deleteStale = db.prepare('DELETE FROM memes WHERE path = ?');
    const seen = new Set();
    const indexedAt = Date.now();
    db.exec('BEGIN');
    try {
        for (const file of files) {
            if (!seen.add(file.path))
                continue;
            const previous = existing.get(file.path);
            const unchanged = previous !== undefined
                && asNumber(previous.mtime_ms) === file.mtimeMs
                && asNumber(previous.size_bytes) === file.size;
            if (!rescan && unchanged)
                continue;
            const root = rootForSource(file.source, roots);
            if (root === undefined)
                continue;
            let hash;
            try {
                hash = contentHash(file.path);
            }
            catch {
                continue;
            }
            const metadata = buildMetadata(file.path, resolve(root));
            upsert.run(file.path, file.source, metadata.name, metadata.keywords, indexedAt, file.mtimeMs, file.size, hash, metadata.moods.join(','));
        }
        for (const path of existing.keys()) {
            if (!seen.has(path))
                deleteStale.run(path);
        }
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
function toRecords(rows, roots) {
    const byIdentity = new Map();
    for (const row of rows) {
        const file = asString(row.path);
        const source = row.source === 'builtin' ? 'builtin' : row.source === 'user' ? 'user' : undefined;
        const hash = asString(row.hash);
        if (file === '' || source === undefined || hash === '')
            continue;
        try {
            if (!statSync(file).isFile())
                continue;
            accessSync(file, constants.R_OK);
        }
        catch {
            continue;
        }
        const name = asString(row.name) || humanizeName(file);
        const keywords = asString(row.keywords);
        const moods = asString(row.moods)
            .split(',')
            .filter((mood) => mood !== '');
        const root = rootForSource(source, roots);
        const relativePath = root === undefined ? basename(file) : relative(resolve(root), file);
        const record = {
            identity: `hash:${hash}`,
            file,
            source,
            name,
            caption: name,
            keywords,
            moods,
            hash,
            haystack: [relativePath, name, keywords, moods.join(' ')].join(' ').toLowerCase(),
        };
        if (!byIdentity.has(record.identity))
            byIdentity.set(record.identity, record);
    }
    return [...byIdentity.values()];
}
/** Read and incrementally refresh the plugin's filesystem-derived index. */
export function loadMemeLibrary(config, rescan = false) {
    const builtinDir = config.builtinDir ?? resolveBuiltinMemesDir();
    const roots = {
        builtin: builtinDir,
        user: config.packsDir,
    };
    const files = [
        ...scanRoot(roots.builtin, 'builtin'),
        ...scanRoot(roots.user, 'user'),
    ];
    mkdirSync(dirname(config.indexDbPath), { recursive: true });
    const db = new DatabaseSync(config.indexDbPath);
    try {
        db.exec(SCHEMA);
        refreshIndex(db, files, roots, rescan);
        const rows = db.prepare(`SELECT path, source, name, keywords, hash, moods
       FROM memes ORDER BY path`).all();
        return {
            memes: toRecords(rows, roots),
            scanDirs: [builtinDir, config.packsDir]
                .filter((dir) => dir !== undefined),
        };
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=library.js.map