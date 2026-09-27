import type { Expense, Person, Settlement, SplitMode } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** At least 1p once rounded to pence (so "0.004" doesn't save as a £0.00 expense). */
export const isValidAmount = (n: number) => Number.isFinite(n) && round2(n) >= 0.01;

export function pctForSplit(split: SplitMode, tomPct: number): number {
  if (split === 'equal') return 50;
  if (split === 'tom') return 100;
  if (split === 'nuria') return 0;
  return Math.min(100, Math.max(0, tomPct));
}

/*
 * All balance maths is done in whole pence (minor units of the ledger currency), so shares always
 * add up exactly to the total and every row adds up exactly to the balance. Amounts are stored in
 * pounds as typed; they're turned into pence the same way on both phones every time, so there's
 * nothing extra to store or keep in step.
 */

/** Pounds → whole pence, halves rounded up. toPrecision strips float noise (1.005 × 100 = 100.4999…). */
export const toPence = (pounds: number) => Math.round(Number((pounds * 100).toPrecision(15)));

/** An expense or payment in the ledger currency, in whole pence (rounded once, from amount × rate). */
export const basePence = (e: { amount: number; rate: number }) => toPence(e.amount * e.rate);

/** Same, in pounds. */
export const baseAmount = (e: { amount: number; rate: number }) => basePence(e) / 100;

/**
 * Who pays the odd penny when a split lands exactly on a half penny (e.g. £10.01 at 50/50).
 * Decided by the expense's id: fixed for that expense forever (edits don't flip it), the same on
 * both phones, and close to 50/50 between the two of you over many expenses.
 */
export function oddPennyTo(id: string): Person {
  return fnv1a(id) >>> 31 ? 'nuria' : 'tom'; // the top bit is the best mixed
}

/** FNV-1a: a small, fast string hash (unsigned 32-bit). Not for anything secret. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Splittable = Pick<Expense, 'id' | 'amount' | 'rate' | 'split' | 'tomPct'>;

/** Tom's exact share in pence, before rounding to a whole penny. */
const tomExactPence = (e: Omit<Splittable, 'id'>) => (basePence(e) * pctForSplit(e.split, e.tomPct)) / 100;

const isHalf = (x: number) => Math.abs(x - Math.floor(x) - 0.5) < 1e-6;

/** Whether the split lands exactly on a half penny, i.e. someone has to pay an odd penny. */
export const hasOddPenny = (e: Omit<Splittable, 'id'>) => isHalf(tomExactPence(e));

/** Each person's share of an expense in whole pence; always sums to `basePence(e)`. */
export function sharesPence(e: Splittable): Record<Person, number> {
  const total = basePence(e);
  const exact = tomExactPence(e);
  // exactly half a penny: the odd penny goes by id; anything else rounds to the nearest penny
  const tom = isHalf(exact) ? (oddPennyTo(e.id) === 'tom' ? Math.ceil(exact) : Math.floor(exact)) : Math.round(exact);
  return { tom, nuria: total - tom };
}

/** Each person's share of an expense, in pounds (exact pence). */
export function shares(e: Splittable): Record<Person, number> {
  const s = sharesPence(e);
  return { tom: s.tom / 100, nuria: s.nuria / 100 };
}

/**
 * Effect of an expense on the balance in pence, as "what Nuria owes Tom".
 * Positive = Nuria owes Tom; negative = Tom owes Nuria.
 */
export function expenseEffectPence(e: Splittable & Pick<Expense, 'paidBy'>): number {
  const s = sharesPence(e);
  return e.paidBy === 'tom' ? s.nuria : -s.tom;
}

/** Same, in pounds. */
export const expenseEffect = (e: Expense) => expenseEffectPence(e) / 100;

export function settlementEffectPence(s: Settlement): number {
  const amt = basePence(s);
  // Nuria paying Tom reduces what Nuria owes Tom.
  return s.from === 'nuria' ? -amt : amt;
}

/** The running balance in pounds (a whole number of pence), as "what Nuria owes Tom". */
export function balance(expenses: Expense[], settlements: Settlement[]): number {
  let b = 0;
  for (const e of expenses) if (!e.deleted) b += expenseEffectPence(e);
  for (const s of settlements) if (!s.deleted) b += settlementEffectPence(s);
  return b / 100;
}

/** Turn the signed balance into a debtor/creditor pair. */
export function describeBalance(b: number): { debtor: Person; creditor: Person; amount: number } | null {
  if (Math.abs(b) < 0.005) return null;
  return b > 0 ? { debtor: 'nuria', creditor: 'tom', amount: b } : { debtor: 'tom', creditor: 'nuria', amount: -b };
}

const fmtCache = new Map<string, Intl.NumberFormat>();
export function fmt(amount: number, currency: string, opts: { sign?: boolean } = {}): string {
  const key = currency + (opts.sign ? '+' : '');
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      });
    } catch {
      f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    fmtCache.set(key, f);
  }
  return f.format(amount);
}

/** Parse user-typed money, accepting "12,50", "£12.50", "1,234.56". */
export function parseMoney(input: string): number {
  let s = String(input).trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // comma is decimal separator if followed by 1–2 digits
    const decimals = s.length - lastComma - 1;
    s = decimals <= 2 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  return parseFloat(s);
}
