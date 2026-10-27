import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
export const DEFAULT_COOLDOWN_SECONDS = 300;
export function dshHome() {
    const configured = process.env.DSH_HOME?.trim();
    return configured !== undefined && configured !== ''
        ? resolve(expandHome(configured))
        : join(homedir(), '.dsh');
}
export function expandHome(value) {
    const path = value.trim();
    if (path === '~')
        return homedir();
    if (path.startsWith('~/') || path.startsWith('~\\')) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
function absolutePath(value, cwd) {
    const expanded = expandHome(value);
    return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}
export function normalizeCooldownSeconds(value) {
    const seconds = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(seconds) && seconds >= 0
        ? seconds
        : DEFAULT_COOLDOWN_SECONDS;
}
export function normalizeConfig(input = {}) {
    const cwd = process.cwd();
    const home = dshHome();
    const packsDir = typeof input.packsDir === 'string' && input.packsDir.trim() !== ''
        ? absolutePath(input.packsDir, cwd)
        : join(home, 'meme-packs');
    const extraPackDirs = Array.isArray(input.extraPackDirs)
        ? input.extraPackDirs
            .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
            .map(entry => absolutePath(entry, cwd))
        : [];
    return {
        packsDir,
        extraPackDirs,
        cooldownSeconds: normalizeCooldownSeconds(input.cooldownSeconds),
    };
}
//# sourceMappingURL=config.js.map