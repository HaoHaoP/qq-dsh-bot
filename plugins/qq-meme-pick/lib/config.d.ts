export interface QqMemeConfig {
    packsDir?: string;
    extraPackDirs?: string[];
    cooldownSeconds?: number;
}
export interface NormalizedQqMemeConfig {
    packsDir: string;
    extraPackDirs: string[];
    cooldownSeconds: number;
}
export declare const DEFAULT_COOLDOWN_SECONDS = 300;
export declare function dshHome(): string;
export declare function expandHome(value: string): string;
export declare function normalizeCooldownSeconds(value: unknown): number;
export declare function normalizeConfig(input?: QqMemeConfig): NormalizedQqMemeConfig;
//# sourceMappingURL=config.d.ts.map