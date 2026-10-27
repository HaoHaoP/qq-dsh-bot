import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
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
const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS memes (
  path TEXT NOT NULL PRIMARY KEY,
  pack TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
  emotion TEXT NOT NULL,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  mtime REAL NOT NULL,
  mtime_ms REAL NOT NULL,
  size_bytes INTEGER NOT NULL,
  hash TEXT NOT NULL,
  moods TEXT NOT NULL
);
`;
const INDEX_SCHEMA = `
CREATE INDEX IF NOT EXISTS memes_source_idx ON memes(source);
CREATE INDEX IF NOT EXISTS memes_pack_idx ON memes(pack);
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
function readableDirectory(path) {
    try {
        const realPath = realpathSync(path);
        if (!statSync(realPath).isDirectory())
            return undefined;
        accessSync(realPath, constants.R_OK);
        return realPath;
    }
    catch {
        return undefined;
    }
}
function emotionFromRelativePath(relativePath) {
    const directory = dirname(relativePath);
    if (directory === '.' || directory === '')
        return '';
    return directory.split(sep)[0] ?? '';
}
/**
 * Every immediate child of a library root is a package. A package's image tree
 * is its nested `memes/` directory when present, otherwise the package root.
 */
function scanLibraryRoot(root, source) {
    if (root === undefined)
        return [];
    const rootReal = readableDirectory(root);
    if (rootReal === undefined)
        return [];
    let entries;
    try {
        entries = readdirSync(rootReal, { withFileTypes: true });
    }
    catch {
        return [];
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const found = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const packPath = readableDirectory(join(rootReal, entry.name));
        if (packPath === undefined)
            continue;
        const nestedMemes = readableDirectory(join(packPath, 'memes'));
        const contentRoot = nestedMemes ?? packPath;
        const pack = entry.name;
        const walk = (dir) => {
            let children;
            try {
                children = readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            children.sort((left, right) => left.name.localeCompare(right.name));
            for (const child of children) {
                const candidate = join(dir, child.name);
                if (child.isDirectory()) {
                    walk(candidate);
                    continue;
                }
                if (!child.isFile())
                    continue;
                if (!IMAGE_EXTENSIONS.has(extname(child.name).toLowerCase()))
                    continue;
                try {
                    const path = realpathSync(candidate);
                    const stat = statSync(path);
                    if (!stat.isFile())
                        continue;
                    accessSync(path, constants.R_OK);
                    const relativePath = relative(contentRoot, path);
                    found.push({
                        path,
                        pack,
                        source,
                        emotion: emotionFromRelativePath(relativePath),
                        relativePath,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                    });
                }
                catch {
                    // A file can disappear while scanning. Ignore only that entry.
                }
            }
        };
        walk(contentRoot);
    }
    return found;
}
function fileNameStem(file) {
    return basename(file, extname(file));
}
function buildMetadata(file) {
    const name = fileNameStem(file.path);
    const terms = [...new Set([
            ...splitTerms(file.pack),
            ...splitTerms(file.emotion),
            ...splitTerms(file.relativePath),
            name,
            ...splitTerms(name),
        ])];
    const moods = inferMoods(`${file.pack} ${file.emotion} ${file.relativePath} ${name}`);
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
function ensureSchema(db) {
    db.exec(TABLE_SCHEMA);
    const columns = new Set(db.prepare('PRAGMA table_info(memes)').all()
        .map(row => asString(row.name))
        .filter(Boolean));
    const hadMtimeMs = columns.has('mtime_ms');
    let migrated = false;
    const additions = [
        ['pack', "TEXT NOT NULL DEFAULT ''"],
        ['emotion', "TEXT NOT NULL DEFAULT ''"],
        ['mtime', 'REAL NOT NULL DEFAULT 0'],
        ['mtime_ms', 'REAL NOT NULL DEFAULT 0'],
    ];
    for (const [column, definition] of additions) {
        if (columns.has(column))
            continue;
        db.exec(`ALTER TABLE memes ADD COLUMN ${column} ${definition}`);
        migrated = true;
    }
    if (hadMtimeMs) {
        db.exec('UPDATE memes SET mtime = mtime_ms WHERE mtime = 0');
    }
    db.exec(INDEX_SCHEMA);
    return migrated;
}
function loadExisting(db) {
    const rows = db.prepare(`SELECT path, pack, source, emotion, name, keywords, mtime, size_bytes, hash, moods
     FROM memes`).all();
    const existing = new Map();
    for (const row of rows) {
        const path = asString(row.path);
        if (path !== '')
            existing.set(path, row);
    }
    return existing;
}
function refreshIndex(db, files, rescan) {
    const existing = loadExisting(db);
    const upsert = db.prepare(`
    INSERT INTO memes
      (path, pack, source, emotion, name, keywords, indexed_at, mtime, mtime_ms, size_bytes, hash, moods)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      pack = excluded.pack,
      source = excluded.source,
      emotion = excluded.emotion,
      name = excluded.name,
      keywords = excluded.keywords,
      indexed_at = excluded.indexed_at,
      mtime = excluded.mtime,
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
                && asNumber(previous.mtime) === file.mtime
                && asNumber(previous.size_bytes) === file.size
                && asString(previous.pack) === file.pack
                && asString(previous.emotion) === file.emotion;
            if (!rescan && unchanged)
                continue;
            let hash;
            try {
                hash = contentHash(file.path);
            }
            catch {
                continue;
            }
            const metadata = buildMetadata(file);
            upsert.run(file.path, file.pack, file.source, file.emotion, metadata.name, metadata.keywords, indexedAt, file.mtime, file.mtime, file.size, hash, metadata.moods.join(','));
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
function toRecords(rows) {
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
        const name = asString(row.name) || fileNameStem(file);
        const pack = asString(row.pack);
        const emotion = asString(row.emotion);
        const keywords = asString(row.keywords);
        const moods = asString(row.moods)
            .split(',')
            .filter((mood) => mood !== '');
        const record = {
            identity: `hash:${hash}`,
            file,
            pack,
            source,
            emotion,
            name,
            caption: name,
            keywords,
            moods,
            hash,
            mtime: asNumber(row.mtime),
            haystack: [pack, emotion, name, keywords, moods.join(' ')]
                .join(' ')
                .toLowerCase(),
        };
        if (!byIdentity.has(record.identity))
            byIdentity.set(record.identity, record);
    }
    return [...byIdentity.values()];
}
/**
 * Read the plugin's filesystem-derived index. An empty or migrated index, and
 * an explicit rescan, triggers a complete package-tree scan before selection.
 */
export function loadMemeLibrary(config, rescan = false) {
    const builtinDir = config.builtinDir ?? resolveBuiltinMemesDir();
    mkdirSync(dirname(config.indexDbPath), { recursive: true });
    const db = new DatabaseSync(config.indexDbPath);
    try {
        const migrated = ensureSchema(db);
        const countRow = db.prepare('SELECT COUNT(*) AS count FROM memes').get();
        const count = typeof countRow.count === 'number' ? countRow.count : 0;
        if (rescan || migrated || count === 0) {
            const files = [
                ...scanLibraryRoot(builtinDir, 'builtin'),
                ...scanLibraryRoot(config.packsDir, 'user'),
            ];
            refreshIndex(db, files, rescan || migrated);
        }
        const rows = db.prepare(`SELECT path, pack, source, emotion, name, keywords, hash, moods, mtime
       FROM memes ORDER BY path`).all();
        return {
            memes: toRecords(rows),
            scanDirs: [builtinDir, config.packsDir]
                .filter((dir) => dir !== undefined),
        };
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=library.js.map