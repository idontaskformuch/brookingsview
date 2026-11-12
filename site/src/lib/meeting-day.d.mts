export function meetingDayParts(
  value: string | Date | null | undefined,
  timezone: string,
  meetingsHaveTime: boolean,
): { y: number; m: number; d: number } | null;
export function meetingDayKey(
  value: string | Date | null | undefined,
  timezone: string,
  meetingsHaveTime: boolean,
): string | null;
