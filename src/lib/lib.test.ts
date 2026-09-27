import { describe, expect, it } from 'vitest';
import { balance, describeBalance, parseMoney, shares } from './money';
import { occurrences, dueExpenses } from './recurring';
import { guessCategory, learnRule } from './categories';
import { parseReceiptText, receiptTotals } from './receipt';
import { parseSplitwise } from './splitwise';
import type { Expense, Recurring, Settlement } from './types';

const exp = (p: Partial<Expense>): Expense => ({
  id: Math.random().toString(), kind: 'expense', date: '2026-09-01', description: 'x', category: 'other',
  amount: 100, currency: 'GBP', rate: 1, paidBy: 'tom', split: 'equal', tomPct: 50, updatedAt: 1, ...p,
});
const set = (p: Partial<Settlement>): Settlement => ({
  id: Math.random().toString(), kind: 'settlement', date: '2026-09-01', from: 'nuria', to: 'tom', amount: 10,
  currency: 'GBP', rate: 1, updatedAt: 1, ...p,
});

describe('balance', () => {
  it('50/50 paid by Tom → Nuria owes half', () => {
    expect(balance([exp({})], [])).toBe(50);
  });
  it('paid by Tom, all Nuria’s → Nuria owes everything', () => {
    expect(balance([exp({ split: 'nuria' })], [])).toBe(100);
  });
  it('paid by Tom, all Tom’s → no effect', () => {
    expect(balance([exp({ split: 'tom' })], [])).toBe(0);
  });
  it('paid by Nuria 50/50 → Tom owes half', () => {
    expect(describeBalance(balance([exp({ paidBy: 'nuria' })], []))).toEqual({ debtor: 'tom', creditor: 'nuria', amount: 50 });
  });
  it('custom split and foreign currency', () => {
    const e = exp({ amount: 200, currency: 'EUR', rate: 0.85, split: 'custom', tomPct: 30 });
    expect(shares(e).tom).toBeCloseTo(51);
    expect(balance([e], [])).toBeCloseTo(119);
  });
  it('partial and full settlements', () => {
    const b = balance([exp({})], [set({ amount: 20 })]);
    expect(b).toBe(30);
    expect(balance([exp({})], [set({ amount: 50 })])).toBe(0);
    expect(balance([exp({})], [set({ amount: 30, from: 'tom', to: 'nuria' })])).toBe(80);
  });
  it('ignores deleted', () => {
    expect(balance([exp({ deleted: true })], [])).toBe(0);
  });
});

describe('parseMoney', () => {
  it('handles formats', () => {
    expect(parseMoney('£12.50')).toBe(12.5);
    expect(parseMoney('12,50')).toBe(12.5);
    expect(parseMoney('1,234.56')).toBe(1234.56);
    expect(parseMoney('1.234,56')).toBe(1234.56);
  });
});

