import type { NormalizedQqMemeConfig } from './config.js';
import { type Mood } from './moods.js';
export type MemeSource = 'builtin' | 'user';
export interface MemeRecord {
    identity: string;
    file: string;
    pack: string;
    source: MemeSource;
    emotion: string;
    name: string;
    caption: string;
    keywords: string;
    moods: Mood[];
    hash: string;
    mtime: number;
    haystack: string;
}
export interface MemeLibrary {
    memes: MemeRecord[];
    scanDirs: string[];
}
/**
 * Locate dsh-meme through Node's package resolver. A host may omit the package;
 * that is treated as an absent optional scan directory.
 */
export declare function resolveBuiltinMemesDir(): string | undefined;
/**
 * Read the plugin's filesystem-derived index. An empty or migrated index, and
 * an explicit rescan, triggers a complete package-tree scan before selection.
 */
export declare function loadMemeLibrary(config: NormalizedQqMemeConfig, rescan?: boolean): MemeLibrary;
//# sourceMappingURL=library.d.ts.map