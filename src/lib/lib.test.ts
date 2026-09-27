import { describe, expect, it } from 'vitest';
import { balance, describeBalance, parseMoney, shares } from './money';
import { occurrences, dueExpenses } from './recurring';
import { guessCategory, learnRule } from './categories';
import { mergeParts, parseReceiptText, receiptTotals, totalsMatch } from './receipt';
import { parseSplitwise } from './splitwise';
import { rewindTimestamp } from './dates';
import { mergeLegacy } from './persist';
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
  it('extracts items, folds a discount into its item, reads the printed total', () => {
    const r = parseReceiptText(text);
    expect(r.merchant).toBe('Tesco');
    expect(r.items.map((i) => [i.name, i.price])).toEqual([
      ['Milk Semi Skimmed 2pt', 1.45],
      ['Sourdough Loaf', 2.8],
      ['Bananas Loose', 0.42],
      ['Red Wine Malbec', 8.5],
    ]);
    expect(r.printedTotal).toBe(13.17);
    expect(totalsMatch(r)).toBe(true);
  });
  it('totals by owner', () => {
    const r = parseReceiptText(text);
    r.items[3].owner = 'tom';
    r.items[0].owner = 'nuria';
    const t = receiptTotals(r.items);
    expect(t.total).toBe(13.17);
    expect(t.tomShare).toBeCloseTo(8.5 + (2.8 + 0.42) / 2);
    expect(t.tomShare + t.nuriaShare).toBeCloseTo(13.17);
  });

  it('ASDA: ignores tax summary, card slip and header noise', () => {
    const asda = `ASDA
ASDA STORES LTD
WWW.ASDA.COM
MANAGER JONATHAN SORRELL
Al - Oxford,
ST. 4442 OP. 44420366 TE. 70 TR. 7685
GH Throw £5.50
HAND TOWEL £3.00
TOTAL: £8.50
NO. ITEMS SOLD 2
CARD £8.50
TAX SUMMARY
RATE NET VAT
20.00% 7.08 1.42
TAX TOTAL: 1.42
AID: A0000000041010
MASTERCARD`;
    const r = parseReceiptText(asda.replace('HAND TOWEL', 'ro HAND TOWEL'));
    expect(r.merchant).toBe('ASDA');
    expect(r.items.map((i) => [i.name, i.price])).toEqual([['GH Throw', 5.5], ['Hand Towel', 3]]);
    expect(r.printedTotal).toBe(8.5);
    expect(totalsMatch(r)).toBe(true);
  });

  it('Pets at Home: barcodes, per-item discounts, "1 @" lines, basket saving after subtotal', () => {
    const pets = `VAT Identification Number: GB 616 43 17 54
SALE
Pets Club No.: 1097
***STD 3 FOR £3***
5998749122228 DREAMIES TUNA 60G £1.69
Discount: -£0.69
Coupon 5054693135742
5998749116500 DREAMIES DUCK 60 £1.69
Discount: -£0.69
Coupon 5054693135742
4008429037962 DREAMIES 60G SAL £1.69
Discount: -£0.69
Coupon 5054693135742
Package Price: £3.00
5063179020281 PAH Reflective Wing £3.00
1 @ £3.00
Coupon 5054693135742
5038124247570 Cute Corn And Carro £2.00
1 @ £2.00
5038124293577 Pah Woollen Ball £2.30
1 @ £2.30
5063179045505 Pah Shrimp Cat Toy £3.00
1 @ £3.00
5038124801069 Brown Cat Blanket £4.00
1 @ £4.00
5063179038910 Pah Hw Spider Teaser £4.00
1 @ £4.00
**Pets Card Swiped**
Subtotal £21.30
CLB SAVE 10% -£2.13
Total £19.17
You saved £2.07 today with Pets Club.
You saved £4.20
MasterCard £19.17`;
    const r = parseReceiptText(pets);
    expect(r.merchant).toBe('Pets at Home');
    expect(r.items.map((i) => [i.name, i.price])).toEqual([
      ['Dreamies Tuna 60g', 1],
      ['Dreamies Duck 60', 1],
      ['Dreamies 60g Sal', 1],
      ['PAH Reflective Wing', 3],
      ['Cute Corn And Carro', 2],
      ['Pah Woollen Ball', 2.3],
      ['Pah Shrimp Cat Toy', 3],
      ['Brown Cat Blanket', 4],
      ['Pah Hw Spider Teaser', 4],
    ]);
    expect(r.basketDiscount).toBe(-2.13);
    expect(r.printedTotal).toBe(19.17);
    expect(totalsMatch(r)).toBe(true);
    // 10% club saving comes off each person's share in proportion
    r.items[7].owner = 'tom'; // £4 blanket
    const t = receiptTotals(r.items, r.basketDiscount);
    expect(t.total).toBe(19.17);
    expect(t.tomShare + t.nuriaShare).toBeCloseTo(19.17);
    expect(Math.abs(t.tomShare - (4 + 17.3 / 2) * (19.17 / 21.3))).toBeLessThan(0.006); // rounded to the penny
  });

  it('tolerates OCR letter/digit swaps in prices', () => {
    const r = parseReceiptText('SPINACH 200G 1.4O\nRED ONIONS O.89\nTOTAL 2.29');
    expect(r.items.map((i) => i.price)).toEqual([1.4, 0.89]);
  });
});

