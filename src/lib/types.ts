export type Person = 'tom' | 'nuria';
export const PEOPLE: Person[] = ['tom', 'nuria'];
export const other = (p: Person): Person => (p === 'tom' ? 'nuria' : 'tom');

/** Who the cost belongs to. 'equal' = 50/50, 'tom'/'nuria' = entirely theirs, 'custom' = tomPct. */
export type SplitMode = 'equal' | 'tom' | 'nuria' | 'custom';

export type Owner = 'tom' | 'nuria' | 'shared';

export interface ReceiptItem {
  id: string;
  name: string;
  price: number;
  owner: Owner;
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
  /** last occurrence date already written to the ledger */
  generatedUntil?: string;
}

export interface Settings extends Base {
  kind: 'settings';
  names: Record<Person, string>;
  baseCurrency: string;
  /** learned description → category overrides */
  categoryRules: Record<string, string>;
}

export type Entry = Expense | Settlement | Recurring | Settings;

export const SETTINGS_ID = 'settings';

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    kind: 'settings',
    names: { tom: 'Tom', nuria: 'Nuria' },
    baseCurrency: 'GBP',
    categoryRules: {},
    updatedAt: 0,
  };
}
