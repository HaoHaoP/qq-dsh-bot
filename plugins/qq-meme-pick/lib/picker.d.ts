import { type QqMemeConfig } from './config.js';
export interface QqMemeRequest {
    mood?: string;
    keyword?: string;
    count?: number;
}
export interface QqMemeResult {
    files: string[];
    caption: string;
}
export interface MemePickerOptions {
    config?: QqMemeConfig;
    now?: () => number;
    random?: () => number;
}
export declare function normalizeCount(value: unknown): number;
export declare class MemePicker {
    private readonly config;
    private readonly now;
    private readonly random;
    private readonly lastShown;
    constructor(options?: MemePickerOptions);
    pick(input?: QqMemeRequest): QqMemeResult;
    private expireCooldowns;
    private isCooling;
}
export declare function pickMeme(input?: QqMemeRequest, config?: QqMemeConfig, options?: Pick<MemePickerOptions, 'now' | 'random'>): QqMemeResult;
//# sourceMappingURL=picker.d.ts.map