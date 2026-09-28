import { useEffect, useMemo, useState } from 'react';
import { DateHint, Icon, Seg, Sheet, Toggle, haptic, toast } from './ui';
import { CATEGORIES, categoryById, guessCategory, learnRule } from '../lib/categories';
import { CURRENCIES, CURRENCY_FLAGS, rateToBase } from '../lib/fx';
import { baseAmount, fmt, hasOddPenny, isValidAmount, parseMoney, pctForSplit, round2, shares } from '../lib/money';
import { addDays, isISODate, today } from '../lib/dates';
import {
  addedUntil,
  describeFrequency,
  movedOccurrences,
  nextOccurrence,
  occurrenceId,
  scheduleChanged,
  scheduleClashes,
  type Clash,
} from '../lib/recurring';
import { newId, store, useStore } from '../lib/store';
import { other, type Expense, type Frequency, type Person, type Recurring, type SplitMode } from '../lib/types';
import { prettyDate } from '../lib/dates';

type Props =
  | { mode: 'expense'; initial?: Expense; onClose: () => void; /** switch to scanning a receipt instead */ onScan?: () => void }
  | { mode: 'recurring'; initial?: Recurring; onClose: () => void };

const FREQS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: '2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'dates', label: 'Set dates' },
];

export function ExpenseForm(props: Props) {
  const { settings, device } = useStore();
  const names = settings.names;
  const base = settings.baseCurrency;
  const init = props.initial;
  const isEdit = Boolean(init);
  const isRecurring = props.mode === 'recurring';

  const [amountText, setAmountText] = useState(init ? String(init.amount) : '');
  const [currency, setCurrency] = useState(init?.currency ?? base);
  const [rate, setRate] = useState<number | null>(init && 'rate' in init ? init.rate : currency === base ? 1 : null);
  const [rateText, setRateText] = useState('');
  const [description, setDescription] = useState(init?.description ?? '');
  const [category, setCategory] = useState(init?.category ?? 'other');
  const [catTouched, setCatTouched] = useState(isEdit);
  const [showCats, setShowCats] = useState(false);
  const [paidBy, setPaidBy] = useState<Person>(init?.paidBy ?? device.me);
  const [split, setSplit] = useState<SplitMode>(init?.split ?? 'equal');
  const [tomPct, setTomPct] = useState(init ? pctForSplit(init.split, init.tomPct) : 50);
  const [date, setDate] = useState(init && 'date' in init ? init.date : today());
  const [note, setNote] = useState((init && 'note' in init && init.note) || '');
  const me = device.me;
  const them = other(me);
  // "When?": today and yesterday are one tap; any other day shows the date picker
  const todayISO = today();
  const yesterdayISO = addDays(todayISO, -1);
  const [otherDay, setOtherDay] = useState(date !== todayISO && date !== yesterdayISO);
  const when = otherDay ? 'other' : date === todayISO ? 'today' : 'yesterday';
  // note and repeat are folded away until asked for (or already in use)
  const [showMore, setShowMore] = useState(Boolean(note));

  const recInit = isRecurring ? (init as Recurring | undefined) : undefined;
  const [repeat, setRepeat] = useState(isRecurring);
  const [frequency, setFrequency] = useState<Frequency>(recInit?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(recInit?.startDate ?? today());
  const [endDate, setEndDate] = useState(recInit?.endDate ?? '');
  const [dates, setDates] = useState<string[]>(recInit?.dates ?? []);
  const [newDate, setNewDate] = useState('');
  /** set when saving a schedule change would add a second occurrence in a period; asks what to do */
  const [clashes, setClashes] = useState<Clash[] | null>(null);
  useEffect(() => setClashes(null), [frequency, startDate, dates]);

  /** id for a new entry, fixed when the sheet opens so a double tap on Save can't add it twice */
  const [draftId] = useState(newId);

  // Has anything been entered or changed since the sheet opened? Closing then asks first.
  const formState = JSON.stringify([amountText, currency, description, paidBy, split, tomPct, date, note, repeat, frequency, startDate, endDate, dates]);
  const [openedState] = useState(formState);
  const dirty = formState !== openedState;

  const amount = parseMoney(amountText);
  // iOS's date picker has a Reset button that leaves the field empty
  const dateOk = isRecurring ? frequency === 'dates' || isISODate(startDate) : isISODate(date);
  const valid =
    isValidAmount(amount) && description.trim().length > 0 && dateOk && (!repeat || frequency !== 'dates' || dates.length > 0);

  // auto-category from the description until the user picks one
  useEffect(() => {
    if (catTouched) return;
    const g = guessCategory(description, settings.categoryRules);
    setCategory(g ?? 'other');
  }, [description, catTouched, settings.categoryRules]);

  // exchange rate when currency changes
  useEffect(() => {
    if (currency === base) {
      setRate(1);
      return;
    }
    // back to the expense's own currency: restore the rate it was saved with
    if (init && 'rate' in init && init.currency === currency) {
      setRate(init.rate);
      return;
    }
    let live = true;
    setRate(null);
    rateToBase(currency, base).then((r) => live && setRate(r));
    return () => {
      live = false;
    };
  }, [currency, base, init]);

  useEffect(() => {
    if (rate) setRateText(String(round2(rate * 10000) / 10000));
  }, [rate]);

  const effPct = pctForSplit(split, tomPct);
  // The preview uses the same maths and id the saved expense will, so it shows the exact pence
  // (including who gets an odd penny). A new repeating expense's first entry has its own id.
  const previewId = init?.id ?? (repeat && !isRecurring ? occurrenceId(draftId, date) : draftId);
  const preview = { id: previewId, amount: isValidAmount(amount) ? round2(amount) : 0, rate: rate ?? 0, split, tomPct: effPct };
  const baseTotal = baseAmount(preview);
  const { tom: tomShare, nuria: nuriaShare } = shares(preview);
  const owed = paidBy === 'tom' ? nuriaShare : tomShare;
  const debtor: Person = paidBy === 'tom' ? 'nuria' : 'tom';
  // each repeat has its own id, so a half-penny split alternates who pays the odd penny
  const oddPennyVaries = isRecurring && hasOddPenny(preview);

  // What saving will do, shown on the Save button so it can't be missed (or hidden by the keyboard).
  const outcome = !baseTotal
    ? null
    : owed === 0
      ? 'No one owes anything'
      : (debtor === me ? `You owe ${names[paidBy]} ${fmt(owed, base)}` : `${names[debtor]} owes you ${fmt(owed, base)}`) +
        (oddPennyVaries ? ' (± the odd penny)' : '');

  const splitOptions = useMemo(
    () => [
      { value: 'equal' as const, label: '50/50' },
      { value: me as SplitMode, label: 'Mine', className: me },
      { value: them as SplitMode, label: `${names[them]}’s`, className: them },
      { value: 'custom' as const, label: 'Custom' },
    ],
    [names, me, them],
  );

  // learn the category the user chose for this description
  const learnCategory = () => {
    const guessed = guessCategory(description);
    if (catTouched && category !== guessed) {
      store.updateSettings({ categoryRules: { ...settings.categoryRules, ...learnRule(description, category) } });
    }
  };

  /** `clashAnswer`: what to do about occurrences a schedule change would double up (see below). */
  const onSave = (clashAnswer?: 'move' | 'keep') => {
    if (!valid) return;
    const r = rate ?? parseMoney(rateText);
    if (!isRecurring && (!r || !Number.isFinite(r))) {
      toast('Enter an exchange rate first');
      return;
    }
    const common = {
      description: description.trim(),
      category,
      amount: round2(amount),
      currency,
      paidBy,
      split,
      tomPct: effPct,
    };
    if (isRecurring || (repeat && !isEdit)) {
      const recId = recInit?.id ?? draftId;
      const anchor = isRecurring ? startDate : date;
      const rec: Recurring = {
        ...(recInit ?? {}),
        ...common,
        id: recId,
        kind: 'recurring',
        frequency,
        startDate: frequency === 'dates' ? [...dates].sort()[0] ?? anchor : anchor,
        dates: frequency === 'dates' ? [...dates].sort() : undefined,
        endDate: endDate || undefined,
        // editing: don't back-fill anything before what's already in the ledger
        generatedUntil: recInit ? addedUntil(recInit, store.all()) : undefined,
        updatedAt: 0,
      };
      // Schedule moved (e.g. 1st → 15th) after this period's was already added: ask first.
      let moves: Clash[] = [];
      if (recInit && scheduleChanged(recInit, rec)) {
        moves = scheduleClashes(rec, store.all());
        if (moves.length && !clashAnswer) return setClashes(moves);
        if (clashAnswer === 'keep') moves = [];
      }
      learnCategory();
      if (!isRecurring) {
        // Adding a new expense that also repeats: log today's one now, schedule the rest.
        rec.generatedUntil = date;
        store.put(rec, {
          ...common, id: occurrenceId(recId, date), kind: 'expense', date, rate: r!, recurringId: recId,
          note: note || undefined, createdBy: device.me, updatedAt: 0,
        });
        toast('Added, and set to repeat');
      } else {
        store.put(rec, ...movedOccurrences(moves));
        void store.generateRecurring();
        const next = nextOccurrence(rec, today(), (id) => store.has(id));
        toast(
          moves.length === 1 ? `Saved · moved to ${prettyDate(moves[0].to)}` : next ? `Saved · next on ${prettyDate(next)}` : 'Saved',
        );
      }
    } else {
      learnCategory();
      const e: Expense = {
        ...(init as Expense | undefined),
        ...common,
        id: init?.id ?? draftId,
        kind: 'expense',
        date,
        rate: r!,
        note: note.trim() || undefined,
        createdBy: (init as Expense | undefined)?.createdBy ?? device.me,
        updatedAt: 0,
      };
      store.put(e);
      toast(isEdit ? 'Saved' : 'Expense added');
    }
    haptic();
    props.onClose();
  };

  const onDelete = () => {
    if (!init) return;
    const snapshot = store.get(init.id);
    store.remove(init.id);
    toast(
      isRecurring ? 'Repeating expense deleted' : 'Expense deleted',
      { label: 'Undo', run: () => snapshot && store.put({ ...snapshot, deleted: false }) },
      8000,
    );
    props.onClose();
  };

  const cat = categoryById(category);
  const title = isRecurring ? (isEdit ? 'Edit repeating expense' : 'New repeating expense') : isEdit ? 'Edit expense' : 'Add expense';

  return (
    <Sheet
      title={title}
      onClose={props.onClose}
      full
      dirty={dirty}
      discardPrompt={isEdit ? 'Discard your changes?' : isRecurring ? 'Discard this repeating expense?' : 'Discard this expense?'}
      headerAction={
        !isEdit && props.mode === 'expense' && props.onScan ? (
          <button type="button" className="btn small head-action" onClick={props.onScan}>
            <Icon name="camera" size={18} /> Scan receipt
          </button>
        ) : undefined
      }
      footer={
        clashes ? (
          <div role="alertdialog" aria-labelledby="clash-q">
            <p id="clash-q" style={{ margin: '0 0 12px', fontSize: 15 }}>
              {clashes.length === 1 ? (
                <>
                  <strong>{description.trim()}</strong> was already {clashes[0].from.deleted ? 'added and deleted' : 'added'} on{' '}
                  <strong>{prettyDate(clashes[0].from.date)}</strong>. Move it to <strong>{prettyDate(clashes[0].to)}</strong>, or keep
                  both?
                </>
              ) : (
                <>
                  The new schedule adds dates in periods that already have one. Move these, or keep both?
                  {clashes.map((c) => (
                    <span key={c.from.id} style={{ display: 'block', marginTop: 4 }}>
                      {prettyDate(c.from.date)}
                      {c.from.deleted ? ' (deleted)' : ''} → {prettyDate(c.to)}
                    </span>
                  ))}
                </>
              )}
            </p>
            <div className="btn-row">
              <button className="btn" style={{ width: 'auto' }} onClick={() => setClashes(null)}>
                Back
              </button>
              <button className="btn" onClick={() => onSave('keep')}>
                Keep both
              </button>
              <button className="btn primary" onClick={() => onSave('move')}>
                {clashes.length === 1 ? 'Move it' : 'Move them'}
              </button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            {isEdit && (
              // labelled and full height, so it's never mistaken for Save (and Undo is offered)
              <button type="button" className="btn delete" onClick={onDelete}>
                <Icon name="trash" size={18} /> Delete
              </button>
            )}
            <button className="btn primary save" disabled={!valid} onClick={() => onSave()}>
              <span>
                {isEdit
                  ? 'Save changes'
                  : isRecurring || repeat
                    ? 'Save & schedule'
                    : isValidAmount(amount)
                      ? `Add ${fmt(round2(amount), currency)}`
                      : 'Add expense'}
              </span>
              {valid && outcome && <span className="save-sub">{outcome}</span>}
            </button>
          </div>
        )
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
        <select className="cur-select" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {CURRENCY_FLAGS[c] ?? ''} {c}
            </option>
          ))}
        </select>
      </div>

      {currency !== base && (
        <div className="field">
          <div className="note" style={{ justifyContent: 'space-between' }}>
            <span>
              1 {currency} ={' '}
              <input
                className="num"
                inputMode="decimal"
                value={rateText}
                onChange={(e) => {
                  setRateText(e.target.value);
                  const v = parseMoney(e.target.value);
                  if (v > 0) setRate(v);
                }}
                placeholder={rate === null ? 'loading…' : ''}
                style={{ width: 80, border: 0, background: 'transparent', fontWeight: 700, outline: 'none' }}
                aria-label="Exchange rate"
              />{' '}
              {base}
            </span>
            {baseTotal > 0 && <strong className="num">≈ {fmt(baseTotal, base)}</strong>}
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="desc">What was it?</label>
        <input
          id="desc"
          className="input"
          placeholder="e.g. Tesco, Council tax, Flights"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
        />
        {!isEdit && settings.shortcuts.length > 0 && (
          <div className="shortcuts" role="group" aria-label="Shortcuts">
            {settings.shortcuts.map((s) => {
              const on = description.trim().toLowerCase() === s.toLowerCase();
              return (
                <button key={s} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setDescription(s)}>
                  {s}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="field">
        <div className="field-label">Category</div>
        <button type="button" className="chip" onClick={() => setShowCats((s) => !s)} aria-expanded={showCats}>
          <span>{cat.emoji}</span> {cat.label}
          <span className="muted" style={{ fontWeight: 500 }}>
            {catTouched ? '' : '· auto'}
          </span>
          <Icon name={showCats ? 'left' : 'right'} size={14} />
        </button>
        {showCats && (
          <div className="cat-grid" style={{ marginTop: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === category ? 'on' : ''}
                onClick={() => {
                  setCategory(c.id);
                  setCatTouched(true);
                  setShowCats(false);
                }}
              >
                <span>{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <div className="field-label">Who paid?</div>
        <Seg
          value={paidBy}
          onChange={setPaidBy}
          options={[
            { value: me, label: 'You', className: me },
            { value: them, label: names[them], className: them },
          ]}
        />
      </div>

      <div className="field">
        <div className="field-label">Whose cost is it?</div>
        <Seg value={split} onChange={setSplit} options={splitOptions} />
        {split === 'custom' && (
          <div className="card pad" style={{ marginTop: 10, padding: 14 }}>
            <div className="inline" style={{ alignItems: 'center', marginBottom: 6 }}>
              <label className="tom" style={{ fontWeight: 650, fontSize: 14 }}>
                {names.tom} <PctInput value={tomPct} onChange={setTomPct} label={`${names.tom} percent`} /> %
              </label>
              <label className="nuria" style={{ fontWeight: 650, fontSize: 14, textAlign: 'right' }}>
                <PctInput value={100 - tomPct} onChange={(p) => setTomPct(100 - p)} label={`${names.nuria} percent`} />{' '}
                % {names.nuria}
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
            {baseTotal > 0 && (
              <div className="inline text-2 num" style={{ fontSize: 13 }}>
                <span>{fmt(tomShare, base)}</span>
                <span style={{ textAlign: 'right' }}>{fmt(nuriaShare, base)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {!isRecurring && (
        <div className="field">
          <div className="field-label">When?</div>
          <Seg
            value={when}
            onChange={(v) => {
              setOtherDay(v === 'other');
              if (v === 'today') setDate(todayISO);
              if (v === 'yesterday') setDate(yesterdayISO);
            }}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'other', label: when === 'other' && isISODate(date) ? prettyDate(date) : 'Other day' },
            ]}
          />
          {when === 'other' && (
            <>
              <input
                id="date"
                type="date"
                className="input"
                style={{ marginTop: 8 }}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Date"
              />
              <DateHint value={date} />
            </>
          )}
        </div>
      )}

      {!isRecurring && !showMore && (
        <button type="button" className="btn small link-btn" onClick={() => setShowMore(true)}>
          {isEdit ? 'Add a note' : 'Add a note or repeat…'}
        </button>
      )}

      {!isRecurring && !isEdit && showMore && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16 }}>
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Repeat this expense</div>
              <div className="muted" style={{ fontSize: 13 }}>Adds it automatically on a schedule</div>
            </div>
            <Toggle checked={repeat} onChange={setRepeat} label="Repeat" />
          </div>
        </div>
      )}

      {repeat && (
        <div className="field">
          <div className="field-label">How often?</div>
          <div className="filters" style={{ margin: '0 0 12px', padding: 0, flexWrap: 'wrap' }}>
            {FREQS.map((f) => (
              <button key={f.value} type="button" className={`chip ${frequency === f.value ? 'on' : ''}`} onClick={() => setFrequency(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {frequency === 'dates' ? (
            <div>
              <div className="inline">
                <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Add a date" />
                <button
                  type="button"
                  className="btn small"
                  style={{ flex: 'none', minHeight: 50 }}
                  disabled={!newDate}
                  onClick={() => {
                    setDates((d) => [...new Set([...d, newDate])].sort());
                    setNewDate('');
                  }}
                >
                  Add date
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {dates.map((d) => (
                  <button key={d} type="button" className="chip" onClick={() => setDates((x) => x.filter((y) => y !== d))}>
                    {prettyDate(d)} <Icon name="close" size={14} />
                  </button>
                ))}
                {!dates.length && <span className="muted" style={{ fontSize: 13 }}>Add each date it’s due (e.g. council tax instalments).</span>}
              </div>
            </div>
          ) : (
            <div className="inline">
              {isRecurring && (
                <div>
                  <label className="field-label" htmlFor="start">
                    First / next date
                  </label>
                  <input id="start" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  <DateHint value={startDate} />
                </div>
              )}
              <div>
                <label className="field-label" htmlFor="end">
                  Ends (optional)
                </label>
                <input id="end" type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          )}
          {frequency !== 'dates' && (
            <p className="small-print">
              {describeFrequency({ frequency, startDate: isRecurring ? startDate : date } as Recurring)}, starting{' '}
              {prettyDate(isRecurring ? startDate : date).toLowerCase()}.
            </p>
          )}
        </div>
      )}

      {!isRecurring && showMore && (
        <div className="field">
          <label htmlFor="note">Note (optional)</label>
          <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to remember" />
        </div>
      )}

      {init && 'items' in init && init.items?.length ? (
        <details className="card" style={{ padding: '12px 14px' }}>
          <summary style={{ fontWeight: 600 }}>{init.items.length} receipt items</summary>
          {init.items.map((i) => (
            <div key={i.id} className="inline" style={{ fontSize: 14, padding: '6px 0' }}>
              <span>{i.name}</span>
              <span className={`num ${i.owner === 'shared' ? 'text-2' : i.owner}`} style={{ textAlign: 'right' }}>
                {i.owner === 'shared' ? 'Shared' : names[i.owner]} · {fmt(i.price, init.currency)}
              </span>
            </div>
          ))}
        </details>
      ) : null}
    </Sheet>
  );
}

/**
 * A 0–100 percentage box. While you're typing it shows exactly what you typed (so "33." or "33,5"
 * isn't snapped back to "33"), and applies the number as you go; leaving it tidies the text.
 */
function PctInput({ value, onChange, label }: { value: number; onChange: (pct: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input num"
      inputMode="decimal"
      value={draft ?? String(round2(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseMoney(e.target.value);
        onChange(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
      }}
      onBlur={() => setDraft(null)}
      style={{ width: 70, minHeight: 44, padding: '6px 8px', display: 'inline-block' }}
      aria-label={label}
    />
  );
}
