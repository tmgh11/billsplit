import { useMemo, useState } from 'react';
import { Icon } from './ui';
import { balance, describeBalance, expenseEffect, fmt, pctForSplit } from '../lib/money';
import { prettyDate } from '../lib/dates';
import { CATEGORIES, categoryById } from '../lib/categories';
import { useStore, type Snapshot } from '../lib/store';
import type { Expense, Person, Settlement } from '../lib/types';
import type { SheetState } from '../App';

type Row = { type: 'expense'; e: Expense } | { type: 'settlement'; s: Settlement };

export function Home({ open }: { open: (s: SheetState) => void }) {
  const { expenses, settlements, settings, device, sync } = useStore();
  const { names, baseCurrency: base } = settings;
  const me = device.me;
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(80);

  const bal = useMemo(() => balance(expenses, settlements), [expenses, settlements]);
  const owing = describeBalance(bal);
  const lastSettled = settlements[0]?.date; // newest first

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: (Row & { date: string; updatedAt: number })[] = [];
    for (const e of expenses) {
      if (cat && e.category !== cat) continue;
      if (q && !`${e.description} ${e.note ?? ''} ${categoryById(e.category).label}`.toLowerCase().includes(q)) continue;
      list.push({ type: 'expense', e, date: e.date, updatedAt: e.updatedAt });
    }
    if (!cat) {
      for (const s of settlements) {
        if (q && !`settle up payment ${s.note ?? ''} ${names[s.from]} ${names[s.to]}`.toLowerCase().includes(q)) continue;
        list.push({ type: 'settlement', s, date: s.date, updatedAt: s.updatedAt });
      }
    }
    list.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    return list;
  }, [expenses, settlements, query, cat, names]);

  // one group per day, newest first
  const days = useMemo(() => {
    const out: { date: string; rows: typeof rows }[] = [];
    for (const r of rows.slice(0, limit)) {
      const last = out[out.length - 1];
      if (last?.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [rows, limit]);

  const usedCats = useMemo(() => new Set(expenses.map((e) => e.category)), [expenses]);
  const who = (p: Person) => (p === me ? 'You' : names[p]);
  const status = syncStatus(sync);

  return (
    <>
      <section className="card balance" aria-label="Balance">
        {owing ? (
          <>
            <div className="headline">
              {owing.debtor === me ? (
                <>
                  You owe <span className={owing.creditor}>{names[owing.creditor]}</span>
                </>
              ) : (
                <>
                  <span className={owing.debtor}>{names[owing.debtor]}</span> owes you
                </>
              )}
            </div>
            <div className="amount num">{fmt(owing.amount, base)}</div>
          </>
        ) : (
          <>
            <div className="headline">Nobody owes anything</div>
            <div className="amount">All square</div>
          </>
        )}
        <div className="meta">
          {lastSettled && <span>Last settled up {relativeDay(lastSettled)}</span>}
          <span className={`status ${status.tone}`}>
            <span className={`dot ${status.tone}`} aria-hidden="true" />
            {status.text}
          </span>
        </div>
      </section>

      {expenses.length + settlements.length > 0 && (
        <>
          <label className="search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Search expenses"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search expenses"
            />
          </label>
          {usedCats.size > 1 && (
            <div className="filters">
              <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>All</button>
              {CATEGORIES.filter((c) => usedCats.has(c.id)).map((c) => (
                <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {days.length === 0 && (
        <div className="card empty">
          <div className="big">🧾</div>
          {query || cat ? 'Nothing matches that.' : 'No expenses yet. Tap Add expense below to get started.'}
        </div>
      )}

      {days.map((d) => (
        <div key={d.date}>
          <h3 className="day-head">{prettyDate(d.date)}</h3>
          <div className="card list">
            {d.rows.map((r) =>
              r.type === 'expense' ? (
                <ExpenseRow key={r.e.id} e={r.e} me={me} base={base} who={who} names={names} onClick={() => open({ type: 'expense', expense: r.e })} />
              ) : (
                <button key={r.s.id} className="row settle-row" onClick={() => open({ type: 'settle', settlement: r.s })}>
                  <div className="cat-ic" aria-hidden="true">
                    <Icon name="arrows" size={18} />
                  </div>
                  <div className="row-main">
                    <div className="row-title">
                      {who(r.s.from)} paid {r.s.to === me ? 'you' : names[r.s.to]}
                    </div>
                    <div className="row-sub">{r.s.note || 'Settle up'}</div>
                  </div>
                  <div className="row-amt num">
                    <div className="main">{fmt(r.s.amount, r.s.currency)}</div>
                    <div className="eff good">Settle up</div>
                  </div>
                </button>
              ),
            )}
          </div>
        </div>
      ))}

      {rows.length > limit && (
        <button className="btn" style={{ marginTop: 14 }} onClick={() => setLimit((l) => l + 100)}>
          Show older
        </button>
      )}

      {/* thumb-reach actions, fixed above the tab bar */}
      <div className="home-actions">
        <button className="btn settle" disabled={!owing} onClick={() => open({ type: 'settle' })}>
          <Icon name="arrows" size={20} /> Settle up
        </button>
        <button className="btn primary add" onClick={() => open({ type: 'expense' })}>
          <Icon name="plus" size={22} stroke={2.4} /> Add expense
        </button>
      </div>
    </>
  );
}

/** "today", "yesterday" or "Thu 10 Sept", to follow other words in a sentence. */
function relativeDay(date: string) {
  const d = prettyDate(date);
  return d === 'Today' || d === 'Yesterday' ? d.toLowerCase() : d;
}

/** The balance card's sync line, so a stale balance is never mistaken for a current one. */
function syncStatus(sync: Snapshot['sync']): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' | '' } {
  switch (sync.state) {
    case 'synced': {
      const mins = sync.lastSynced ? Math.floor((Date.now() - sync.lastSynced) / 60_000) : 0;
      const at = sync.lastSynced ? new Date(sync.lastSynced).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      return { text: mins < 1 ? 'Synced just now' : mins < 60 ? `Synced ${mins} min ago` : `Synced at ${at}`, tone: 'ok' };
    }
    case 'syncing':
      return { text: 'Syncing…', tone: 'busy' };
    case 'offline':
      return { text: 'Offline · changes will sync later', tone: 'warn' };
    case 'error':
      return { text: 'Not syncing · see Settings', tone: 'bad' };
    case 'signed-out':
      return { text: 'Signed out · not syncing', tone: 'warn' };
    default:
      return { text: 'Only on this phone', tone: '' };
  }
}

/** "50/50", "all yours", "all Nuria’s" or "60% yours", from the viewer's side. */
function splitLabel(e: Expense, me: Person, names: Record<Person, string>): string {
  if (e.split === 'equal') return '50/50';
  if (e.split === 'tom' || e.split === 'nuria') return e.split === me ? 'all yours' : `all ${names[e.split]}’s`;
  const tomPct = pctForSplit(e.split, e.tomPct);
  return `${Math.round(me === 'tom' ? tomPct : 100 - tomPct)}% yours`;
}

function ExpenseRow({
  e,
  me,
  base,
  who,
  names,
  onClick,
}: {
  e: Expense;
  me: Person;
  base: string;
  who: (p: Person) => string;
  names: Record<Person, string>;
  onClick: () => void;
}) {
  const c = categoryById(e.category);
  // what this expense does to the balance, seen from this phone's owner
  const eff = expenseEffect(e) * (me === 'tom' ? 1 : -1);
  return (
    <button className="row" onClick={onClick}>
      <div className="cat-ic" aria-hidden="true">
        {c.emoji}
        {e.recurringId && (
          <span className="badge" title="Repeating">
            <Icon name="repeat" size={10} stroke={2.5} />
          </span>
        )}
      </div>
      <div className="row-main">
        <div className="row-title">{e.description}</div>
        <div className="row-sub">
          <span className={e.paidBy}>{who(e.paidBy)}</span> paid · {splitLabel(e, me, names)}
        </div>
      </div>
      <div className="row-amt num">
        <div className="main">{fmt(e.amount, e.currency)}</div>
        {eff > 0 ? (
          <div className="eff good">+{fmt(eff, base)} to you</div>
        ) : eff < 0 ? (
          <div className="eff owe">−{fmt(-eff, base)} you owe</div>
        ) : (
          <div className="eff muted">not shared</div>
        )}
      </div>
    </button>
  );
}

