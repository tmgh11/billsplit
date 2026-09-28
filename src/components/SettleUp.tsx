import { useEffect, useState } from 'react';
import { DateHint, Icon, Sheet, haptic, toast } from './ui';
import { balance, basePence, describeBalance, fmt, isValidAmount, parseMoney, round2, toPence } from '../lib/money';
import { isISODate, today } from '../lib/dates';
import { newId, store, useStore } from '../lib/store';
import { CURRENCIES, CURRENCY_FLAGS, rateToBase } from '../lib/fx';
import type { Person, Settlement } from '../lib/types';

export function SettleUp({ initial, onClose }: { initial?: Settlement; onClose: () => void }) {
  const { expenses, settlements, settings, device } = useStore();
  const base = settings.baseCurrency;
  const names = settings.names;
  const owing = describeBalance(balance(expenses, settlements.filter((s) => s.id !== initial?.id)));

  const [from, setFrom] = useState<Person>(initial?.from ?? owing?.debtor ?? device.me);
  const to: Person = from === 'tom' ? 'nuria' : 'tom';
  const fullAmount = owing && owing.debtor === from ? owing.amount : 0;
  const [currency, setCurrency] = useState(initial?.currency ?? base);
  const [rate, setRate] = useState<number | null>(initial?.rate ?? 1);
  const [amountText, setAmountText] = useState(
    initial ? String(initial.amount) : fullAmount ? fullAmount.toFixed(2) : '',
  );
  const [date, setDate] = useState(initial?.date ?? today());
  const [note, setNote] = useState(initial?.note ?? '');

  /** id for a new settle up, fixed when the sheet opens so a double tap can't record it twice */
  const [draftId] = useState(newId);

  useEffect(() => {
    if (currency === base) return setRate(1);
    // back to the settle up's own currency: restore the rate it was saved with
    if (initial && initial.currency === currency) return setRate(initial.rate);
    let live = true;
    setRate(null);
    rateToBase(currency, base).then((r) => live && setRate(r));
    return () => {
      live = false; // a slower lookup for a currency no longer picked mustn't overwrite the rate
    };
  }, [currency, base, initial]);

  const amount = parseMoney(amountText);
  const valid = isValidAmount(amount) && rate != null && isISODate(date);
  // worked out in pence, exactly as the balance will count it
  const inBase = valid ? basePence({ amount: round2(amount), rate: rate! }) : 0;
  const owed = owing ? toPence(owing.amount) : 0;
  const remaining = (owing ? (owing.debtor === from ? owed - inBase : -(owed + inBase)) : -inBase) / 100;

  const setPortion = (f: number) => {
    const inCur = rate ? (fullAmount * f) / rate : 0;
    setAmountText(round2(inCur).toFixed(2));
  };

  const save = () => {
    if (!valid) return;
    const s: Settlement = {
      id: initial?.id ?? draftId,
      kind: 'settlement',
      date,
      from,
      to,
      amount: round2(amount),
      currency,
      rate: rate!,
      note: note.trim() || undefined,
      createdBy: initial?.createdBy ?? device.me,
      updatedAt: 0,
    };
    store.put(s);
    haptic();
    toast(Math.abs(remaining) < 0.005 ? 'All settled up 🎉' : 'Settle up recorded');
    onClose();
  };

  const remove = () => {
    if (!initial) return;
    store.remove(initial.id);
    toast('Settle up deleted', { label: 'Undo', run: () => store.put({ ...initial, deleted: false }) }, 8000);
    onClose();
  };

  return (
    <Sheet
      title={initial ? 'Edit settle up' : 'Settle up'}
      onClose={onClose}
      headerAction={
        initial && (
          // away from Save, so a one-handed tap can't delete by mistake (and Undo is offered)
          <button type="button" className="btn small head-action delete" onClick={remove}>
            <Icon name="trash" size={18} /> Delete
          </button>
        )
      }
      footer={
        <button className="btn good" disabled={!valid} onClick={save}>
          <Icon name="check" size={20} /> {initial ? 'Save changes' : 'Settle up'}
        </button>
      }
    >
      <div className="note" style={{ marginBottom: 16 }}>
        {owing ? (
          <span>
            <strong className={owing.debtor}>{names[owing.debtor]}</strong> owes{' '}
            <strong className={owing.creditor}>{names[owing.creditor]}</strong> <strong>{fmt(owing.amount, base)}</strong>
          </span>
        ) : (
          <span>You’re all square right now.</span>
        )}
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 13 }}>From</div>
          <div className={from} style={{ fontWeight: 700, fontSize: 18 }}>{names[from]}</div>
        </div>
        <button className="icon-btn" style={{ marginTop: 0 }} onClick={() => setFrom(to)} aria-label="Swap direction">
          <Icon name="arrows" size={18} />
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 13 }}>To</div>
          <div className={to} style={{ fontWeight: 700, fontSize: 18 }}>{names[to]}</div>
        </div>
      </div>

      <div className="field-label">How much was transferred?</div>
      <div className="amount-entry">
        <input
          inputMode="decimal"
          placeholder="0.00"
          className="num"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          aria-label="Amount transferred"
        />
        <select className="cur-select" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {CURRENCY_FLAGS[c] ?? ''} {c}
            </option>
          ))}
        </select>
      </div>

      {fullAmount > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: -6, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => setPortion(1)}>Full amount</button>
          <button className="chip" onClick={() => setPortion(0.5)}>Half</button>
          <button className="chip" onClick={() => setPortion(0.25)}>Quarter</button>
        </div>
      )}

      {valid && (
        <div className={`note ${Math.abs(remaining) < 0.005 ? 'good' : ''}`} style={{ marginBottom: 16 }}>
          {Math.abs(remaining) < 0.005 ? (
            <span>This settles everything. 🎉</span>
          ) : remaining > 0 ? (
            <span>
              <strong className={from}>{names[from]}</strong> will still owe <strong className={to}>{names[to]}</strong> <strong>{fmt(remaining, base)}</strong>
            </span>
          ) : (
            <span>
              Afterwards <strong className={to}>{names[to]}</strong> will owe <strong className={from}>{names[from]}</strong> <strong>{fmt(-remaining, base)}</strong>
            </span>
          )}
        </div>
      )}

      <div className="inline">
        <div className="field">
          <label htmlFor="sdate">Date</label>
          <input id="sdate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <DateHint value={date} />
        </div>
        <div className="field">
          <label htmlFor="snote">Note</label>
          <input id="snote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bank transfer" />
        </div>
      </div>
    </Sheet>
  );
}
