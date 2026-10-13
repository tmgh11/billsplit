/**
 * Direct debits: household bills paid from one person's account, shared by salary or a fixed %.
 * They never touch the ledger; this works out what each of you owes the other per month.
 * All maths is in whole pence, like the ledger (see money.ts).
 */
import { sharesPence, toPence } from './money';
import type { DirectDebit, Person, Settings } from './types';

type Salaries = Settings['salaries'];

/**
 * Tom's share of the household income as a whole percentage (e.g. 52), or null until both
 * salaries are in. Rounded so the split you see is exactly the split that's charged.
 */
export function incomeTomPct(salaries: Salaries): number | null {
  const tom = salaries?.tom ?? 0;
  const nuria = salaries?.nuria ?? 0;
  if (!(tom > 0) || !(nuria > 0)) return null;
  return Math.round((tom / (tom + nuria)) * 100);
}

/** Tom's share of this bill (0–100), or null if it's split by income and a salary is missing. */
export function debitTomPct(d: Pick<DirectDebit, 'split' | 'tomPct'>, salaries: Salaries): number | null {
  if (d.split === 'equal') return 50;
  if (d.split === 'custom') return Math.min(100, Math.max(0, d.tomPct));
  return incomeTomPct(salaries);
}

/** The bill per month in pence (a yearly bill ÷ 12, to the nearest penny). */
export function monthlyPence(d: Pick<DirectDebit, 'amount' | 'period'>): number {
  const p = toPence(d.amount);
  return d.period === 'yearly' ? Math.round(p / 12) : p;
}

/**
 * Each person's share of the monthly amount in pence (always adds up to `monthlyPence`), or null
 * if it can't be worked out yet. Half pennies go by the bill's id, as for expenses.
 */
export function debitSharesPence(
  d: Pick<DirectDebit, 'id' | 'amount' | 'period' | 'split' | 'tomPct'>,
  salaries: Salaries,
): Record<Person, number> | null {
  const pct = debitTomPct(d, salaries);
  if (pct == null) return null;
  return sharesPence({ id: d.id, amount: monthlyPence(d) / 100, rate: 1, split: 'custom', tomPct: pct });
}

export interface DebitSummary {
  /** all bills per month, in pence */
  totalPence: number;
  /** each person's share of the bills per month, in pence (bills that can't be split yet are left out) */
  sharePence: Record<Person, number>;
  /** per month, in pence: what Nuria transfers Tom for bills in his name, and the other way round */
  nuriaToTomPence: number;
  tomToNuriaPence: number;
  /** bills split by income that are waiting for both salaries */
  missingIncome: number;
}

export function summariseDebits(debits: DirectDebit[], salaries: Salaries): DebitSummary {
  const s: DebitSummary = { totalPence: 0, sharePence: { tom: 0, nuria: 0 }, nuriaToTomPence: 0, tomToNuriaPence: 0, missingIncome: 0 };
  for (const d of debits) {
    if (d.deleted) continue;
    s.totalPence += monthlyPence(d);
    const sh = debitSharesPence(d, salaries);
    if (!sh) {
      s.missingIncome++;
      continue;
    }
    s.sharePence.tom += sh.tom;
    s.sharePence.nuria += sh.nuria;
    if (d.paidBy === 'tom') s.nuriaToTomPence += sh.nuria;
    else s.tomToNuriaPence += sh.tom;
  }
  return s;
}

/** "1st", "2nd", "23rd", "31st" */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
