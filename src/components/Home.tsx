import { useMemo, useState } from 'react';
import { Icon } from './ui';
import { balance, basePence, describeBalance, expenseEffect, fmt } from '../lib/money';
import { monthKey, monthLabel, prettyDate } from '../lib/dates';
import { CATEGORIES, categoryById } from '../lib/categories';
import { useStore } from '../lib/store';
import type { Expense, Settlement } from '../lib/types';
import type { SheetState } from '../App';

type Row = { type: 'expense'; e: Expense } | { type: 'settlement'; s: Settlement };

export function Home({ open }: { open: (s: SheetState) => void }) {
  const { expenses, settlements, settings } = useStore();
  const { names, baseCurrency: base } = settings;
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(80);

  const bal = balance(expenses, settlements);
  const owing = describeBalance(bal);

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
        if (q && !`payment settle ${s.note ?? ''} ${names[s.from]} ${names[s.to]}`.toLowerCase().includes(q)) continue;
        list.push({ type: 'settlement', s, date: s.date, updatedAt: s.updatedAt });
      }
    }
    list.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    return list;
  }, [expenses, settlements, query, cat, names]);

  const grouped = useMemo(() => {
    const out: { key: string; rows: typeof rows; spend: number }[] = [];
    for (const r of rows.slice(0, limit)) {
      const k = monthKey(r.date);
      let g = out[out.length - 1];
      if (!g || g.key !== k) out.push((g = { key: k, rows: [], spend: 0 }));
      g.rows.push(r);
      if (r.type === 'expense') g.spend += basePence(r.e);
    }
    return out;
  }, [rows, limit]);

  const usedCats = useMemo(() => new Set(expenses.map((e) => e.category)), [expenses]);

  return (
    <>
      <div className="card balance">
        <div className="label">{owing ? 'Running balance' : 'Balance'}</div>
        {owing ? (
          <>
            <div className="amount num">{fmt(owing.amount, base)}</div>
            <div className="flow">
              <span className={owing.debtor}>{names[owing.debtor]}</span>
              <span className="muted">owes</span>
              <span className={owing.creditor}>{names[owing.creditor]}</span>
            </div>
          </>
        ) : (
          <>
            <div className="amount">All square</div>
            <div className="flow muted" style={{ fontWeight: 500 }}>No one owes anything 🎉</div>
          </>
        )}
      </div>

      <div className="actions">
        <button className="action primary" onClick={() => open({ type: 'expense' })}>
          <span className="ic"><Icon name="plus" /></span>
          Add expense
        </button>
        <button className="action" onClick={() => open({ type: 'receipt' })}>
          <span className="ic"><Icon name="camera" /></span>
          Scan receipt
        </button>
        <button className="action" onClick={() => open({ type: 'settle' })}>
          <span className="ic" style={{ color: 'var(--good)' }}><Icon name="arrows" /></span>
          Settle up
        </button>
      </div>

      <div className="section-title">
        <span>Ledger</span>
        <span className="aside">{expenses.length + settlements.length} entries</span>
      </div>

      {expenses.length + settlements.length > 0 && (
        <>
          <label className="search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the ledger"
            />
          </label>
          <div className="filters">
            <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>All</button>
            {CATEGORIES.filter((c) => usedCats.has(c.id)).map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {grouped.length === 0 && (
        <div className="card empty">
          <div className="big">🧾</div>
          {query || cat ? 'Nothing matches that.' : 'No expenses yet. Add one or scan a receipt to get started.'}
        </div>
      )}

      {grouped.map((g) => (
        <div key={g.key}>
          <div className="month-head">
            <span>{monthLabel(g.key)}</span>
            <span className="num">{fmt(g.spend / 100, base)} spent</span>
          </div>
          <div className="card list">
            {g.rows.map((r) =>
              r.type === 'expense' ? (
                <ExpenseRow key={r.e.id} e={r.e} base={base} names={names} onClick={() => open({ type: 'expense', expense: r.e })} />
              ) : (
                <button key={r.s.id} className="row settle-row" onClick={() => open({ type: 'settle', settlement: r.s })}>
                  <div className="cat-ic">💸</div>
                  <div className="row-main">
                    <div className="row-title">
                      {names[r.s.from]} paid {names[r.s.to]}
                    </div>
                    <div className="row-sub">{prettyDate(r.s.date)}{r.s.note ? ` · ${r.s.note}` : ''}</div>
                  </div>
                  <div className="row-amt num">
                    <div className="main good">{fmt(r.s.amount, r.s.currency)}</div>
                    <div className="eff muted">Settlement</div>
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
    </>
  );
}

function ExpenseRow({
  e,
  base,
  names,
  onClick,
}: {
  e: Expense;
  base: string;
  names: Record<'tom' | 'nuria', string>;
  onClick: () => void;
}) {
  const c = categoryById(e.category);
  const eff = expenseEffect(e);
  const splitLabel =
    e.split === 'equal' ? '50/50' : e.split === 'tom' ? `${names.tom}’s` : e.split === 'nuria' ? `${names.nuria}’s` : `${Math.round(e.tomPct)}/${Math.round(100 - e.tomPct)}`;
  return (
    <button className="row" onClick={onClick}>
      <div className="cat-ic">
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
          {prettyDate(e.date)} · <span className={e.paidBy}>{names[e.paidBy]}</span> paid · {splitLabel}
        </div>
      </div>
      <div className="row-amt num">
        <div className="main">{fmt(e.amount, e.currency)}</div>
        {Math.abs(eff) >= 0.005 ? (
          <div className={`eff ${eff > 0 ? 'nuria' : 'tom'}`}>
            {eff > 0 ? names.nuria : names.tom} owes {fmt(Math.abs(eff), base)}
          </div>
        ) : (
          <div className="eff muted">not shared</div>
        )}
      </div>
    </button>
  );
}
