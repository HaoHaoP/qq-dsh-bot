import type { EnergyChange, EnergyCharge, EnergyConfig, TurnMode, TurnRow } from './types.js';
interface EnergyRow {
    chat_id: string;
    value: number;
    updated_at: number;
}
export declare function replyCost(characters: number, config: EnergyConfig): number;
export declare function recoverValue(value: number, updatedAt: number, now: number, config: EnergyConfig): {
    value: number;
    recovered: number;
};
export declare class StateStore {
    private readonly db;
    constructor(path: string);
    getEnergy(chatId: string): EnergyRow | undefined;
    ensureEnergy(chatId: string, initial: number, now: number): EnergyRow;
    recover(chatId: string, config: EnergyConfig, now: number): EnergyChange;
    charge(chatId: string, characters: number, config: EnergyConfig, now: number): EnergyCharge;
    recordTurn(input: {
        chatId: string;
        at: number;
        mode: TurnMode;
        action: string;
        reason: string;
        characters?: number;
        cost?: number;
    }): void;
    turns(chatId?: string): TurnRow[];
    close(): void;
}
export declare function openStateStore(path: string): StateStore;
export {};
//# sourceMappingURL=store.d.ts.map