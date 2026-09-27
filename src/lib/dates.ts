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