describe('recurring', () => {
  const r: Recurring = {
    id: 'r1', kind: 'recurring', description: 'Mortgage', category: 'mortgage', amount: 1200, currency: 'GBP',
    paidBy: 'tom', split: 'equal', tomPct: 50, frequency: 'monthly', startDate: '2026-01-31', updatedAt: 1,
  };
  it('monthly clamps to month end and keeps the anchor day', () => {
    expect(occurrences(r, '2026-05-01')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('weekly', () => {
    expect(occurrences({ ...r, frequency: 'weekly', startDate: '2026-09-01' }, '2026-09-20')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15',
    ]);
  });
  it('set dates + after', () => {
    expect(
      occurrences({ ...r, frequency: 'dates', dates: ['2026-10-01', '2026-06-01', '2026-03-01'] }, '2026-09-30', '2026-03-01'),
    ).toEqual(['2026-06-01']);
  });
  it('dueExpenses is idempotent via generatedUntil and ids', () => {
    const first = dueExpenses(r, '2026-03-15', () => false, 'tom');
    expect(first.expenses.map((e) => e.date)).toEqual(['2026-01-31', '2026-02-28']);
    const second = dueExpenses({ ...r, generatedUntil: first.generatedUntil }, '2026-03-15', () => false, 'tom');
    expect(second.expenses).toHaveLength(0);
    const ids = new Set(first.expenses.map((e) => e.id));
    expect(dueExpenses(r, '2026-03-15', (id) => ids.has(id), 'tom').expenses).toHaveLength(0);
  });
});

describe('categories', () => {
  it('guesses from keywords', () => {
    expect(guessCategory('Tesco big shop')).toBe('groceries');
    expect(guessCategory('Council tax')).toBe('bills');
    expect(guessCategory('Ryanair flights to Madrid')).toBe('travel');
    expect(guessCategory('Car rental in Spain')).toBe(null);
    expect(guessCategory('Gastropub')).toBe(null);
    expect(guessCategory('Netflix')).toBe('entertainment');
    expect(guessCategory('Mortgage')).toBe('mortgage');
    expect(guessCategory('Dinner at Dishoom')).toBe('eating-out');
  });
  it('learned rule wins', () => {
    expect(guessCategory('Tesco', learnRule('Tesco', 'home'))).toBe('home');
  });
});

describe('receipt parsing', () => {
  const text = `TESCO
Express Camden
MILK SEMI SKIMMED 2PT   1.45
SOURDOUGH LOAF  £2.80
BANANAS LOOSE 0.92 A
CLUBCARD PRICE  -0.50
RED WINE MALBEC 8,50
SUBTOTAL 13.17
TOTAL   13.17
VISA CONTACTLESS 13.17
CHANGE 0.00
12/09/2026 14:32`;
  it('extracts items, discounts and printed total', () => {
    const r = parseReceiptText(text);
    expect(r.merchant).toBe('Tesco');
    expect(r.items.map((i) => [i.name, i.price])).toEqual([
      ['Milk Semi Skimmed 2pt', 1.45],
      ['Sourdough Loaf', 2.8],
      ['Bananas Loose', 0.92],
      ['Clubcard Price', -0.5],
      ['Red Wine Malbec', 8.5],
    ]);
    expect(r.printedTotal).toBe(13.17);
  });
  it('totals by owner', () => {
    const r = parseReceiptText(text);
    r.items[4].owner = 'tom';
    r.items[0].owner = 'nuria';
    const t = receiptTotals(r.items);
    expect(t.total).toBe(13.17);
    expect(t.tomShare).toBeCloseTo(8.5 + (2.8 + 0.92 - 0.5) / 2);
    expect(t.tomShare + t.nuriaShare).toBeCloseTo(13.17);
  });
});

describe('splitwise import', () => {
  const csv = `Date,Description,Category,Cost,Currency,Tom Marriott,Nuria Garcia

2026-01-02,Tesco,Groceries,40.00,GBP,20.00,-20.00
2026-01-03,Flights,Plane,300.00,EUR,-150.00,150.00
2026-01-04,Settle,Payment,20.00,GBP,-20.00,20.00
2026-01-05,Tom's shoes,Clothing,60.00,GBP,-60.00,60.00

2026-01-05,Total balance, , ,GBP,-210.00,210.00`;
  it('maps rows to expenses and payments', () => {
    const r = parseSplitwise(csv, 0);
    expect(r.people).toEqual(['Tom Marriott', 'Nuria Garcia']);
    expect(r.expenses).toHaveLength(3);
    expect(r.expenses[0]).toMatchObject({ paidBy: 'tom', split: 'equal', category: 'groceries' });
    expect(r.expenses[1]).toMatchObject({ paidBy: 'nuria', split: 'equal', currency: 'EUR', category: 'travel' });
    expect(r.expenses[2]).toMatchObject({ paidBy: 'nuria', split: 'tom', category: 'shopping' });
    expect(r.settlements[0]).toMatchObject({ from: 'nuria', to: 'tom', amount: 20 });
    const b = balance(r.expenses.map((e) => ({ ...e, rate: 1, updatedAt: 1 })), r.settlements.map((s) => ({ ...s, rate: 1, updatedAt: 1 })));
    expect(b).toBe(-210);
  });
});

describe('nextOccurrence', () => {
  it('skips dates already generated', async () => {
    const { nextOccurrence } = await import('./recurring');
    const r = { id: 'x', kind: 'recurring', description: '', category: 'other', amount: 1, currency: 'GBP', paidBy: 'tom', split: 'equal', tomPct: 50,
      frequency: 'monthly', startDate: '2026-09-27', generatedUntil: '2026-09-27', updatedAt: 1 } as const;
    expect(nextOccurrence(r as never, '2026-09-27')).toBe('2026-10-27');
  });
});
