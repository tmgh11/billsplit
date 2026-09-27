/**
 * Where the phone keeps its copy of the ledger.
 *
 * IndexedDB: no practical size limit, and only changed entries are written, so saving stays
 * instant however large the ledger grows. Falls back to localStorage (≈5 MB, rewrites
 * everything) only if IndexedDB isn't available, e.g. some private-browsing modes.
 */
import type { Entry } from './types';

export interface Loaded {
  entries: Entry[];
  dirty: string[];
  /** how far the phone has pulled from Supabase; null = pull everything next time */
  cursor: string | null;
}

export interface Persistence {
  readonly kind: 'indexeddb' | 'localstorage';
  loadAll(): Promise<Loaded>;
  /**
   * Upsert `changed` entries and replace the not-yet-synced ids and the pull cursor, all in one
   * go, so the saved cursor never claims rows that aren't saved.
   */
  write(changed: Entry[], dirty: string[], cursor: string | null, all: () => Iterable<Entry>): Promise<void>;
}

// Keys used by earlier versions (everything in localStorage).
const LEGACY_ENTRIES = 'billsplit.entries';
const LEGACY_DIRTY = 'billsplit.dirty';
const LOCAL_CURSOR = 'billsplit.cursor';

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

/**
 * Combine what IndexedDB holds with a copy left in localStorage, keeping the newer version of each
 * entry. The localStorage copy is either from before IndexedDB was used, or from a session where
 * IndexedDB failed to open and the app fell back. Either way it may hold rows IndexedDB never saw,
 * so the pull cursor is dropped and the next sync pulls everything.
 */
export function mergeLegacy(
  stored: Entry[],
  storedDirty: string[],
  legacy: { entries: Entry[]; dirty: string[] },
): Loaded & { newer: Entry[] } {
  const byId = new Map(stored.map((e) => [e.id, e]));
  const newer = legacy.entries.filter((e) => (byId.get(e.id)?.updatedAt ?? -Infinity) < e.updatedAt);
  for (const e of newer) byId.set(e.id, e);
  return { entries: [...byId.values()], dirty: [...new Set([...storedDirty, ...legacy.dirty])], cursor: null, newer };
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

  async loadAll(): Promise<Loaded> {
    const tx = this.db.transaction([ENTRIES, META], 'readonly');
    const [entries, dirty, cursor] = await Promise.all([
      req(tx.objectStore(ENTRIES).getAll() as IDBRequest<Entry[]>),
      req(tx.objectStore(META).get('dirty') as IDBRequest<string[] | undefined>),
      req(tx.objectStore(META).get('cursor') as IDBRequest<string | null | undefined>),
    ]);
    const legacy = readLegacy();
    if (!legacy) return { entries, dirty: dirty ?? [], cursor: cursor ?? null };

    // Fold the localStorage copy in, then free that space.
    const merged = mergeLegacy(entries, dirty ?? [], legacy);
    await this.write(merged.newer, merged.dirty, null);
    try {
      localStorage.removeItem(LEGACY_ENTRIES);
      localStorage.removeItem(LEGACY_DIRTY);
      localStorage.removeItem(LOCAL_CURSOR);
    } catch {
      /* ignore */
    }
    return { entries: merged.entries, dirty: merged.dirty, cursor: null };
  }

  async write(changed: Entry[], dirty: string[], cursor: string | null) {
    const tx = this.db.transaction([ENTRIES, META], 'readwrite');
    const store = tx.objectStore(ENTRIES);
    for (const e of changed) store.put(e);
    tx.objectStore(META).put(dirty, 'dirty');
    tx.objectStore(META).put(cursor, 'cursor');
    await done(tx);
  }
}

// ---------- localStorage fallback ----------

class LocalPersistence implements Persistence {
  readonly kind = 'localstorage' as const;
  async loadAll(): Promise<Loaded> {
    const legacy = readLegacy();
    return legacy ? { ...legacy, cursor: localStorage.getItem(LOCAL_CURSOR) } : { entries: [], dirty: [], cursor: null };
  }
  async write(_changed: Entry[], dirty: string[], cursor: string | null, all: () => Iterable<Entry>) {
    const map: Record<string, Entry> = {};
    for (const e of all()) map[e.id] = e;
    localStorage.setItem(LEGACY_ENTRIES, JSON.stringify(map));
    localStorage.setItem(LEGACY_DIRTY, JSON.stringify(dirty));
    if (cursor) localStorage.setItem(LOCAL_CURSOR, cursor);
    else localStorage.removeItem(LOCAL_CURSOR);
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
