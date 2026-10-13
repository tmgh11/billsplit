import { useState } from 'react';
import { Icon, PctInput, Seg, Sheet, haptic, primeKeyboard, toast } from './ui';
import { guessCategory } from '../lib/categories';
import { iconFor } from '../lib/icons';
import { fmt, isValidAmount, parseMoney, round2 } from '../lib/money';
import { today } from '../lib/dates';
import { debitSharesPence, incomeTomPct, monthlyPence, ordinal, summariseDebits } from '../lib/debits';
import { newId, store, useStore } from '../lib/store';
import { other, type DebitPeriod, type DebitSplit, type DirectDebit, type Person } from '../lib/types';
import type { SheetState } from '../App';

const wholePounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
/** "52/48", from Tom's share */
const ratio = (tomPct: number) => `${Math.round(tomPct)}/${100 - Math.round(tomPct)}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const pctLabel = (p: number) => `${Math.round(p)}%`;

export function DirectDebitsView({ open }: { open: (s: SheetState) => void }) {
  const { debits, settings, device } = useStore();
  const { names, salaries, baseCurrency: cur } = settings;
  const me = device.me;
  const them = other(me);
  const sum = summariseDebits(debits, salaries);
  const incomePct = incomeTomPct(salaries);
  const money = (pence: number) => fmt(pence / 100, cur);

  // what each of you sends the other, from this phone's point of view
  const toMe = me === 'tom' ? sum.nuriaToTomPence : sum.tomToNuriaPence;
  const fromMe = me === 'tom' ? sum.tomToNuriaPence : sum.nuriaToTomPence;
  const net = toMe - fromMe;
  const sorted = [...debits].sort((a, b) => monthlyPence(b) - monthlyPence(a) || a.description.localeCompare(b.description));

  const add = () => {
    primeKeyboard();
    open({ type: 'debit' });
  };

  return (
    <>
      <div className="card dd-summary">
        <div className="dd-label">Each month</div>
        <div className="dd-flow">
          <span>
            <strong className={them}>{names[them]}</strong> sends you
          </span>
          <strong className="num">{money(toMe)}</strong>
        </div>
        <div className="dd-flow">
          <span>
            You send <strong className={them}>{names[them]}</strong>
          </span>
          <strong className="num">{money(fromMe)}</strong>
        </div>
        {toMe > 0 && fromMe > 0 && (
          <p className="dd-net">
            Or one transfer: {net === 0 ? 'nothing to send' : net > 0 ? `${names[them]} sends you ${money(net)}` : `you send ${names[them]} ${money(-net)}`}
          </p>
        )}
        <div className="dd-totals">
          <div>
            <span className="muted">Bills total</span>
            <strong className="num">{money(sum.totalPence)}</strong>
          </div>
          <div>
            <span className="muted">Your share</span>
            <strong className={`num ${me}`}>{money(sum.sharePence[me])}</strong>
          </div>
          <div>
            <span className="muted">{names[them]}’s share</span>
            <strong className={`num ${them}`}>{money(sum.sharePence[them])}</strong>
          </div>
        </div>
        {sum.missingIncome > 0 && (
          <p className="dd-net" style={{ color: 'var(--danger)' }}>
            {sum.missingIncome === 1 ? '1 bill is' : `${sum.missingIncome} bills are`} split by income — add both salaries below to include{' '}
            {sum.missingIncome === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      <div className="section-title">
        <span>Salaries</span>
        <span className="aside">for bills split by income</span>
      </div>
      <button className="card list dd-salaries" onClick={() => open({ type: 'salaries' })} aria-label="Edit salaries">
        {(['tom', 'nuria'] as Person[]).map((p) => {
          const s = salaries?.[p];
          const pct = incomePct == null ? null : p === 'tom' ? incomePct : 100 - incomePct;
          return (
            <div key={p} className="row">
              <div className="row-main">
                <div className={`row-title ${p}`}>{p === me ? `You (${names[p]})` : names[p]}</div>
                <div className="row-sub">{s ? `${wholePounds.format(s)} a year` : 'Not added yet'}</div>
              </div>
              <div className="row-amt num">
                <div className="main">{pct == null ? '—' : pctLabel(pct)}</div>
              </div>
            </div>
          );
        })}
      </button>
      <p className="small-print">
        {settings.salariesUpdated ? `Updated ${longDate(settings.salariesUpdated)}. ` : ''}Annual, before tax. Tap to
        change.
      </p>

      <div className="section-title">
        <span>Direct debits</span>
        <span className="aside">not added to the ledger</span>
      </div>

      {sorted.length === 0 ? (
        <div className="card empty">
          <div className="big">🏠</div>
          Add the mortgage, council tax and other bills that go out by direct debit. They stay out of the ledger — this just shows
          what each of you sends the other each month.
        </div>
      ) : (
        <div className="card list">
          {sorted.map((d) => (
            <DebitRow key={d.id} d={d} onOpen={() => open({ type: 'debit', debit: d })} />
          ))}
        </div>
      )}
      <button className="btn" style={{ marginTop: 12 }} onClick={add}>
        <Icon name="plus" size={18} /> Add direct debit
      </button>
    </>
  );
}

function DebitRow({ d, onOpen }: { d: DirectDebit; onOpen: () => void }) {
  const { settings, device } = useStore();
  const { names, salaries, baseCurrency: cur } = settings;
  const me = device.me;
  const shares = debitSharesPence(d, salaries);
  const pct = d.split === 'equal' ? 50 : d.split === 'custom' ? d.tomPct : incomeTomPct(salaries);
  const split = d.split === 'equal' ? '50/50' : d.split === 'custom' ? ratio(d.tomPct) : pct == null ? 'By income' : `By income ${ratio(pct)}`;
  const owed = shares ? shares[other(d.paidBy)] / 100 : null;
  const t = today();
  const extra = [
    d.dueDay ? `${ordinal(d.dueDay)} of the month` : null,
    d.period === 'yearly' ? `${fmt(d.amount, cur)} a year` : null,
    d.endDate ? `${d.endDate < t ? 'Ended' : 'Ends'} ${longDate(d.endDate)}` : null,
    d.note || null,
  ].filter(Boolean);
  return (
    <button className="row" onClick={onOpen} aria-label={`Edit ${d.description}`}>
      <div className="cat-ic" style={{ width: 44, height: 44 }}>
        {iconFor(d.description, d.category)}
      </div>
      <div className="row-main">
        <div className="row-title">{d.description}</div>
        <div className="row-sub">
          <span className={d.paidBy}>{d.paidBy === me ? 'You pay' : `${names[d.paidBy]} pays`}</span> · {split}
        </div>
        {extra.length > 0 && (
          <div className="row-sub" style={{ color: d.endDate && d.endDate < t ? 'var(--danger)' : 'var(--text-2)', whiteSpace: 'normal' }}>
            {extra.join(' · ')}
          </div>
        )}
      </div>
      <div className="row-amt num">
        <div className="main">{fmt(monthlyPence(d) / 100, cur)}</div>
        {owed == null ? (
          <div className="eff owe">Add salaries</div>
        ) : owed === 0 ? null : d.paidBy === me ? (
          <div className="eff good">+{fmt(owed, cur)} to you</div>
        ) : (
          <div className="eff owe">{fmt(owed, cur)} from you</div>
        )}
      </div>
    </button>
  );
}

export function DebitForm({ initial, onClose }: { initial?: DirectDebit; onClose: () => void }) {
  const { settings, device } = useStore();
  const { names, salaries, baseCurrency: cur } = settings;
  const me = device.me;
  const them = other(me);
  const isEdit = Boolean(initial);

  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '');
  const [period, setPeriod] = useState<DebitPeriod>(initial?.period ?? 'monthly');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [paidBy, setPaidBy] = useState<Person>(initial?.paidBy ?? me);
  const [split, setSplit] = useState<DebitSplit>(initial?.split ?? 'income');
  const [tomPct, setTomPct] = useState(initial?.tomPct ?? 50);
  const [dueDay, setDueDay] = useState(initial?.dueDay ? String(initial.dueDay) : '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [draftId] = useState(newId);

  const formState = JSON.stringify([amountText, period, description, paidBy, split, tomPct, dueDay, endDate, note]);
  const [openedState] = useState(formState);
  const dirty = formState !== openedState;

  const amount = parseMoney(amountText);
  const valid = isValidAmount(amount) && description.trim().length > 0;
  const incomePct = incomeTomPct(salaries);

  const draft: DirectDebit = {
    ...(initial ?? {}),
    id: initial?.id ?? draftId,
    kind: 'debit',
    description: description.trim(),
    category: initial?.category ?? 'bills',
    amount: isValidAmount(amount) ? round2(amount) : 0,
    period,
    paidBy,
    split,
    tomPct: Math.min(100, Math.max(0, tomPct)),
    dueDay: dueDay ? Number(dueDay) : undefined,
    endDate: endDate || undefined,
    note: note.trim() || undefined,
    updatedAt: 0,
  };
  const shares = debitSharesPence(draft, salaries);
  const owed = shares ? shares[other(paidBy)] / 100 : null;
  const outcome = !valid
    ? null
    : owed == null
      ? 'Add both salaries to split by income'
      : owed === 0
        ? 'No one sends anything'
        : paidBy === me
          ? `${names[them]} sends you ${fmt(owed, cur)} a month`
          : `You send ${names[paidBy]} ${fmt(owed, cur)} a month`;

  const onSave = () => {
    if (!valid) return;
    const category = guessCategory(draft.description, settings.categoryRules) ?? initial?.category ?? 'bills';
    store.put({ ...draft, category });
    haptic();
    toast(isEdit ? 'Saved' : 'Direct debit added');
    onClose();
  };

  const onDelete = () => {
    if (!initial) return;
    const snapshot = store.get(initial.id);
    store.remove(initial.id);
    toast('Direct debit deleted', { label: 'Undo', run: () => snapshot && store.put({ ...snapshot, deleted: false }) }, 8000);
    onClose();
  };

  return (
    <Sheet
      title={isEdit ? 'Edit direct debit' : 'New direct debit'}
      onClose={onClose}
      full
      dirty={dirty}
      discardPrompt={isEdit ? 'Discard your changes?' : 'Discard this direct debit?'}
      footer={
        <div className="btn-row">
          {isEdit && (
            <button type="button" className="btn delete" onClick={onDelete}>
              <Icon name="trash" size={18} /> Delete
            </button>
          )}
          <button className="btn primary save" disabled={!valid} onClick={onSave}>
            <span>{isEdit ? 'Save changes' : 'Add direct debit'}</span>
            {outcome && <span className="save-sub">{outcome}</span>}
          </button>
        </div>
      }
    >
      <div className="amount-entry">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          aria-label="Amount"
          className="num"
          autoFocus={!isEdit}
        />
        <span className="muted" style={{ fontWeight: 650, paddingRight: 8 }}>
          {cur} / {period === 'monthly' ? 'month' : 'year'}
        </span>
      </div>

      <div className="field">
        <Seg
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly', sub: period === 'yearly' && isValidAmount(amount) ? `${fmt(monthlyPence(draft) / 100, cur)} a month` : undefined },
          ]}
          tall={period === 'yearly' && isValidAmount(amount)}
        />
      </div>

      <div className="field">
        <label htmlFor="dd-desc">What is it?</label>
        <input
          id="dd-desc"
          className="input"
          placeholder="e.g. Mortgage, Council tax, Wi-Fi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>

      <div className="field">
        <div className="field-label">Whose account does it come out of?</div>
        <Seg
          value={paidBy}
          onChange={setPaidBy}
          options={[
            { value: me, label: 'Yours', className: me },
            { value: them, label: `${names[them]}’s`, className: them },
          ]}
        />
      </div>

      <div className="field">
        <div className="field-label">How is it split?</div>
        <Seg
          value={split}
          onChange={setSplit}
          tall
          options={[
            { value: 'income', label: 'By income', sub: incomePct == null ? 'no salaries' : ratio(incomePct) },
            { value: 'equal', label: '50/50', sub: 'equal' },
            { value: 'custom', label: 'Custom', sub: split === 'custom' ? ratio(tomPct) : 'fixed %' },
          ]}
        />
        {split === 'income' && (
          <p className="small-print">
            {incomePct == null
              ? 'Add both salaries on the Direct debits screen. Until then this bill isn’t shared.'
              : `${names.tom} ${pctLabel(incomePct)}, ${names.nuria} ${pctLabel(100 - incomePct)}. Follows your salaries, so it updates when either changes.`}
          </p>
        )}
        {split === 'custom' && (
          <div className="card pad" style={{ marginTop: 10, padding: 14 }}>
            <div className="inline" style={{ alignItems: 'center', marginBottom: 6 }}>
              <label className="tom" style={{ fontWeight: 650, fontSize: 14 }}>
                {names.tom} <PctInput value={tomPct} onChange={setTomPct} label={`${names.tom} percent`} /> %
              </label>
              <label className="nuria" style={{ fontWeight: 650, fontSize: 14, textAlign: 'right' }}>
                <PctInput value={100 - tomPct} onChange={(p) => setTomPct(100 - p)} label={`${names.nuria} percent`} /> %{' '}
                {names.nuria}
              </label>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={100}
              step={5}
              value={tomPct}
              onChange={(e) => setTomPct(Number(e.target.value))}
              aria-label="Split percentage"
            />
          </div>
        )}
        {shares && valid && (
          <div className="inline text-2 num" style={{ fontSize: 13, marginTop: 8, padding: '0 2px' }}>
            <span className="tom">
              {names.tom} {fmt(shares.tom / 100, cur)}
            </span>
            <span className="nuria" style={{ textAlign: 'right' }}>
              {names.nuria} {fmt(shares.nuria / 100, cur)}
            </span>
          </div>
        )}
      </div>

      <div className="field inline">
        <div>
          <label className="field-label" htmlFor="dd-day">
            Goes out on
          </label>
          <select id="dd-day" className="input" value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
            <option value="">Not sure</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {ordinal(n)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="dd-end">
            Contract ends
          </label>
          <input id="dd-end" type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="dd-note">Note (optional)</label>
        <input id="dd-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 18-month deal, fixed rate" />
      </div>
    </Sheet>
  );
}

export function SalariesForm({ onClose }: { onClose: () => void }) {
  const { settings } = useStore();
  const { names, salaries } = settings;
  const [text, setText] = useState<Record<Person, string>>({
    tom: salaries?.tom ? String(salaries.tom) : '',
    nuria: salaries?.nuria ? String(salaries.nuria) : '',
  });
  const [openedState] = useState(JSON.stringify(text));
  const dirty = JSON.stringify(text) !== openedState;
  const parsed = (p: Person) => {
    const v = parseMoney(text[p]);
    return Number.isFinite(v) && v > 0 ? round2(v) : undefined;
  };
  const next = { tom: parsed('tom'), nuria: parsed('nuria') };
  const bad = (['tom', 'nuria'] as Person[]).some((p) => text[p].trim() && next[p] === undefined);
  const pct = incomeTomPct(next);

  const onSave = () => {
    if (bad) return;
    store.updateSettings({ salaries: next, salariesUpdated: today() });
    haptic();
    toast('Salaries saved');
    onClose();
  };

  return (
    <Sheet
      title="Salaries"
      onClose={onClose}
      dirty={dirty}
      footer={
        <button className="btn primary save" disabled={bad || !dirty} onClick={onSave}>
          <span>Save</span>
          {pct != null && (
            <span className="save-sub">
              Split by income: {names.tom} {pctLabel(pct)} · {names.nuria} {pctLabel(100 - pct)}
            </span>
          )}
        </button>
      }
    >
      {(['tom', 'nuria'] as Person[]).map((p) => (
        <div className="field" key={p}>
          <label htmlFor={`sal-${p}`} className={p}>
            {names[p]}’s salary
          </label>
          <input
            id={`sal-${p}`}
            className="input num"
            inputMode="decimal"
            placeholder="per year, before tax"
            value={text[p]}
            onChange={(e) => setText((t) => ({ ...t, [p]: e.target.value }))}
          />
        </div>
      ))}
      <p className="small-print">Both of you can see these. Bills split by income follow the ratio of the two.</p>
    </Sheet>
  );
}
