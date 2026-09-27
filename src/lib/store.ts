/**
 * Local-first store. Everything lives in localStorage on the phone so the app opens instantly
 * and works offline; changes are queued ("dirty") and pushed to Supabase when possible.
 * Conflicts resolve last-write-wins on each entry's `updatedAt`.
 */
import { useSyncExternalStore } from 'react';
import type { Entry, Expense, Person, Recurring, Settings, Settlement } from './types';
import { SETTINGS_ID, defaultSettings } from './types';
import { today } from './dates';
import { dueExpenses } from './recurring';
import { rateToBase } from './fx';

const K = {
  entries: 'billsplit.entries',
  dirty: 'billsplit.dirty',
  device: 'billsplit.device',
};

export type SyncState = 'local' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface DeviceSettings {
  me: Person;
  supabaseUrl?: string;
  supabaseKey?: string;
  onboarded?: boolean;
}

export interface Snapshot {
  expenses: Expense[];
  settlements: Settlement[];
  recurring: Recurring[];
  settings: Settings;
  device: DeviceSettings;
  sync: { state: SyncState; message?: string; lastSynced?: number; email?: string };
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save', key, e);
  }
}

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);

type Listener = () => void;

class Store {
  private entries = new Map<string, Entry>(Object.entries(load<Record<string, Entry>>(K.entries, {})));
  private dirty = new Set<string>(load<string[]>(K.dirty, []));
  private device: DeviceSettings = load<DeviceSettings>(K.device, { me: 'tom' });
  private syncInfo: Snapshot['sync'] = { state: 'local' };
  private listeners = new Set<Listener>();
  private snap: Snapshot | null = null;
  private persistTimer: number | undefined;
  /** set by the sync module */
  onDirty: (() => void) | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): Snapshot => {
    if (this.snap) return this.snap;
    const expenses: Expense[] = [];
    const settlements: Settlement[] = [];
    const recurring: Recurring[] = [];
    let settings = defaultSettings();
    for (const e of this.entries.values()) {
      if (e.kind === 'settings') settings = { ...defaultSettings(), ...e };
      else if (e.deleted) continue;
      else if (e.kind === 'expense') expenses.push(e);
      else if (e.kind === 'settlement') settlements.push(e);
      else if (e.kind === 'recurring') recurring.push(e);
    }
    const byDate = (a: { date: string; updatedAt: number }, b: { date: string; updatedAt: number }) =>
      b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt;
    expenses.sort(byDate);
    settlements.sort(byDate);
    recurring.sort((a, b) => a.description.localeCompare(b.description));
    this.snap = { expenses, settlements, recurring, settings, device: this.device, sync: this.syncInfo };
    return this.snap;
  };

  private changed(persist = true) {
    this.snap = null;
    if (persist) {
      clearTimeout(this.persistTimer);
      this.persistTimer = window.setTimeout(() => {
        save(K.entries, Object.fromEntries(this.entries));
        save(K.dirty, [...this.dirty]);
      }, 50);
    }
    this.listeners.forEach((l) => l());
  }

  flush() {
    clearTimeout(this.persistTimer);
    save(K.entries, Object.fromEntries(this.entries));
    save(K.dirty, [...this.dirty]);
  }

  get(id: string) {
    return this.entries.get(id);
  }
  has(id: string) {
    return this.entries.has(id);
  }
  all() {
    return [...this.entries.values()];
  }
  settings(): Settings {
    return this.getSnapshot().settings;
  }

  put(...list: Entry[]) {
    const now = Date.now();
    for (const e of list) {
      const stamped = { ...e, updatedAt: Math.max(now, (this.entries.get(e.id)?.updatedAt ?? 0) + 1) } as Entry;
      this.entries.set(e.id, stamped);
      this.dirty.add(e.id);
    }
    this.changed();
    this.onDirty?.();
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (e) this.put({ ...e, deleted: true });
  }

  updateSettings(patch: Partial<Settings>) {
    this.put({ ...this.settings(), ...patch, id: SETTINGS_ID, kind: 'settings' });
  }

  /** Apply entries from the server. Returns true if anything changed. */
  merge(remote: Entry[]): boolean {
    let changed = false;
    for (const r of remote) {
      const local = this.entries.get(r.id);
      if (!local || r.updatedAt > local.updatedAt) {
        this.entries.set(r.id, r);
        this.dirty.delete(r.id);
        changed = true;
      } else if (r.updatedAt === local.updatedAt) {
        this.dirty.delete(r.id);
      }
    }
    if (changed) this.changed();
    return changed;
  }

  dirtyEntries(): Entry[] {
    return [...this.dirty].map((id) => this.entries.get(id)).filter(Boolean) as Entry[];
  }
  markClean(ids: string[], pushed: Map<string, number>) {
    for (const id of ids) {
      // only clear if not edited again while the push was in flight
      if (this.entries.get(id)?.updatedAt === pushed.get(id)) this.dirty.delete(id);
    }
    save(K.dirty, [...this.dirty]);
  }

  setDevice(patch: Partial<DeviceSettings>) {
    this.device = { ...this.device, ...patch };
    save(K.device, this.device);
    this.changed(false);
  }
  getDevice() {
    return this.device;
  }

  setSync(info: Partial<Snapshot['sync']>) {
    this.syncInfo = { ...this.syncInfo, ...info };
    this.changed(false);
  }

  /** Replace everything (used by "import backup"). */
  importEntries(list: Entry[]) {
    const now = Date.now();
    for (const e of list) {
      const existing = this.entries.get(e.id);
      if (!existing || e.updatedAt >= existing.updatedAt) {
        this.entries.set(e.id, { ...e, updatedAt: Math.max(now, e.updatedAt) } as Entry);
        this.dirty.add(e.id);
      }
    }
    this.changed();
    this.onDirty?.();
  }

  /** Write any recurring expenses that have fallen due. */
  async generateRecurring() {
    const settings = this.settings();
    const t = today();
    for (const r of this.getSnapshot().recurring) {
      const { expenses, generatedUntil } = dueExpenses(r, t, (id) => this.entries.has(id), this.device.me);
      if (!generatedUntil) continue;
      const rate = await rateToBase(r.currency, settings.baseCurrency);
      if (rate == null) continue; // foreign currency and offline with no cached rate – try later
      this.put(...expenses.map((e) => ({ ...e, rate })), { ...r, generatedUntil });
    }
  }

  /** Change the ledger currency, converting every stored rate so balances stay correct. */
  async changeBaseCurrency(next: string) {
    const settings = this.settings();
    const prev = settings.baseCurrency;
    if (prev === next) return true;
    const factor = await rateToBase(prev, next); // next-units per 1 prev-unit
    if (factor == null) return false;
    const updated: Entry[] = [];
    for (const e of this.entries.values()) {
      if ((e.kind === 'expense' || e.kind === 'settlement') && !e.deleted) {
        const rate = e.currency === next ? 1 : e.rate * factor;
        updated.push({ ...e, rate });
      }
    }
    this.put(...updated, { ...settings, baseCurrency: next });
    return true;
  }
}

export const store = new Store();

export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

window.addEventListener('pagehide', () => store.flush());
