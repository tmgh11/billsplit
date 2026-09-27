import { addDays, addMonthsAnchored, fromISO } from './dates';
import type { Expense, Person, Recurring } from './types';
import { pctForSplit } from './money';

const MAX_OCCURRENCES = 400; // safety net for catch-up after a long break

/** All occurrence dates of a template in (after, until], ascending. */
export function occurrences(r: Recurring, until: string, after?: string): string[] {
  const out: string[] = [];
  const within = (d: string) => (!after || d > after) && d <= until && (!r.endDate || d <= r.endDate);

  if (r.frequency === 'dates') {
    return [...new Set(r.dates ?? [])].sort().filter(within);
  }

  let i = 0;
  let d = r.startDate;
  while (d <= until && i < 5000) {
    if (r.endDate && d > r.endDate) break;
    if (within(d)) out.push(d);
    i++;
    if (r.frequency === 'weekly') d = addDays(r.startDate, 7 * i);
    else if (r.frequency === 'fortnightly') d = addDays(r.startDate, 14 * i);
    else if (r.frequency === 'monthly') d = addMonthsAnchored(r.startDate, i);
    else d = addMonthsAnchored(r.startDate, 12 * i);
  }
  return out.slice(-MAX_OCCURRENCES);
}

export function nextOccurrence(r: Recurring, fromDate: string): string | null {
  // never report a date that has already been written to the ledger
  const from = r.generatedUntil && r.generatedUntil >= fromDate ? addDays(r.generatedUntil, 1) : fromDate;
  if (r.frequency === 'dates') {
    return (r.dates ?? []).filter((d) => d >= from && (!r.endDate || d <= r.endDate)).sort()[0] ?? null;
  }
  // look up to ~2 years ahead
  const horizon = addDays(from, 800);
  const list = occurrences(r, horizon, addDays(from, -1));
  return list[0] ?? null;
}

/** Deterministic id so two phones generating the same occurrence never duplicate it. */
export const occurrenceId = (recId: string, date: string) => `${recId}__${date}`;

/**
 * Work out which ledger entries a template should add up to `today`.
 * `exists` lets the caller skip ids already present (including deleted tombstones).
 */
export function dueExpenses(
  r: Recurring,
  todayISO: string,
  exists: (id: string) => boolean,
  me: Person,
): { expenses: Expense[]; generatedUntil?: string } {
  if (r.deleted || r.paused) return { expenses: [] };
  const dates = occurrences(r, todayISO, r.generatedUntil);
  const now = Date.now();
  const expenses: Expense[] = dates
    .filter((d) => !exists(occurrenceId(r.id, d)))
    .map((date) => ({
      id: occurrenceId(r.id, date),
      kind: 'expense',
      date,
      description: r.description,
      category: r.category,
      amount: r.amount,
      currency: r.currency,
      rate: 1, // caller fills in the rate
      paidBy: r.paidBy,
      split: r.split,
      tomPct: pctForSplit(r.split, r.tomPct),
      recurringId: r.id,
      createdBy: me,
      updatedAt: now,
    }));
  return { expenses, generatedUntil: dates.length ? dates[dates.length - 1] : undefined };
}

export function describeFrequency(r: Recurring): string {
  const d = fromISO(r.startDate);
  const day = d.getDate();
  const suffix = (n: number) =>
    n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  switch (r.frequency) {
    case 'weekly':
      return `Every ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`;
    case 'fortnightly':
      return `Every other ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`;
    case 'monthly':
      return `Monthly on the ${day}${suffix(day)}`;
    case 'yearly':
      return `Yearly on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    case 'dates':
      return `${(r.dates ?? []).length} set date${(r.dates ?? []).length === 1 ? '' : 's'}`;
  }
}
