import { useRef, useState } from 'react';
import { Icon, Seg, toast } from './ui';
import { store, useStore } from '../lib/store';
import { configBakedIn, resetClient, signIn, signOut, supabaseConfig, syncNow } from '../lib/sync';
import { CURRENCIES, CURRENCY_FLAGS, rateToBase } from '../lib/fx';
import { parseSplitwise, planSplitwiseImport, type SplitwiseImport } from '../lib/splitwise';
import { categoryById } from '../lib/categories';
import { baseAmount, fmt, shares } from '../lib/money';
import { prettyDate } from '../lib/dates';
import type { Entry, Person } from '../lib/types';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsView() {
  const { settings, device, sync, expenses } = useStore();
  const [names, setNames] = useState(settings.names);
  const [url, setUrl] = useState(device.supabaseUrl ?? '');
  const [key, setKey] = useState(device.supabaseKey ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sw, setSw] = useState<{ text: string; parsed: SplitwiseImport; tomCol: 0 | 1 } | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const swRef = useRef<HTMLInputElement>(null);
  const configured = Boolean(supabaseConfig());

  const saveNames = () => {
    const clean = { tom: names.tom.trim() || 'Tom', nuria: names.nuria.trim() || 'Nuria' };
    if (clean.tom !== settings.names.tom || clean.nuria !== settings.names.nuria) {
      store.updateSettings({ names: clean });
      toast('Names updated');
    }
  };

  // The ledger currency can only be picked while the ledger is empty (deleted entries count, since
  // Undo can bring them back). Changing it later would mean re-rating every entry on both phones.
  const ledgerStarted = store.all().some((e) => e.kind === 'expense' || e.kind === 'settlement');

  const doSignIn = async () => {
    setBusy(true);
    try {
      await signIn(email, password);
      setPassword('');
      toast('Signed in — syncing');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = () => {
    resetClient();
    store.setDevice({ supabaseUrl: url.trim(), supabaseKey: key.trim() });
    void syncNow();
    toast('Saved');
  };

  const exportCSV = () => {
    const rows = [['Date', 'Description', 'Category', 'Amount', 'Currency', `Amount (${settings.baseCurrency})`, 'Paid by', `${settings.names.tom} share`, `${settings.names.nuria} share`, 'Note']];
    for (const e of [...expenses].reverse()) {
      const s = shares(e);
      rows.push([e.date, e.description, categoryById(e.category).label, e.amount.toFixed(2), e.currency, baseAmount(e).toFixed(2), settings.names[e.paidBy], s.tom.toFixed(2), s.nuria.toFixed(2), e.note ?? '']);
    }
    download(`billsplit-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };

  const importBackup = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { entries: Entry[] };
      if (!Array.isArray(data.entries)) throw new Error();
      store.importEntries(data.entries);
      toast(`Imported ${data.entries.length} entries`);
    } catch {
      toast('That file isn’t a Billsplit backup');
    }
  };

  const loadSplitwise = async (f?: File) => {
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = parseSplitwise(text, 0);
      const guessTom: 0 | 1 = /tom/i.test(parsed.people[1]) && !/tom/i.test(parsed.people[0]) ? 1 : 0;
      setSw({ text, parsed: guessTom ? parseSplitwise(text, 1) : parsed, tomCol: guessTom });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t read that file', undefined, 9000);
    }
  };

  // What importing would do: only rows not already in the ledger are added
  const plan = sw ? planSplitwiseImport(sw.parsed, store.all()) : null;

  const runSplitwiseImport = async () => {
    if (!plan?.add.length) return;
    setBusy(true);
    const base = settings.baseCurrency;
    const rates = new Map<string, number>();
    for (const c of new Set(plan.add.map((x) => x.currency))) {
      const r = await rateToBase(c, base);
      if (r == null) {
        setBusy(false);
        return toast(`Need to be online to convert ${c}`);
      }
      rates.set(c, r);
    }
    const entries = plan.add.map((x) => ({ ...x, rate: rates.get(x.currency)!, updatedAt: 0 }) as Entry);
    store.put(...entries);
    setBusy(false);
    setSw(null);
    toast(`Imported ${entries.length} entries from Splitwise`);
  };

  const syncLabel: Record<typeof sync.state, string> = {
    local: 'Not connected — data is only on this phone',
    'signed-out': 'Connected to Supabase — sign in to sync',
    syncing: 'Syncing…',
    synced: `Synced${sync.lastSynced ? ` at ${new Date(sync.lastSynced).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
    offline: 'Offline — changes will sync when you’re back online',
    error: `Sync problem: ${sync.message ?? 'unknown error'}`,
  };

  return (
    <>
      <div className="section-title" style={{ marginTop: 6 }}>This phone belongs to</div>
      <Seg<Person>
        value={device.me}
        onChange={(me) => store.setDevice({ me })}
        options={[
          { value: 'tom', label: settings.names.tom, className: 'tom' },
          { value: 'nuria', label: settings.names.nuria, className: 'nuria' },
        ]}
      />
      <p className="small-print">Used as the default “paid by”.</p>

      <div className="section-title">Household</div>
      <div className="card set-group">
        <div className="set-row">
          <span className="tom" style={{ fontWeight: 650, width: 76, whiteSpace: "nowrap" }}>Person 1</span>
          <input className="input grow" value={names.tom} onChange={(e) => setNames({ ...names, tom: e.target.value })} onBlur={saveNames} aria-label="Person 1 name" />
        </div>
        <div className="set-row">
          <span className="nuria" style={{ fontWeight: 650, width: 76, whiteSpace: "nowrap" }}>Person 2</span>
          <input className="input grow" value={names.nuria} onChange={(e) => setNames({ ...names, nuria: e.target.value })} onBlur={saveNames} aria-label="Person 2 name" />
        </div>
        <div className="set-row">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Ledger currency</div>
            <div className="hint">
              {ledgerStarted
                ? 'Balances and charts are in this. Add expenses in any currency; they’re converted when added.'
                : 'Balances and charts are shown in this. Pick it before adding anything; it’s fixed after that.'}
            </div>
          </div>
          {ledgerStarted ? (
            <strong style={{ whiteSpace: 'nowrap' }}>
              {CURRENCY_FLAGS[settings.baseCurrency] ?? ''} {settings.baseCurrency}
            </strong>
          ) : (
            <select className="cur-select" value={settings.baseCurrency} onChange={(e) => store.updateSettings({ baseCurrency: e.target.value })} aria-label="Ledger currency">
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{CURRENCY_FLAGS[c] ?? ''} {c}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="section-title">Sync between phones</div>
      <div className="card pad">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <span className={`dot ${sync.state === 'synced' ? 'ok' : sync.state === 'syncing' ? 'busy' : sync.state === 'error' ? 'bad' : 'warn'}`} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{syncLabel[sync.state]}</span>
        </div>

        {!configBakedIn() && (!configured || sync.state === 'local' || sync.state === 'signed-out') && (
          <>
            <div className="field">
              <label htmlFor="sburl">Supabase project URL</label>
              <input id="sburl" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoCapitalize="off" autoCorrect="off" />
            </div>
            <div className="field">
              <label htmlFor="sbkey">Supabase anon / publishable key</label>
              <input id="sbkey" className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ… or sb_publishable_…" autoCapitalize="off" autoCorrect="off" />
            </div>
            <button className="btn" onClick={saveConfig} disabled={!url || !key} style={{ marginBottom: configured ? 18 : 0 }}>
              Save connection
            </button>
          </>
        )}

        {configured && !sync.email && (
          <>
            <div className="field">
              <label htmlFor="em">Email</label>
              <input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="off" />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className="btn primary" disabled={busy || !email || !password} onClick={doSignIn}>
              Sign in
            </button>
          </>
        )}

        {sync.email && (
          <>
            <p className="text-2" style={{ fontSize: 14, marginTop: 0 }}>Signed in as <strong>{sync.email}</strong></p>
            <div className="btn-row">
              <button className="btn" onClick={() => void syncNow()}>
                <Icon name="cloud" size={18} /> Sync now
              </button>
              <button className="btn" onClick={() => void signOut()}>Sign out</button>
            </div>
          </>
        )}
      </div>
      <p className="small-print">Everything is saved on the phone first, so the app works offline. See the README for the 5-minute Supabase setup.</p>

      <div className="section-title">Your data</div>
      <div className="card set-group">
        <button className="set-row" onClick={() => swRef.current?.click()}>
          <span className="grow">
            <div style={{ fontWeight: 600 }}>Import from Splitwise</div>
            <div className="hint">Group → Settings → Export as spreadsheet (CSV)</div>
          </span>
          <Icon name="upload" size={20} />
        </button>
        <button className="set-row" onClick={exportCSV}>
          <span className="grow" style={{ fontWeight: 600 }}>Export expenses (CSV)</span>
          <Icon name="download" size={20} />
        </button>
        <button className="set-row" onClick={() => download(`billsplit-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, entries: store.all() }), 'application/json')}>
          <span className="grow" style={{ fontWeight: 600 }}>Download full backup</span>
          <Icon name="download" size={20} />
        </button>
        <button className="set-row" onClick={() => backupRef.current?.click()}>
          <span className="grow" style={{ fontWeight: 600 }}>Restore backup</span>
          <Icon name="upload" size={20} />
        </button>
      </div>
      <input ref={swRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void loadSplitwise(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={(e) => { void importBackup(e.target.files?.[0]); e.target.value = ''; }} />

      {sw && (
        <div className="card pad" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Splitwise import</div>
          <p className="text-2" style={{ fontSize: 14, marginTop: 0 }}>
            Found {sw.parsed.expenses.length} expenses and {sw.parsed.settlements.length} times you settled up. Which column is {settings.names.tom}?
          </p>
          <Seg<'0' | '1'>
            value={String(sw.tomCol) as '0' | '1'}
            onChange={(v) => setSw({ ...sw, tomCol: Number(v) as 0 | 1, parsed: parseSplitwise(sw.text, Number(v) as 0 | 1) })}
            options={sw.parsed.people.map((p, i) => ({ value: String(i) as '0' | '1', label: p }))}
          />
          {plan && (
            <>
              <p className="text-2" style={{ fontSize: 14, marginBottom: 0 }}>
                {plan.add.length ? <strong>{plan.add.length} new</strong> : 'Nothing new'}
                {plan.already ? ` · ${plan.already} already imported (left as they are here, including edits and deletions)` : ''}
              </p>
              {plan.notInFile.length > 0 && (
                <details style={{ fontSize: 14, marginTop: 8 }}>
                  <summary>
                    {plan.notInFile.length} imported earlier but not in this file — probably edited or deleted in Splitwise. Check
                    and delete any you don’t want.
                  </summary>
                  {plan.notInFile.map((e) => (
                    <div key={e.id} className="text-2" style={{ padding: '3px 0' }}>
                      {prettyDate(e.date)} · {e.kind === 'expense' ? e.description : `${settings.names[e.from]} paid ${settings.names[e.to]}`} ·{' '}
                      {fmt(e.amount, e.currency)}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setSw(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !plan?.add.length} onClick={() => void runSplitwiseImport()}>
              {plan?.add.length ? `Add ${plan.add.length}` : 'Import'}
            </button>
          </div>
        </div>
      )}

      <p className="small-print" style={{ marginTop: 22 }}>
        <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates by Exchange Rate API</a> · Receipt
        reading by Tesseract.js, on-device.
      </p>
    </>
  );
}
