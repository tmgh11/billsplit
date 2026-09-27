/**
 * Supabase sync: pushes locally-queued changes, pulls anything newer, and listens
 * for realtime changes so the other phone updates within a second or two.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './store';
import { rewindTimestamp } from './dates';
import type { Entry } from './types';

const EPOCH = '1970-01-01T00:00:00Z';
/**
 * Each pull re-reads this much before the cursor. `updated_at` is stamped when a row is written,
 * not when it's committed, so rows can appear slightly out of order; merging one twice is harmless.
 */
const PULL_OVERLAP_MS = 60_000;
/** How often to compare every row's version with the server, to catch anything a pull missed. */
const RECONCILE_EVERY_MS = 60 * 60 * 1000;

let client: SupabaseClient | null = null;
let lastReconcile = 0;
let clientKey = '';
let channel: RealtimeChannel | null = null;
let syncing: Promise<void> | null = null;
let again = false;
let debounce: number | undefined;

export function supabaseConfig() {
  const d = store.getDevice();
  // accept the URL however it was copied (e.g. with /rest/v1/ from the Data API page)
  const url = (d.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/(rest|auth)\/v1\/?$/, '')
    .replace(/\/+$/, '');
  const key = (d.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  return url && key ? { url, key } : null;
}

export const configBakedIn = () => Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export function getClient(): SupabaseClient | null {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const k = cfg.url + cfg.key;
  if (!client || clientKey !== k) {
    client = createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'billsplit.auth' },
    });
    clientKey = k;
  }
  return client;
}

interface Row {
  id: string;
  kind: string;
  data: Entry;
  deleted: boolean;
  client_updated_at: number;
  updated_at: string;
}

const ROW_COLUMNS = 'id,kind,data,deleted,client_updated_at,updated_at';
const toEntry = (r: Row) => ({ ...r.data, updatedAt: r.client_updated_at, deleted: r.deleted }) as Entry;

async function push(sb: SupabaseClient) {
  const dirty = store.dirtyEntries();
  for (let i = 0; i < dirty.length; i += 200) {
    const batch = dirty.slice(i, i + 200);
    const rows = batch.map((e) => ({
      id: e.id,
      kind: e.kind,
      data: e,
      deleted: Boolean(e.deleted),
      client_updated_at: e.updatedAt,
    }));
    const { error } = await sb.from('entries').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    store.markClean(
      batch.map((e) => e.id),
      new Map(batch.map((e) => [e.id, e.updatedAt])),
    );
  }
}

async function pull(sb: SupabaseClient) {
  const saved = store.getPullCursor();
  let since = (saved && rewindTimestamp(saved, PULL_OVERLAP_MS)) ?? EPOCH;
  for (;;) {
    const { data, error } = await sb
      .from('entries')
      .select(ROW_COLUMNS)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(1000);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    if (rows.length) {
      store.merge(rows.map(toEntry));
      // Never moves backwards: the row the saved cursor came from is always re-read by the overlap.
      since = rows[rows.length - 1].updated_at;
      store.setPullCursor(since);
    }
    if (rows.length < 1000) break;
  }
}

/**
 * Compare every row's version (ids and timestamps only, so it's cheap) with this phone's copy.
 * Fetches anything missing or newer on the server, and re-queues anything the server is missing,
 * so a row skipped by an earlier pull can't stay missing.
 */
async function reconcile(sb: SupabaseClient) {
  const server = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('entries')
      .select('id,client_updated_at')
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as Pick<Row, 'id' | 'client_updated_at'>[];
    for (const r of rows) server.set(r.id, r.client_updated_at);
    if (rows.length < 1000) break;
  }

  const behind = [...server].filter(([id, v]) => (store.get(id)?.updatedAt ?? -Infinity) < v).map(([id]) => id);
  for (let i = 0; i < behind.length; i += 100) {
    const { data, error } = await sb.from('entries').select(ROW_COLUMNS).in('id', behind.slice(i, i + 100));
    if (error) throw error;
    store.merge(((data ?? []) as Row[]).map(toEntry));
  }

  store.markDirty(store.all().filter((e) => (server.get(e.id) ?? -Infinity) < e.updatedAt).map((e) => e.id));
  if (behind.length) console.info(`Sync check: fetched ${behind.length} entries a previous sync missed`);
}

async function runSync() {
  await store.ready;
  const sb = getClient();
  if (!sb) {
    store.setSync({ state: 'local', email: undefined });
    await store.generateRecurring();
    return;
  }
  const { data } = await sb.auth.getSession();
  const session = data.session;
  // Signed out or offline: don't add repeating expenses yet. This phone may not know that the
  // other one paused, edited or deleted something; they're added on the next successful sync.
  if (!session) {
    store.setSync({ state: 'signed-out', email: undefined });
    return;
  }
  if (!navigator.onLine) {
    store.setSync({ state: 'offline', email: session.user.email });
    return;
  }
  store.setSync({ state: 'syncing', email: session.user.email });
  try {
    await pull(sb);
    if (Date.now() - lastReconcile > RECONCILE_EVERY_MS) {
      await reconcile(sb);
      lastReconcile = Date.now();
    }
    await store.generateRecurring();
    await push(sb);
    store.setSync({ state: 'synced', lastSynced: Date.now(), message: undefined });
    ensureRealtime(sb);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
    store.setSync({ state: navigator.onLine ? 'error' : 'offline', message: msg });
  }
}

export function syncNow(): Promise<void> {
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = runSync().finally(() => {
    syncing = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return syncing;
}

function ensureRealtime(sb: SupabaseClient) {
  if (channel) return;
  channel = sb
    .channel('entries-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, (payload) => {
      // Only applies the row. The pull cursor is left alone: one event says nothing about rows
      // written while the connection was down.
      const r = payload.new as Row | undefined;
      if (r?.data) store.merge([toEntry(r)]);
    })
    .subscribe();
}

export async function signIn(email: string, password: string) {
  const sb = getClient();
  if (!sb) throw new Error('Add your Supabase URL and key first');
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  store.setPullCursor(null); // pull everything on first sign-in
  lastReconcile = 0;
  await syncNow();
}

export async function signOut() {
  const sb = getClient();
  if (channel && sb) await sb.removeChannel(channel);
  channel = null;
  await sb?.auth.signOut();
  store.setSync({ state: 'signed-out', email: undefined });
}

export function resetClient() {
  if (channel && client) void client.removeChannel(channel);
  channel = null;
  client = null;
  store.setPullCursor(null);
  lastReconcile = 0;
}

export function startSync() {
  // Older versions kept the cursor here, apart from the ledger it described.
  try {
    localStorage.removeItem('billsplit.lastPull');
  } catch {
    /* ignore */
  }
  store.onDirty = () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void syncNow(), 700);
  };
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 60_000);
  void syncNow();
}
