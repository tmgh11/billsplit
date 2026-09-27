/**
 * Import a Splitwise group export (Group → Settings → Export as spreadsheet → CSV).
 * Columns: Date, Description, Category, Cost, Currency, <Person A>, <Person B>
 * The person columns are each row's net effect: positive = that person is owed.
 */
import type { Expense, Person, Settlement } from './types';
import { guessCategory } from './categories';
import { round2 } from './money';

export function parseCSV(text: string, delimiter = ','): string[][] {
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
    else if (c === delimiter) {
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

/** Accepts Splitwise's YYYY-MM-DD, or DD/MM/YYYY if the file was re-saved from Excel/Sheets. */
function toISODate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function toNum(raw: string | undefined): number {
  if (raw == null) return NaN;
  let s = raw.trim().replace(/[£€$\s]/g, '');
  if (/,\d{1,2}$/.test(s) && !s.includes('.')) s = s.replace(',', '.'); // "12,50"
  return parseFloat(s.replace(/,/g, ''));
}

export function parseSplitwise(text: string, tomColumn: 0 | 1 = 0): SplitwiseImport {
  // Splitwise starts its CSV with an invisible byte-order mark; files re-saved elsewhere may use ; or tabs
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.search(/\r?\n/) >>> 0 || 500);
  const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = parseCSV(clean, delimiter);
  const norm = (h: string) => h.replace(/﻿/g, '').trim().toLowerCase();
  const headerRow = rows.slice(0, 10).findIndex((r) => r.some((c) => norm(c) === 'date') && r.some((c) => /^(cost|amount)$/.test(norm(c))));
  const header = (rows[headerRow] ?? rows[0] ?? []).map((h) => h.replace(/﻿/g, '').trim());
  const find = (re: RegExp) => header.findIndex((h) => re.test(norm(h)));
  const iDate = find(/^date$/);
  const iDesc = find(/^description$/);
  const iCat = find(/^category$/);
  const iCost = find(/^(cost|amount)$/);
  const iCur = find(/^currency$/);
  if (headerRow < 0 || [iDate, iDesc, iCost].some((i) => i < 0)) {
    const seen = header.filter(Boolean).slice(0, 7).join(', ') || 'nothing readable';
    throw new Error(`This doesn’t look like a Splitwise export – expected Date, Description, Cost… columns but found: ${seen}`);
  }
  const lastFixed = Math.max(iDate, iDesc, iCat, iCost, iCur);
  const personCols = header.map((_, i) => i).filter((i) => i > lastFixed && header[i]);
  if (personCols.length !== 2) {
    throw new Error(`Expected 2 people in the export, found ${personCols.length}: ${personCols.map((i) => header[i]).join(', ')}`);
  }
  const people = personCols.map((i) => header[i]);
  const tomIdx = personCols[tomColumn];

  const expenses: SplitwiseImport['expenses'] = [];
  const settlements: SplitwiseImport['settlements'] = [];
  let n = 0;

  for (const r of rows.slice(headerRow + 1)) {
    const date = toISODate(r[iDate] ?? '');
    if (!date || /total balance/i.test(r[iDesc] ?? '')) continue; // skips the summary row
    const cost = toNum(r[iCost]);
    const tom = toNum(r[tomIdx]);
    if (!Number.isFinite(cost) || !Number.isFinite(tom)) continue;
    const currency = ((iCur >= 0 ? r[iCur] : '') || 'GBP').trim().toUpperCase();
    const description = (r[iDesc] ?? '').trim();
    const swCat = iCat >= 0 ? (r[iCat] ?? '').trim() : '';
    const id = `sw${String(++n).padStart(5, '0')}${date.replace(/-/g, '')}`;

    if (/^payment$/i.test(swCat)) {
      // The payer is shown as owed (+) because paying reduces what they owe.
      const from: Person = tom > 0 ? 'tom' : 'nuria';
      settlements.push({
        id, kind: 'settlement', date, from, to: from === 'tom' ? 'nuria' : 'tom',
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
      id, kind: 'expense', date, description: description || swCat || 'Expense', category,
      amount: round2(cost), currency, paidBy, split, tomPct,
    });
  }
  return { people, expenses, settlements };
}