describe('joining photos of a long receipt', () => {
  const it_ = (name: string, price: number) => ({ id: name, name, price, owner: 'shared' as const });
  const A = ['Milk', 'Bread', 'Eggs', 'Cheese', 'Wine', 'Shaving Gel'].map((n, i) => it_(n, i + 1));
  it('drops the overlapping lines (with OCR noise on the repeats)', () => {
    const B = [it_('Chese', 4), it_('Wine', 5), it_('Shaving Gel', 6), it_('Toothpaste', 7), it_('Pesto', 8)];
    const m = mergeParts(A, B);
    expect(m.overlapFound).toBe(true);
    expect(m.items.map((i) => i.name)).toEqual(['Milk', 'Bread', 'Eggs', 'Cheese', 'Wine', 'Shaving Gel', 'Toothpaste', 'Pesto']);
  });
  it('handles a half-cut first line in the new photo', () => {
    const B = [it_('~~ ~', 0.5), it_('Wine', 5), it_('Shaving Gel', 6), it_('Pesto', 8)];
    expect(mergeParts(A, B).items.map((i) => i.name)).toEqual(['Milk', 'Bread', 'Eggs', 'Cheese', 'Wine', 'Shaving Gel', 'Pesto']);
  });
  it('replaces a half-cut last line of the previous photo', () => {
    const A2 = [...A.slice(0, 5), it_('Shav', 0.6)];
    const B = [it_('Cheese', 4), it_('Wine', 5), it_('Shaving Gel', 6), it_('Pesto', 8)];
    expect(mergeParts(A2, B).items.map((i) => i.name)).toEqual(['Milk', 'Bread', 'Eggs', 'Cheese', 'Wine', 'Shaving Gel', 'Pesto']);
  });
  it('just appends when there is no overlap', () => {
    const m = mergeParts(A, [it_('Pesto', 8)]);
    expect(m.overlapFound).toBe(false);
    expect(m.items).toHaveLength(7);
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

describe('total cross-checks', () => {
  it('uses the card payment line when the bold TOTAL is misread', () => {
    const r = parseReceiptText('WINE 7.00\nCHEESE 3.50\nTOTAL 0.50\nVISA CONTACTLESS 10.50');
    expect(r.printedTotal).toBe(10.5);
    expect(totalsMatch(r)).toBe(true);
  });
  it('ignores OCR-mangled subtotal lines', () => {
    const r = parseReceiptText('WINE 7.00\nJ Subtotil 7.00\nT0TAL 7.00');
    expect(r.items.map((i) => i.name)).toEqual(['Wine']);
    expect(r.printedTotal).toBe(7);
  });
  it('drops an impossible total rather than raising a false warning', () => {
    const r = parseReceiptText('WINE 7.00\nCHEESE 3.50\nTOTAL 0.50');
    expect(r.printedTotal).toBe(null);
  });
});

describe('splitwise import – real-world file quirks', () => {
  const csv = `Date,Description,Category,Cost,Currency,Tom Marriott,Nuria Garcia
2026-01-02,Tesco,Groceries,40.00,GBP,20.00,-20.00
2026-01-05,Total balance, , ,GBP,20.00,-20.00`;
  it('handles the byte-order mark Splitwise puts at the start', () => {
    const r = parseSplitwise('﻿' + csv);
    expect(r.expenses).toHaveLength(1);
    expect(r.people).toEqual(['Tom Marriott', 'Nuria Garcia']);
  });
  it('handles a file re-saved with semicolons and UK dates', () => {
    const semi = `Date;Description;Category;Cost;Currency;Tom;Nuria\r\n02/01/2026;Tesco;Groceries;40,00;GBP;20,00;-20,00\r\n`;
    const r = parseSplitwise(semi);
    expect(r.expenses[0]).toMatchObject({ date: '2026-01-02', amount: 40, paidBy: 'tom', split: 'equal' });
  });
  it('explains what it found when the columns are wrong', () => {
    expect(() => parseSplitwise('Name,Email\nx,y')).toThrow(/found: Name, Email/);
  });
});

describe('splitwise placeholder file', () => {
  it('recognises the "we will email you" placeholder', () => {
    expect(() => parseSplitwise("We'll send you an email with your expense spreadsheet as soon as it's ready.")).toThrow(/email/);
  });
});

describe('sync cursor', () => {
  it('rewinds Postgres timestamps, whatever their fractional digits', () => {
    expect(rewindTimestamp('2026-09-27T20:01:02.123456+00:00', 60_000)).toBe('2026-09-27T20:00:02.123Z');
    expect(rewindTimestamp('2026-09-27T20:01:02.1+00:00', 1000)).toBe('2026-09-27T20:01:01.100Z');
    expect(rewindTimestamp('2026-09-27T20:01:02+00:00', 0)).toBe('2026-09-27T20:01:02.000Z');
    expect(rewindTimestamp('not a time', 0)).toBeNull();
  });
});

describe('storage fallback', () => {
  it('keeps the newer copy of each entry, unions the unsynced ids and drops the cursor', () => {
    const a1 = exp({ id: 'a', amount: 10, updatedAt: 1 });
    const a2 = exp({ id: 'a', amount: 20, updatedAt: 2 });
    const b1 = exp({ id: 'b', updatedAt: 5 });
    const b0 = exp({ id: 'b', updatedAt: 4 });
    const c = exp({ id: 'c', updatedAt: 1 });
    const m = mergeLegacy([a1, b1], ['a'], { entries: [a2, b0, c], dirty: ['c'] });
    expect(Object.fromEntries(m.entries.map((e) => [e.id, e.updatedAt]))).toEqual({ a: 2, b: 5, c: 1 });
    expect(m.newer.map((e) => e.id)).toEqual(['a', 'c']);
    expect(m.dirty.sort()).toEqual(['a', 'c']);
    expect(m.cursor).toBeNull();
  });
});
