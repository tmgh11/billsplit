/**
 * Where the phone keeps its copy of the ledger.
 *
 * IndexedDB: no practical size limit, and only changed entries are written, so saving stays
 * instant however large the ledger grows. Falls back to localStorage (≈5 MB, rewrites
 * everything) only if IndexedDB isn't available, e.g. some private-browsing modes.
 */
import type { Entry } from './types';

export interface Persistence {
  readonly kind: 'indexeddb' | 'localstorage';
  loadAll(): Promise<{ entries: Entry[]; dirty: string[] }>;
  /** Upsert `changed` entries and replace the list of not-yet-synced ids. */
  write(changed: Entry[], dirty: string[], all: () => Iterable<Entry>): Promise<void>;
}

// Keys used by earlier versions (everything in localStorage).
const LEGACY_ENTRIES = 'billsplit.entries';
const LEGACY_DIRTY = 'billsplit.dirty';

function readLegacy(): { entries: Entry[]; dirty: string[] } | null {
  try {
    const raw = localStorage.getItem(LEGACY_ENTRIES);
    if (!raw) return null;
    const entries = Object.values(JSON.parse(raw) as Record<string, Entry>);
    const dirty = JSON.parse(localStorage.getItem(LEGACY_DIRTY) ?? '[]') as string[];
    return { entries, dirty };
  } catch {
    return null;
  }
}

// ---------- IndexedDB ----------

const DB_NAME = 'billsplit';
const DB_VERSION = 1;
const ENTRIES = 'entries';
const META = 'meta';

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

class IdbPersistence implements Persistence {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}

  async loadAll() {
    const tx = this.db.transaction([ENTRIES, META], 'readonly');
    const [entries, dirty] = await Promise.all([
      req(tx.objectStore(ENTRIES).getAll() as IDBRequest<Entry[]>),
      req(tx.objectStore(META).get('dirty') as IDBRequest<string[] | undefined>),
    ]);
    if (entries.length) return { entries, dirty: dirty ?? [] };

    // First run of this version: move data over from localStorage, then free that space.
    const legacy = readLegacy();
    if (!legacy) return { entries: [], dirty: [] };
    await this.write(legacy.entries, legacy.dirty);
    try {
      localStorage.removeItem(LEGACY_ENTRIES);
      localStorage.removeItem(LEGACY_DIRTY);
    } catch {
      /* ignore */
    }
    return legacy;
  }

  async write(changed: Entry[], dirty: string[]) {
    const tx = this.db.transaction([ENTRIES, META], 'readwrite');
    const store = tx.objectStore(ENTRIES);
    for (const e of changed) store.put(e);
    tx.objectStore(META).put(dirty, 'dirty');
    await done(tx);
  }
}

// ---------- localStorage fallback ----------

class LocalPersistence implements Persistence {
  readonly kind = 'localstorage' as const;
  async loadAll() {
    return readLegacy() ?? { entries: [], dirty: [] };
  }
  async write(_changed: Entry[], dirty: string[], all: () => Iterable<Entry>) {
    const map: Record<string, Entry> = {};
    for (const e of all()) map[e.id] = e;
    localStorage.setItem(LEGACY_ENTRIES, JSON.stringify(map));
    localStorage.setItem(LEGACY_DIRTY, JSON.stringify(dirty));
  }
}

export async function openPersistence(): Promise<Persistence> {
  try {
    if (!('indexedDB' in window)) throw new Error('no IndexedDB');
    const p = new IdbPersistence(await openDb());
    // Ask the browser not to clear our data under storage pressure (best effort; Supabase has the master copy anyway).
    void navigator.storage?.persist?.().catch(() => {});
    return p;
  } catch (e) {
    console.warn('Falling back to localStorage', e);
    return new LocalPersistence();
  }
}
