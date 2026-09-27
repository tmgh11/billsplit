/**
 * Import a Splitwise group export (Group → Settings → Export as spreadsheet → CSV).
 * Columns: Date, Description, Category, Cost, Currency, <Person A>, <Person B>
 * The person columns are each row's net effect: positive = that person is owed.
 */
import type { Expense, Person, Settlement } from './types';
import { guessCategory } from './categories';
import { round2 } from './money';

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const SW_CATEGORIES: [RegExp, string][] = [
  [/groceries/i, 'groceries'],
  [/dining|food and drink|liquor/i, 'eating-out'],
  [/rent|mortgage/i, 'mortgage'],
  [/electric|heat|gas\b|water|tv|phone|internet|insurance|utilities|cleaning/i, 'bills'],
  [/car|fuel|parking|taxi|bus|train|bicycle|transportation/i, 'transport'],
  [/hotel|plane|travel/i, 'travel'],
  [/movies|music|games|sports|entertainment/i, 'entertainment'],
  [/household|furniture|maintenance|home|electronics|pets|services/i, 'home'],
  [/clothing/i, 'shopping'],
  [/medical|health/i, 'health'],
  [/gifts/i, 'gifts'],
];

export interface SplitwiseImport {
  people: string[];
  expenses: Omit<Expense, 'rate' | 'updatedAt'>[];
  settlements: Omit<Settlement, 'rate' | 'updatedAt'>[];
}

export function parseSplitwise(text: string, tomColumn: 0 | 1 = 0): SplitwiseImport {
  const rows = parseCSV(text);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const iDate = header.findIndex((h) => /^date$/i.test(h));
  const iDesc = header.findIndex((h) => /^description$/i.test(h));
  const iCat = header.findIndex((h) => /^category$/i.test(h));
  const iCost = header.findIndex((h) => /^cost$/i.test(h));
  const iCur = header.findIndex((h) => /^currency$/i.test(h));
  if ([iDate, iDesc, iCost, iCur].some((i) => i < 0)) throw new Error('This does not look like a Splitwise CSV export');
  const personCols = header.map((_, i) => i).filter((i) => i > iCur && header[i]);
  if (personCols.length !== 2) throw new Error(`Expected 2 people in the export, found ${personCols.length}`);
  const people = personCols.map((i) => header[i]);
  const tomIdx = personCols[tomColumn];

  const expenses: SplitwiseImport['expenses'] = [];
  const settlements: SplitwiseImport['settlements'] = [];
  let n = 0;

  for (const r of rows.slice(1)) {
    const date = (r[iDate] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue; // skips "Total balance" etc.
    const cost = parseFloat(r[iCost]);
    const tom = parseFloat(r[tomIdx]);
    if (!Number.isFinite(cost) || !Number.isFinite(tom)) continue;
    const currency = (r[iCur] || 'GBP').trim().toUpperCase();
    const description = (r[iDesc] ?? '').trim();
    const swCat = iCat >= 0 ? (r[iCat] ?? '').trim() : '';
    const id = `sw${String(++n).padStart(5, '0')}${date.replace(/-/g, '')}`;

    if (/^payment$/i.test(swCat)) {
      // The payer is shown as owed (+) because paying reduces what they owe.
      const from: Person = tom > 0 ? 'tom' : 'nuria';
      settlements.push({
        id, kind: 'settlement', date: date.slice(0, 10), from, to: from === 'tom' ? 'nuria' : 'tom',
        amount: round2(Math.abs(tom || cost)), currency, note: description || 'Imported from Splitwise',
      });
      continue;
    }

    const paidBy: Person = tom >= 0 ? 'tom' : 'nuria';
    const tomShare = tom >= 0 ? cost - tom : -tom;
    const tomPct = cost ? Math.min(100, Math.max(0, (tomShare / cost) * 100)) : 50;
    const split = Math.abs(tomPct - 50) < 0.01 ? 'equal' : tomPct >= 99.99 ? 'tom' : tomPct <= 0.01 ? 'nuria' : 'custom';
    const category = SW_CATEGORIES.find(([re]) => re.test(swCat))?.[1] ?? guessCategory(description) ?? 'other';
    expenses.push({
      id, kind: 'expense', date: date.slice(0, 10), description: description || swCat || 'Expense', category,
      amount: round2(cost), currency, paidBy, split, tomPct,
    });
  }
  return { people, expenses, settlements };
}
