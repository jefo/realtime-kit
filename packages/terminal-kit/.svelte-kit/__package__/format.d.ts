export declare function formatPrice(value: number, decimals?: number): string;
export declare function formatSize(value: number, decimals?: number): string;
export declare function formatCompact(value: number, decimals?: number): string;
export declare function formatInteger(value: number): string;
export declare function formatPercent(value: number, digits?: number, signed?: boolean): string;
export declare function formatSigned(value: number, digits?: number): string;
export interface TimeFormatOptions {
    seconds?: boolean;
    timeZone?: string;
}
export declare function formatTime(input: number | Date, options?: TimeFormatOptions): string;
export declare function formatDuration(ms: number): string;
export declare function formatDelta(value: number, digits?: number): string;
