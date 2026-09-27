import { useEffect, useRef, useState } from 'react';
import { Icon, Seg, Sheet, haptic, toast } from './ui';
import { parseReceiptText, receiptTotals, recogniseReceipt } from '../lib/receipt';
import { fmt, parseMoney, round2 } from '../lib/money';
import { today } from '../lib/dates';
import { CATEGORIES, guessCategory } from '../lib/categories';
import { CURRENCIES, CURRENCY_FLAGS, rateToBase } from '../lib/fx';
import { newId, store, useStore } from '../lib/store';
import type { Expense, Owner, Person, ReceiptItem } from '../lib/types';

type Stage = 'pick' | 'reading' | 'review';
const uid = () => Math.random().toString(36).slice(2, 10);

export function ReceiptScan({ onClose }: { onClose: () => void }) {
  const { settings, device } = useStore();
  const names = settings.names;
  const base = settings.baseCurrency;
  const fileRef = useRef<HTMLInputElement>(null); // photo library
  const cameraRef = useRef<HTMLInputElement>(null); // opens the camera directly

  const [stage, setStage] = useState<Stage>('pick');
  const [progress, setProgress] = useState({ p: 0, label: '' });
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [merchant, setMerchant] = useState('');
  const [printedTotal, setPrintedTotal] = useState<number | null>(null);
  const [paidBy, setPaidBy] = useState<Person>(device.me);
  const [currency, setCurrency] = useState(base);
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState('groceries');

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setStage('reading');
    try {
      const text = await recogniseReceipt(file, (p, label) => setProgress({ p, label }));
      const parsed = parseReceiptText(text);
      setItems(parsed.items);
      setPriceText(Object.fromEntries(parsed.items.map((i) => [i.id, i.price.toFixed(2)])));
      setMerchant(parsed.merchant);
      setPrintedTotal(parsed.printedTotal);
      if (parsed.merchant) setCategory(guessCategory(parsed.merchant, settings.categoryRules) ?? 'groceries');
      setStage('review');
      if (!parsed.items.length) toast('Couldn’t find any prices — add the items by hand', undefined, 5000);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      toast(`Scan failed: ${msg.slice(0, 140)}`, undefined, 8000);
      setStage('pick');
    }
  };

  const update = (id: string, patch: Partial<ReceiptItem>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const setOwner = (id: string, owner: Owner) => {
    haptic();
    update(id, { owner });
  };

  const addRow = () => {
    const id = uid();
    setItems((l) => [...l, { id, name: '', price: 0, owner: 'shared' }]);
    setPriceText((p) => ({ ...p, [id]: '' }));
  };

  const t = receiptTotals(items);
  const owed = paidBy === 'tom' ? t.nuriaShare : t.tomShare;
  const debtor: Person = paidBy === 'tom' ? 'nuria' : 'tom';
  const mismatch = printedTotal != null && Math.abs(printedTotal - t.total) > 0.009;
  const allTo = (owner: Owner) => {
    haptic();
    setItems((l) => l.map((i) => ({ ...i, owner })));
  };

  const addToLedger = async () => {
    if (t.total <= 0) return;
    const rate = await rateToBase(currency, base);
    if (rate == null) {
      toast('No exchange rate available offline');
      return;
    }
    const tomPct = t.total ? (t.tomShare / t.total) * 100 : 50;
    const split = Math.abs(tomPct - 50) < 1e-9 ? 'equal' : tomPct >= 100 - 1e-9 ? 'tom' : tomPct <= 1e-9 ? 'nuria' : 'custom';
    const e: Expense = {
      id: newId(),
      kind: 'expense',
      date,
      description: merchant.trim() || 'Receipt',
      category,
      amount: t.total,
      currency,
      rate,
      paidBy,
      split,
      tomPct,
      items: items.filter((i) => i.name || i.price).map((i) => ({ ...i, price: round2(i.price) })),
      createdBy: device.me,
      updatedAt: 0,
    };
    store.put(e);
    haptic();
    toast(`Added ${fmt(t.total, currency)} receipt`);
    onClose();
  };

  return (
    <Sheet
      title="Scan receipt"
      onClose={onClose}
      full
      footer={
        stage === 'review' ? (
          <>
            <div className="totals num">
              <div className="t-tom">
                {names.tom} pays<strong>{fmt(t.tomShare, currency)}</strong>
              </div>
              <div className="t-nuria">
                {names.nuria} pays<strong>{fmt(t.nuriaShare, currency)}</strong>
              </div>
              <div>
                Total<strong>{fmt(t.total, currency)}</strong>
              </div>
            </div>
            <button className="btn primary" disabled={t.total <= 0} onClick={addToLedger}>
              Add to ledger{owed >= 0.005 ? ` · ${names[debtor]} owes ${fmt(owed, currency)}` : ''}
            </button>
          </>
        ) : undefined
      }
    >
      {[fileRef, cameraRef].map((ref, i) => (
        <input
          key={i}
          ref={ref}
          type="file"
          accept="image/*"
          {...(ref === cameraRef ? { capture: 'environment' as const } : {})}
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      ))}

      {stage === 'pick' && (
        <>
          <button className="dropzone" style={{ width: '100%' }} onClick={() => cameraRef.current?.click()}>
            <div className="action primary" style={{ minHeight: 0, width: 64, height: 64, borderRadius: 20, padding: 0 }}>
              <Icon name="camera" size={28} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)' }}>Take photo</div>
            <div style={{ fontSize: 14 }}>Lay the receipt flat, fill the frame, good light. Everything is read on your phone — nothing is uploaded.</div>
          </button>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Choose from photos
          </button>
          <button className="btn" style={{ marginTop: 10, background: 'transparent', color: 'var(--text-2)' }} onClick={() => { setStage('review'); addRow(); }}>
            Or enter items by hand
          </button>
        </>
      )}

      {stage === 'reading' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          {preview && (
            <img src={preview} alt="" style={{ maxHeight: 220, maxWidth: '100%', borderRadius: 14, opacity: 0.8, marginBottom: 18 }} />
          )}
          <div className="progress" aria-label="Scanning progress">
            <div style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <p className="text-2">{progress.label || 'Starting'}… {Math.round(progress.p * 100)}%</p>
          <p className="small-print">The first scan downloads the reader (~3 MB); after that it’s quicker and works offline.</p>
        </div>
      )}

      {stage === 'review' && (
        <>
          <div className="field">
            <label htmlFor="merchant">Shop</label>
            <input id="merchant" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Tesco" />
          </div>
          <div className="field">
            <div className="field-label">Paid by</div>
            <Seg
              value={paidBy}
              onChange={setPaidBy}
              options={[
                { value: 'tom', label: names.tom, className: 'tom' },
                { value: 'nuria', label: names.nuria, className: 'nuria' },
              ]}
            />
          </div>

          <div className="section-title" style={{ marginTop: 18 }}>
            <span>{items.length} items</span>
            <span className="aside" style={{ display: 'flex', gap: 6 }}>
              <span className="muted">All:</span>
              <button className="tom" style={{ fontWeight: 650 }} onClick={() => allTo('tom')}>{names.tom}</button>
              <button className="nuria" style={{ fontWeight: 650 }} onClick={() => allTo('nuria')}>{names.nuria}</button>
              <button style={{ fontWeight: 650 }} onClick={() => allTo('shared')}>Shared</button>
            </span>
          </div>

          <div className="card" style={{ padding: '2px 12px' }}>
            {items.map((i) => (
              <div className="r-item" key={i.id}>
                <div className="r-top">
                  <input
                    className="input name"
                    value={i.name}
                    onChange={(e) => update(i.id, { name: e.target.value })}
                    placeholder="Item"
                    aria-label="Item name"
                  />
                  <input
                    className="input price num"
                    inputMode="decimal"
                    value={priceText[i.id] ?? ''}
                    onChange={(e) => {
                      setPriceText((p) => ({ ...p, [i.id]: e.target.value }));
                      const v = parseMoney(e.target.value);
                      update(i.id, { price: Number.isFinite(v) ? (e.target.value.trim().startsWith('-') ? -Math.abs(v) : v) : 0 });
                    }}
                    placeholder="0.00"
                    aria-label="Price"
                  />
                </div>
                <div className="owner-btns">
                  {(['tom', 'nuria', 'shared'] as Owner[]).map((o) => (
                    <button key={o} className={`${o} ${i.owner === o ? 'on' : ''}`} onClick={() => setOwner(i.id, o)} aria-pressed={i.owner === o}>
                      {o === 'shared' ? 'Shared' : names[o]}
                    </button>
                  ))}
                  <button
                    className="del"
                    aria-label="Remove item"
                    onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </div>
            ))}
            <button className="btn" style={{ margin: '10px 0', minHeight: 44 }} onClick={addRow}>
              <Icon name="plus" size={18} /> Add item
            </button>
          </div>

          {mismatch && (
            <div className="note" style={{ marginTop: 12 }}>
              <span>
                Receipt total says <strong>{fmt(printedTotal!, currency)}</strong> but items add up to{' '}
                <strong>{fmt(t.total, currency)}</strong>. Check for a misread price or missing line.
              </span>
            </div>
          )}

          <div className="inline" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="rdate">Date</label>
              <input id="rdate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rcur">Currency</label>
              <select id="rcur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{CURRENCY_FLAGS[c] ?? ''} {c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="rcat">Category</label>
            <select id="rcat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" size={18} /> Retake
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={18} /> Choose photo
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
