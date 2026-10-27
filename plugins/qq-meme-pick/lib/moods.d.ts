export type Mood = 'happy' | 'angry' | 'sad' | 'shy' | 'confused' | 'daily';
export declare const MOOD_TRIGGERS: Readonly<Record<Mood, readonly string[]>>;
export declare const MOOD_QUERY_ALIASES: Readonly<Record<string, Mood>>;
export declare function splitTerms(text: string): string[];
export declare function inferMoods(text: string): Mood[];
export declare function normalizeMoodQuery(value: string): string;
//# sourceMappingURL=moods.d.ts.map