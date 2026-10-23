export type Person = 'tom' | 'nuria';
export const PEOPLE: Person[] = ['tom', 'nuria'];
export const other = (p: Person): Person => (p === 'tom' ? 'nuria' : 'tom');

/** Who the cost belongs to. 'equal' = 50/50, 'tom'/'nuria' = entirely theirs, 'custom' = tomPct. */
export type SplitMode = 'equal' | 'tom' | 'nuria' | 'custom';

/** Whose a receipt item is. 'custom' splits it by the item's own tomPct (e.g. 70/30). */
export type Owner = 'tom' | 'nuria' | 'shared' | 'custom';

export interface ReceiptItem {
  id: string;
  name: string;
  price: number;
  owner: Owner;
  /** Tom's share of this item (0–100), for owner 'custom' */
  tomPct?: number;
}

interface Base {
  id: string;
  /** client timestamp (ms) of last edit – used for last-write-wins merging */
  updatedAt: number;
  deleted?: boolean;
}

export interface Expense extends Base {
  kind: 'expense';
  date: string; // YYYY-MM-DD
  description: string;
  category: string;
  amount: number; // in `currency`
  currency: string;
  rate: number; // ledger (base) currency per 1 unit of `currency`
  paidBy: Person;
  split: SplitMode;
  tomPct: number; // share of the cost that is Tom's (0–100). Derived for non-custom splits.
  items?: ReceiptItem[];
  recurringId?: string;
  note?: string;
  createdBy?: Person;
}

export interface Settlement extends Base {
  kind: 'settlement';
  date: string;
  from: Person;
  to: Person;
  amount: number;
  currency: string;
  rate: number;
  note?: string;
  createdBy?: Person;
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'yearly' | 'dates';

export interface Recurring extends Base {
  kind: 'recurring';
  description: string;
  category: string;
  amount: number;
  currency: string;
  paidBy: Person;
  split: SplitMode;
  tomPct: number;
  frequency: Frequency;
  startDate: string; // first occurrence; weekly/monthly/yearly anchor on this date
  dates?: string[]; // for 'dates' frequency: explicit YYYY-MM-DD list
  endDate?: string;
  paused?: boolean;
  /**
   * Occurrences on or before this date are never added. Only changed when a person saves, adds or
   * resumes the template (never by automatic adding, so it can't overwrite the other phone's edits).
   */
  generatedUntil?: string;
}

/**
 * How a direct debit is shared. 'income' follows the ratio of the two salaries in Settings, so it
 * moves when a salary is updated; 'custom' is a fixed tomPct (e.g. a 70/30 mortgage).
 */
export type DebitSplit = 'income' | 'equal' | 'custom';
export type DebitPeriod = 'monthly' | 'yearly';

/**
 * A household bill paid by direct debit from one person's account. Kept apart from the ledger:
 * nothing is ever added to the balance. It only works out what each of you transfers each month.
 */
export interface DirectDebit extends Base {
  kind: 'debit';
  description: string;
  category: string;
  /** per `period`; yearly amounts are shown and shared per month (÷ 12) */
  amount: number;
  period: DebitPeriod;
  /** whose name (and bank account) the bill is in */
  paidBy: Person;
  split: DebitSplit;
  /** Tom's share (0–100) for 'custom'; ignored otherwise */
  tomPct: number;
  /** day of the month it goes out (1–31), if known */
  dueDay?: number;
  /** when the contract or deal ends, if known (YYYY-MM-DD) */
  endDate?: string;
  note?: string;
}

export interface Settings extends Base {
  kind: 'settings';
  names: Record<Person, string>;
  baseCurrency: string;
  /** learned description → category overrides */
  categoryRules: Record<string, string>;
  /** one-tap descriptions offered in Add expense (edited in Settings) */
  shortcuts: string[];
  /** annual salaries (pre-tax), for direct debits split by income */
  salaries?: Partial<Record<Person, number>>;
  /** when the salaries were last changed (YYYY-MM-DD) */
  salariesUpdated?: string;
}

export type Entry = Expense | Settlement | Recurring | DirectDebit | Settings;

export const SETTINGS_ID = 'settings';

export const DEFAULT_SHORTCUTS = ['Tesco', 'M&S', 'Sainsbury’s', 'Amazon'];
/** keeps the four shortcut buttons on one line on a phone (the Settings preview checks it) */
export const SHORTCUT_MAX_LENGTH = 12;

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    kind: 'settings',
    names: { tom: 'Tom', nuria: 'Nuria' },
    baseCurrency: 'GBP',
    categoryRules: {},
    shortcuts: DEFAULT_SHORTCUTS,
    updatedAt: 0,
  };
}
