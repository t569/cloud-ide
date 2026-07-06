// Relative timestamp ("2 hours ago") via the Intl stdlib — no date lib.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// { threshold in seconds, unit, seconds-per-unit }
const STEPS: ReadonlyArray<[number, Intl.RelativeTimeFormatUnit, number]> = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
  [2629800, 'week', 604800],
  [31557600, 'month', 2629800],
  [Infinity, 'year', 31557600],
];

export function timeAgo(ts: number, now: number = Date.now()): string {
  const secs = Math.round((ts - now) / 1000); // negative = past
  const abs = Math.abs(secs);
  for (const [limit, unit, div] of STEPS) {
    if (abs < limit) return rtf.format(Math.round(secs / div), unit);
  }
  return rtf.format(Math.round(secs / 31557600), 'year');
}
