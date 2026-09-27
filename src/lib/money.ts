import type { Expense, Person, Settlement, SplitMode } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function pctForSplit(split: SplitMode, tomPct: number): number {
  if (split === 'equal') return 50;
  if (split === 'tom') return 100;
  if (split === 'nuria') return 0;
  return Math.min(100, Math.max(0, tomPct));
}

/** Amount of an expense in the ledger currency. */
export const baseAmount = (e: { amount: number; rate: number }) => e.amount * e.rate;

/** Each person's share of an expense, in ledger currency. */
export function shares(e: Pick<Expense, 'amount' | 'rate' | 'split' | 'tomPct'>): Record<Person, number> {
  const total = baseAmount(e);
  const tom = (total * pctForSplit(e.split, e.tomPct)) / 100;
  return { tom, nuria: total - tom };
}

/**
 * Effect of an expense on the balance, expressed as "what Nuria owes Tom".
 * Positive = Nuria owes Tom; negative = Tom owes Nuria.
 */
export function expenseEffect(e: Expense): number {
  const s = shares(e);
  return e.paidBy === 'tom' ? s.nuria : -s.tom;
}

export function settlementEffect(s: Settlement): number {
  const amt = baseAmount(s);
  // Nuria paying Tom reduces what Nuria owes Tom.
  return s.from === 'nuria' ? -amt : amt;
}

export function balance(expenses: Expense[], settlements: Settlement[]): number {
  let b = 0;
  for (const e of expenses) if (!e.deleted) b += expenseEffect(e);
  for (const s of settlements) if (!s.deleted) b += settlementEffect(s);
  return round2(b);
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
