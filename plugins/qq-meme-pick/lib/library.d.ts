import type { NormalizedQqMemeConfig } from './config.js';
export interface MemeRecord {
    identity: string;
    file: string;
    tag: string;
    fileName: string;
    caption: string;
    keywords: string;
    hash: string;
    haystack: string;
    packDir: string;
}
export interface MemeLibrary {
    memes: MemeRecord[];
    packDirs: string[];
}
/**
 * Match dsh-meme's supported layouts: the scan root itself may be a pack,
 * direct children are packs, and one nested level is tolerated for old imports.
 */
export declare function discoverPackDirs(roots: readonly string[]): string[];
/** Read every indexed image without writing, moving, or opening a writable DB. */
export declare function loadMemeLibrary(config: NormalizedQqMemeConfig): MemeLibrary;
//# sourceMappingURL=library.d.ts.map