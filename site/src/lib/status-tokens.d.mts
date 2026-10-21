export interface StatusColors { marker: string; bg: string; text: string }
export type StatusName = 'ok' | 'warn' | 'alert';
export interface PageColors { paper: string; surface: string; ink: string; inkSoft: string; inkFaint: string; navyTint: string; accentTint: string }
export const PAGE: Record<string, PageColors>;
export const STATUS_TOKENS: Record<string, Record<StatusName, StatusColors>>;
export const MIN_TEXT: number;
export const MIN_NON_TEXT: number;
export function statusTokensCss(): string;
