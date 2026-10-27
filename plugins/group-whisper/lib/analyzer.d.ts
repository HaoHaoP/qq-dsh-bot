import type { LlmLike, SecretaryDecision, SecretaryInput } from './types.js';
interface AnalyzerOptions {
    llm: LlmLike | undefined;
    model: string;
    preferredProvider?: string;
    log?(message: string): void;
}
export declare class ModelDecider {
    private readonly llm;
    private readonly model;
    private readonly preferredProvider;
    private route;
    constructor(options: AnalyzerOptions);
    private resolveRoute;
    decide(input: SecretaryInput): Promise<SecretaryDecision>;
}
export declare function createModelDecider(options: AnalyzerOptions): ModelDecider;
export {};
//# sourceMappingURL=analyzer.d.ts.map