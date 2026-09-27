/**
 * Import a Splitwise group export (Group → Settings → Export as spreadsheet → CSV).
 * Columns: Date, Description, Category, Cost, Currency, <Person A>, <Person B>
 * The person columns are each row's net effect: positive = that person is owed.
 */
import type { Entry, Expense, Person, Settlement } from './types';
import { guessCategory } from './categories';
import { fnv1a, round2, toPence } from './money';

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
  const seen = new Map<string, number>();
  /** Id from the row's content, so the same row gets the same id in any later export. */
  const idFor = (row: KeyFields) => {
    const key = importKey(row);
    const n = (seen.get(key) ?? 0) + 1; // identical rows (two £3 coffees on one day) are #1, #2…
    seen.set(key, n);
    return `sw_${fnv1a(key).toString(36)}${fnv1a(`#${key}`).toString(36)}_${n}`;
  };

  for (const r of rows.slice(headerRow + 1)) {
    const date = toISODate(r[iDate] ?? '');
    if (!date || /total balance/i.test(r[iDesc] ?? '')) continue; // skips the summary row
    const cost = toNum(r[iCost]);
    const tom = toNum(r[tomIdx]);
    if (!Number.isFinite(cost) || !Number.isFinite(tom)) continue;
    const currency = ((iCur >= 0 ? r[iCur] : '') || 'GBP').trim().toUpperCase();
    const description = (r[iDesc] ?? '').trim();
    const swCat = iCat >= 0 ? (r[iCat] ?? '').trim() : '';

    if (/^payment$/i.test(swCat)) {
      // The payer is shown as owed (+) because paying reduces what they owe.
      const from: Person = tom > 0 ? 'tom' : 'nuria';
      const s: Omit<Settlement, 'id' | 'rate' | 'updatedAt'> = {
        kind: 'settlement', date, from, to: from === 'tom' ? 'nuria' : 'tom',
        amount: round2(Math.abs(tom || cost)), currency, note: description || 'Imported from Splitwise',
      };
      settlements.push({ ...s, id: idFor(s) });
      continue;
    }

    const paidBy: Person = tom >= 0 ? 'tom' : 'nuria';
    const tomShare = tom >= 0 ? cost - tom : -tom;
    const tomPct = cost ? Math.min(100, Math.max(0, (tomShare / cost) * 100)) : 50;
    const split = Math.abs(tomPct - 50) < 0.01 ? 'equal' : tomPct >= 99.99 ? 'tom' : tomPct <= 0.01 ? 'nuria' : 'custom';
    const category = SW_CATEGORIES.find(([re]) => re.test(swCat))?.[1] ?? guessCategory(description) ?? 'other';
    const e: Omit<Expense, 'id' | 'rate' | 'updatedAt'> = {
      kind: 'expense', date, description: description || swCat || 'Expense', category,
      amount: round2(cost), currency, paidBy, split, tomPct,
    };
    expenses.push({ ...e, id: idFor(e) });
  }
  return { people, expenses, settlements };
}

type ImportedRow = SplitwiseImport['expenses'][number] | SplitwiseImport['settlements'][number];

type KeyFields = Pick<Expense, 'date' | 'amount' | 'currency'> &
  ({ kind: 'expense'; description: string } | { kind: 'settlement'; note?: string });

/**
 * What identifies a Splitwise row from one export to the next. Splitwise's CSV has no row ids,
 * so this is the row's content: kind, date, description, amount and currency. Who paid isn't
 * included, so choosing a different column for Tom doesn't change it.
 */
export function importKey(e: KeyFields): string {
  const text = e.kind === 'expense' ? e.description : e.note ?? '';
  return [e.kind, e.date, text.trim().toLowerCase(), toPence(e.amount), e.currency].join('|');
}

/** Ids from before ids were content-based (row number + date); matched by content instead. */
const LEGACY_ID = /^sw\d{13}$/;

export interface ImportPlan {
  /** rows not yet in Billsplit */
  add: ImportedRow[];
  /** rows already imported (whether since edited or deleted in Billsplit, which is kept) */
  already: number;
  /** earlier-imported entries, still in the ledger, that this file doesn't have — probably edited or deleted in Splitwise */
  notInFile: (Expense | Settlement)[];
}

/**
 * Work out what importing an export would do, given everything in the ledger (including deleted
 * entries). Only new rows are added: anything imported before is left as it is in Billsplit.
 */
export function planSplitwiseImport(parsed: SplitwiseImport, ledger: Iterable<Entry>): ImportPlan {
  const ids = new Set<string>();
  const imported: (Expense | Settlement)[] = [];
  const legacy = new Map<string, (Expense | Settlement)[]>();
  for (const e of ledger) {
    ids.add(e.id);
    if ((e.kind !== 'expense' && e.kind !== 'settlement') || !e.id.startsWith('sw')) continue;
    imported.push(e);
    if (LEGACY_ID.test(e.id)) {
      const k = importKey(e);
      legacy.set(k, [...(legacy.get(k) ?? []), e]);
    }
  }

  const matched = new Set<string>();
  const add: ImportedRow[] = [];
  for (const row of [...parsed.expenses, ...parsed.settlements]) {
    if (ids.has(row.id)) {
      matched.add(row.id);
      continue;
    }
    const old = legacy.get(importKey(row))?.shift();
    if (old) matched.add(old.id);
    else add.push(row);
  }
  return {
    add,
    already: matched.size,
    notInFile: imported.filter((e) => !e.deleted && !matched.has(e.id)),
  };
}
