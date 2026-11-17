export type MonthModuleKind = 'decisions' | 'projects' | 'sales' | 'events' | 'traffic' | 'jobs';
export type ModuleStatus = 'full' | 'partial' | 'none';
type DateValue = string | Date | null | undefined;

export const MONTH_IN_REVIEW_START: Record<string, { year: number; month: number }>;
export const MIN_MODULES_FOR_INDEX: number;
export const MONTH_GATE_MINIMUMS: Record<MonthModuleKind, number>;
export const MONTH_MODULE_KINDS: MonthModuleKind[];
export const MONTH_ROW_DATE_FIELD: Record<MonthModuleKind, string>;

export function monthQueryWindow(year: number, month: number): { start: Date; end: Date };
export function localMonthOf(
  kind: MonthModuleKind, value: DateValue, timezone: string, meetingsHaveTime: boolean,
): { y: number; m: number } | null;
export function rowsInMonth<T>(
  kind: MonthModuleKind, rows: T[], year: number, month: number, timezone: string, meetingsHaveTime: boolean,
): T[];
export function jobDistinctKey(title: string, company: string | null): string;
export function gateCount(kind: MonthModuleKind, monthRows: object[]): number;
export function floorStatus(
  kind: MonthModuleKind, floor: DateValue, year: number, month: number, timezone: string, meetingsHaveTime: boolean,
): ModuleStatus;
export function moduleClears(kind: MonthModuleKind, status: ModuleStatus, count: number): boolean;
export function clearedModuleKinds(
  modules: Partial<Record<MonthModuleKind, { status: ModuleStatus; gateCount: number }>>,
): MonthModuleKind[];
export function clearedModuleCount(
  modules: Partial<Record<MonthModuleKind, { status: ModuleStatus; gateCount: number }>>,
): number;
export function monthGate(
  data: Partial<Record<MonthModuleKind, { rows: object[]; floor?: DateValue }>>,
  year: number, month: number, timezone: string, meetingsHaveTime: boolean,
): {
  modules: Record<MonthModuleKind, { status: ModuleStatus; gateCount: number }>;
  cleared: number;
  indexable: boolean;
};
export function monthsFromStart(townId: string, timezone: string, now?: Date): { year: number; month: number }[];
