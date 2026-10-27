import type { NormalizedQqMemeConfig } from './config.js';
import { type Mood } from './moods.js';
export type MemeSource = 'builtin' | 'user';
export interface MemeRecord {
    identity: string;
    file: string;
    source: MemeSource;
    name: string;
    caption: string;
    keywords: string;
    moods: Mood[];
    hash: string;
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
/** Read and incrementally refresh the plugin's filesystem-derived index. */
export declare function loadMemeLibrary(config: NormalizedQqMemeConfig, rescan?: boolean): MemeLibrary;
//# sourceMappingURL=library.d.ts.map