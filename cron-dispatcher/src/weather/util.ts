/** Python's round(): half to even. Shared by the Met Office and NWS ports so both round exactly like the Python parsers. */
export const pyRound = (x: number): number => {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
};

/** Number or null (strings, NaN, null and undefined are all "no value"). */
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Python: round(x, 1) for a value that is a float; done as round(x*10)/10 in both languages so they cannot disagree. */
export const round1 = (x: number): number => pyRound(x * 10) / 10;
