import { createHash } from 'node:crypto';
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync, } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
function isPackDir(dir) {
    try {
        return statSync(join(dir, 'index.db')).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Match dsh-meme's supported layouts: the scan root itself may be a pack,
 * direct children are packs, and one nested level is tolerated for old imports.
 */
export function discoverPackDirs(roots) {
    const found = [];
    const seen = new Set();
    const add = (dir) => {
        const key = resolve(dir);
        if (seen.has(key))
            return;
        seen.add(key);
        if (isPackDir(key))
            found.push(key);
    };
    const walk = (dir, depth) => {
        const resolved = resolve(dir);
        add(resolved);
        if (depth >= 2)
            return;
        let entries;
        try {
            entries = readdirSync(resolved, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.'))
                continue;
            walk(join(resolved, entry.name), depth + 1);
        }
    };
    for (const root of roots)
        walk(root, 0);
    return found.sort();
}
function within(root, target) {
    return target === root || target.startsWith(root + sep);
}
function contentHash(file) {
    return createHash('sha1').update(readFileSync(file)).digest('hex');
}
function tableColumns(db) {
    const rows = db.prepare('PRAGMA table_info(memes)').all();
    return new Set(rows
        .map(row => typeof row.name === 'string' ? row.name : '')
        .filter(Boolean));
}
function readPack(packDir) {
    const indexPath = join(packDir, 'index.db');
    const root = resolve(packDir);
    let rootReal;
    try {
        rootReal = realpathSync(root);
    }
    catch {
        return [];
    }
    const db = new DatabaseSync(indexPath, { readOnly: true });
    let rows = [];
    try {
        const columns = tableColumns(db);
        if (!columns.has('path') || !columns.has('tag'))
            return [];
        const fileExpr = columns.has('file_name') ? 'file_name' : "' ' AS file_name";
        const hashExpr = columns.has('file_hash')
            ? "COALESCE(file_hash, '') AS file_hash"
            : "'' AS file_hash";
        const captionExpr = columns.has('caption')
            ? "COALESCE(caption, '') AS caption"
            : "'' AS caption";
        const keywordsExpr = columns.has('keywords')
            ? "COALESCE(keywords, '') AS keywords"
            : "'' AS keywords";
        rows = db.prepare(`SELECT path, tag, ${fileExpr}, ${hashExpr}, ${captionExpr}, ${keywordsExpr}
       FROM memes ORDER BY path`).all();
    }
    catch {
        return [];
    }
    finally {
        db.close();
    }
    const out = [];
    for (const row of rows) {
        if (typeof row.path !== 'string' || row.path.trim() === '')
            continue;
        if (typeof row.tag !== 'string' || row.tag.trim() === '')
            continue;
        const candidate = resolve(rootReal, row.path);
        if (!within(rootReal, candidate))
            continue;
        let file;
        try {
            file = realpathSync(candidate);
            if (!within(rootReal, file))
                continue;
            if (!statSync(file).isFile())
                continue;
            accessSync(file, constants.R_OK);
        }
        catch {
            continue;
        }
        if (!IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
            continue;
        const fileName = typeof row.file_name === 'string' && row.file_name.trim() !== ''
            ? basename(row.file_name)
            : basename(file);
        const storedHash = typeof row.file_hash === 'string'
            ? row.file_hash.trim().toLowerCase()
            : '';
        let hash = storedHash;
        if (hash === '') {
            try {
                hash = contentHash(file);
            }
            catch {
                continue;
            }
        }
        const tag = row.tag.trim().toLowerCase();
        const stem = basename(fileName, extname(fileName));
        const caption = typeof row.caption === 'string' && row.caption.trim() !== ''
            ? row.caption.trim()
            : stem;
        const keywords = typeof row.keywords === 'string' ? row.keywords.trim() : '';
        const haystack = [
            tag,
            caption,
            keywords,
            fileName,
            stem,
            dirname(row.path),
        ].join(' ').toLowerCase();
        out.push({
            identity: `hash:${hash}`,
            file,
            tag,
            fileName,
            caption,
            keywords,
            hash,
            haystack,
            packDir: rootReal,
        });
    }
    return out;
}
/** Read every indexed image without writing, moving, or opening a writable DB. */
export function loadMemeLibrary(config) {
    const packDirs = discoverPackDirs([
        config.packsDir,
        ...config.extraPackDirs,
    ]);
    const byIdentity = new Map();
    for (const packDir of packDirs) {
        let rows = [];
        try {
            rows = readPack(packDir);
        }
        catch {
            continue;
        }
        for (const row of rows) {
            if (!byIdentity.has(row.identity))
                byIdentity.set(row.identity, row);
        }
    }
    return {
        memes: [...byIdentity.values()],
        packDirs,
    };
}
//# sourceMappingURL=library.js.map