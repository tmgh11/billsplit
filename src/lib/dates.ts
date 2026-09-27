/** Date helpers working on local-time YYYY-MM-DD strings (no timezone surprises). */

export const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => toISO(new Date());

/**
 * A Postgres timestamp (e.g. "2026-09-27T20:01:02.123456+00:00") moved back by `ms`, as an ISO
 * string. Fractional seconds are cut to milliseconds first, since Safari won't parse more digits.
 * Returns null if the timestamp can't be read.
 */
export function rewindTimestamp(ts: string, ms: number): string | null {
  const t = Date.parse(ts.replace(/\.(\d+)/, (_, f: string) => `.${f.padEnd(3, '0').slice(0, 3)}`));
  return Number.isFinite(t) ? new Date(t - ms).toISOString() : null;
}

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Add months keeping the anchor day, clamped to month end (31 Jan + 1m → 28/29 Feb). */
export function addMonthsAnchored(anchor: string, months: number): string {
  const [y, m, d] = anchor.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return toISO(target);
}

export const monthKey = (s: string) => s.slice(0, 7);

export function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
  });
}

export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function prettyDate(s: string): string {
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  if (s === addDays(t, 1)) return 'Tomorrow';
  const d = fromISO(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}
