/**
 * Supabase sync: pushes locally-queued changes, pulls anything newer, and listens
 * for realtime changes so the other phone updates within a second or two.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './store';
import type { Entry } from './types';

const LAST_PULL = 'billsplit.lastPull';

let client: SupabaseClient | null = null;
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
  let since = localStorage.getItem(LAST_PULL) ?? '1970-01-01T00:00:00Z';
  for (;;) {
    const { data, error } = await sb
      .from('entries')
      .select('id,kind,data,deleted,client_updated_at,updated_at')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(1000);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    if (rows.length) {
      store.merge(rows.map((r) => ({ ...r.data, updatedAt: r.client_updated_at, deleted: r.deleted }) as Entry));
      since = rows[rows.length - 1].updated_at;
      localStorage.setItem(LAST_PULL, since);
    }
    if (rows.length < 1000) break;
  }
}

async function runSync() {
  const sb = getClient();
  if (!sb) {
    store.setSync({ state: 'local', email: undefined });
    await store.generateRecurring();
    return;
  }
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) {
    store.setSync({ state: 'signed-out', email: undefined });
    await store.generateRecurring();
    return;
  }
  if (!navigator.onLine) {
    store.setSync({ state: 'offline', email: session.user.email });
    await store.generateRecurring();
    return;
  }
  store.setSync({ state: 'syncing', email: session.user.email });
  try {
    await pull(sb);
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
      const r = payload.new as Row | undefined;
      if (r?.data) {
        store.merge([{ ...r.data, updatedAt: r.client_updated_at, deleted: r.deleted } as Entry]);
        if (r.updated_at > (localStorage.getItem(LAST_PULL) ?? '')) localStorage.setItem(LAST_PULL, r.updated_at);
      }
    })
    .subscribe();
}

export async function signIn(email: string, password: string) {
  const sb = getClient();
  if (!sb) throw new Error('Add your Supabase URL and key first');
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  localStorage.removeItem(LAST_PULL); // pull everything on first sign-in
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
  localStorage.removeItem(LAST_PULL);
}

export function startSync() {
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
