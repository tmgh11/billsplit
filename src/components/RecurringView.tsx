import { Icon } from './ui';
import { categoryById } from '../lib/categories';
import { fmt, pctForSplit } from '../lib/money';
import { addDays, prettyDate, today } from '../lib/dates';
import { describeFrequency, nextOccurrence } from '../lib/recurring';
import { store, useStore } from '../lib/store';
import type { SheetState } from '../App';

export function RecurringView({ open }: { open: (s: SheetState) => void }) {
  const { recurring, settings } = useStore();
  const { names } = settings;
  const t = today();

  const withNext = recurring
    .map((r) => ({ r, next: r.paused ? null : nextOccurrence(r, t) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));

  const monthlyEstimate = recurring
    .filter((r) => !r.paused && r.currency === settings.baseCurrency)
    .reduce((s, r) => {
      const perMonth = { weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1, yearly: 1 / 12, dates: 0 }[r.frequency];
      return s + r.amount * perMonth;
    }, 0);

  return (
    <>
      <div className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="text-2" style={{ fontSize: 14, fontWeight: 550 }}>Regular outgoings</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 740, letterSpacing: '-0.02em' }}>
            {fmt(monthlyEstimate, settings.baseCurrency)}
            <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}> / month</span>
          </div>
        </div>
        <button className="btn primary small" onClick={() => open({ type: 'recurring' })}>
          <Icon name="plus" size={18} /> New
        </button>
      </div>

      <div className="section-title">
        <span>Repeating expenses</span>
        <span className="aside">auto-added when due</span>
      </div>

      {withNext.length === 0 && (
        <div className="card empty">
          <div className="big">🔁</div>
          Set up the mortgage, bills and subscriptions once — they’ll appear in the ledger on the right day.
        </div>
      )}

      {withNext.length > 0 && (
        <div className="card list">
          {withNext.map(({ r, next }) => {
            const c = categoryById(r.category);
            const pct = pctForSplit(r.split, r.tomPct);
            const split = r.split === 'equal' ? '50/50' : r.split === 'tom' ? `${names.tom}’s` : r.split === 'nuria' ? `${names.nuria}’s` : `${Math.round(pct)}/${Math.round(100 - pct)}`;
            return (
              <div key={r.id} className="row" style={{ opacity: r.paused ? 0.55 : 1 }}>
                <button className="cat-ic" onClick={() => open({ type: 'recurring', recurring: r })} aria-label={`Edit ${r.description}`}>
                  {c.emoji}
                </button>
                <button className="row-main" style={{ textAlign: 'left' }} onClick={() => open({ type: 'recurring', recurring: r })}>
                  <div className="row-title">{r.description}</div>
                  <div className="row-sub">
                    {describeFrequency(r)} · <span className={r.paidBy}>{names[r.paidBy]}</span> pays · {split}
                  </div>
                  <div className="row-sub" style={{ color: 'var(--text-2)' }}>
                    {r.paused ? 'Paused' : next ? `Next: ${prettyDate(next)}` : 'Finished'}
                  </div>
                </button>
                <div className="row-amt num">
                  <div className="main">{fmt(r.amount, r.currency)}</div>
                  <button
                    className="btn small"
                    style={{ minHeight: 30, padding: '0 10px', marginTop: 4, fontSize: 12 }}
                    onClick={() => {
                      if (!r.paused) return store.put({ ...r, paused: true });
                      // resuming: don't back-fill dates that passed while paused
                      const y = addDays(t, -1);
                      store.put({ ...r, paused: false, generatedUntil: !r.generatedUntil || r.generatedUntil < y ? y : r.generatedUntil });
                      void store.generateRecurring();
                    }}
                    aria-label={r.paused ? 'Resume' : 'Pause'}
                  >
                    <Icon name={r.paused ? 'play' : 'pause'} size={13} /> {r.paused ? 'Resume' : 'Pause'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="small-print">
        If the app hasn’t been opened for a while, any missed dates are filled in next time either of you opens it.
        Pausing skips dates that pass while paused.
      </p>
    </>
  );
}
