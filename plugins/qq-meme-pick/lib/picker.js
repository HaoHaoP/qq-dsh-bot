import { normalizeConfig, } from './config.js';
import { loadMemeLibrary, } from './library.js';
import { normalizeMoodQuery } from './moods.js';
export function normalizeCount(value) {
    const count = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(count))
        return 1;
    return Math.max(1, Math.min(3, Math.floor(count)));
}
function keywordScore(record, keyword) {
    const normalized = keyword.trim().toLowerCase();
    if (normalized === '')
        return 0;
    if (record.haystack.includes(normalized))
        return 2;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0)
        return 0;
    const hits = tokens.filter(token => record.haystack.includes(token)).length;
    return hits > 0 ? 1 : 0;
}
function bestKeywordMatches(records, keyword) {
    let best = 0;
    let matches = [];
    for (const record of records) {
        const score = keywordScore(record, keyword);
        if (score === 0)
            continue;
        if (score > best) {
            best = score;
            matches = [record];
        }
        else if (score === best) {
            matches.push(record);
        }
    }
    return matches;
}
function shuffled(items, random) {
    const out = [...items];
    for (let index = out.length - 1; index > 0; index -= 1) {
        const raw = random();
        const normalized = Number.isFinite(raw) ? Math.max(0, Math.min(0.999999, raw)) : 0;
        const swap = Math.floor(normalized * (index + 1));
        const current = out[index];
        out[index] = out[swap];
        out[swap] = current;
    }
    return out;
}
export class MemePicker {
    config;
    now;
    random;
    lastShown = new Map();
    constructor(options = {}) {
        this.config = normalizeConfig(options.config);
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
    }
    pick(input = {}) {
        const count = normalizeCount(input.count);
        const currentTime = this.now();
        this.expireCooldowns(currentTime);
        const library = loadMemeLibrary(this.config, input.rescan === true);
        if (library.memes.length === 0) {
            return {
                files: [],
                caption: '内置与用户图库为空或图片文件不可读，没有可发送的表情包。',
            };
        }
        const eligible = library.memes.filter(record => !this.isCooling(record, currentTime));
        if (eligible.length === 0) {
            return {
                files: [],
                caption: '匹配范围里的表情包都在冷却期内，请稍后再试。',
            };
        }
        const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
        const mood = typeof input.mood === 'string' ? input.mood.trim() : '';
        const keywordMatches = keyword === '' ? [] : bestKeywordMatches(eligible, keyword);
        const moodQuery = normalizeMoodQuery(mood);
        const moodMatches = mood === ''
            ? []
            : eligible.filter(record => record.emotion.toLowerCase() === moodQuery
                || record.moods.some(item => item === moodQuery));
        let primary = eligible;
        let secondary = [];
        if (keywordMatches.length > 0) {
            primary = keywordMatches;
            secondary = moodMatches;
        }
        else if (moodMatches.length > 0) {
            primary = moodMatches;
        }
        const selected = [];
        const used = new Set();
        const ordered = [
            ...shuffled(primary, this.random),
            ...shuffled(secondary, this.random),
            ...shuffled(eligible, this.random),
        ];
        for (const record of ordered) {
            if (selected.length >= count)
                break;
            if (used.has(record.identity))
                continue;
            used.add(record.identity);
            selected.push(record);
        }
        const shownAt = this.now();
        for (const record of selected)
            this.lastShown.set(record.identity, shownAt);
        const captions = selected.map(record => record.caption).filter(Boolean);
        return {
            files: selected.map(record => record.file),
            caption: captions.length > 0
                ? captions.join('；')
                : `已挑到 ${selected.length} 张表情包。`,
        };
    }
    expireCooldowns(now) {
        if (this.config.cooldownSeconds <= 0) {
            this.lastShown.clear();
            return;
        }
        const cooldownMs = this.config.cooldownSeconds * 1000;
        for (const [identity, shownAt] of this.lastShown) {
            if (shownAt + cooldownMs <= now)
                this.lastShown.delete(identity);
        }
    }
    isCooling(record, now) {
        if (this.config.cooldownSeconds <= 0)
            return false;
        const shownAt = this.lastShown.get(record.identity);
        if (shownAt === undefined)
            return false;
        return shownAt + this.config.cooldownSeconds * 1000 > now;
    }
}
export function pickMeme(input = {}, config = {}, options = {}) {
    return new MemePicker({ config, ...options }).pick(input);
}
//# sourceMappingURL=picker.js.map