import { addDays, addMonthsAnchored, fromISO, today } from './dates';
import type { Entry, Expense, Frequency, Person, Recurring } from './types';
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

/** `exists` (optional) skips dates already in the ledger, including deleted ones. */
export function nextOccurrence(r: Recurring, fromDate: string, exists: (id: string) => boolean = () => false): string | null {
  // never report a date that has already been written to the ledger
  const from = r.generatedUntil && r.generatedUntil >= fromDate ? addDays(r.generatedUntil, 1) : fromDate;
  const notAdded = (d: string) => !exists(occurrenceId(r.id, d));
  if (r.frequency === 'dates') {
    return (r.dates ?? []).filter((d) => d >= from && (!r.endDate || d <= r.endDate) && notAdded(d)).sort()[0] ?? null;
  }
  // look up to ~2 years ahead
  const horizon = addDays(from, 800);
  return occurrences(r, horizon, addDays(from, -1)).find(notAdded) ?? null;
}

/** Deterministic id so two phones generating the same occurrence never duplicate it. */
export const occurrenceId = (recId: string, date: string) => `${recId}__${date}`;

/**
 * Version stamp for automatically added occurrences: lower than any real edit, so if the other
 * phone has already edited or deleted the same occurrence, its version always wins.
 */
export const GENERATED_STAMP = 1;

/**
 * Work out which ledger entries a template should add up to `today`.
 * `exists` lets the caller skip ids already present (including deleted tombstones), which is what
 * stops repeats; `generatedUntil` is only a floor that a person sets (see the Recurring type).
 */
export function dueExpenses(r: Recurring, todayISO: string, exists: (id: string) => boolean, me: Person): Expense[] {
  if (r.deleted || r.paused) return [];
  return occurrences(r, todayISO, r.generatedUntil)
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
      updatedAt: GENERATED_STAMP,
    }));
}

/**
 * Latest date on or before which a template's occurrences should never be (re)added: the saved
 * floor, or the newest occurrence already in the ledger. Set when a person saves the template, so
 * moving its start date earlier doesn't back-fill months that were already handled.
 */
export function addedUntil(r: Pick<Recurring, 'id' | 'generatedUntil'>, ledger: Iterable<{ id: string; kind: string; date?: string; recurringId?: string }>) {
  let until = r.generatedUntil;
  for (const e of ledger) {
    if (e.kind === 'expense' && e.recurringId === r.id && e.date && (!until || e.date > until)) until = e.date;
  }
  return until;
}

/** Did an edit change when a template falls due (as opposed to e.g. its amount)? */
export const scheduleChanged = (a: Recurring, b: Recurring) =>
  a.frequency !== b.frequency || a.startDate !== b.startDate || (a.dates ?? []).join() !== (b.dates ?? []).join();

const daysBetween = (a: string, b: string) => Math.round(Math.abs(fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000);

/** Whether two dates fall in the same period of a schedule (so one occurrence is expected, not two). */
function samePeriod(f: Frequency, a: string, b: string) {
  if (f === 'monthly') return a.slice(0, 7) === b.slice(0, 7);
  if (f === 'yearly') return a.slice(0, 4) === b.slice(0, 4);
  if (f === 'weekly') return daysBetween(a, b) < 7;
  if (f === 'fortnightly') return daysBetween(a, b) < 14;
  return false;
}

/** An occurrence already in the ledger, and the date the edited schedule would add another. */
export interface Clash {
  from: Expense;
  to: string;
}

/**
 * After a template's schedule is edited, find dates the new schedule would add in a period that
 * already has an occurrence from the old schedule, e.g. a monthly bill moved from the 1st to the
 * 15th after this month's was added on the 1st. The caller asks whether to move it or keep both.
 * Deleted occurrences count too (moving one keeps that period skipped).
 */
export function scheduleClashes(r: Recurring, ledger: Iterable<Entry>, todayISO = today()): Clash[] {
  if (r.frequency === 'dates' || r.paused || r.deleted) return [];
  const existing = [...ledger].filter((e): e is Expense => e.kind === 'expense' && e.recurringId === r.id);
  if (!existing.length) return [];
  const have = new Set(existing.map((e) => e.date));
  const used = new Set<string>();
  const clashes: Clash[] = [];
  // Existing occurrences are all in the past, so only the next year of new dates can clash.
  for (const to of occurrences(r, addDays(todayISO, 366), r.generatedUntil)) {
    if (have.has(to)) continue;
    const from = existing.find((e) => !used.has(e.id) && samePeriod(r.frequency, e.date, to));
    if (!from) continue;
    used.add(from.id);
    clashes.push({ from, to });
  }
  return clashes;
}

/** Move each clashing occurrence to its new date: same details, new date and id. */
export const movedOccurrences = (clashes: Clash[]): Expense[] =>
  clashes.flatMap(({ from, to }) => [
    { ...from, id: occurrenceId(from.recurringId!, to), date: to },
    { ...from, deleted: true },
  ]);

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
