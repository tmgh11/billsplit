import { useMemo, useState } from 'react';
import { Icon, Seg } from './ui';
import { baseAmount, fmt, shares } from '../lib/money';
import { monthKey, monthLabel, prettyDate, shiftMonth, today } from '../lib/dates';
import { categoryById } from '../lib/categories';
import { useStore } from '../lib/store';
import type { Expense } from '../lib/types';

type View = 'all' | 'tom' | 'nuria';

export function Analytics() {
  const { expenses, settings } = useStore();
  const { names, baseCurrency: base } = settings;
  const current = monthKey(today());
  const [month, setMonthState] = useState(current);
  // The chart shows 6 months ending at chartEnd. It stays put when you tap a bar,
  // and only scrolls when you page it or pick a month (with the arrows) that's off-screen.
  const [chartEnd, setChartEnd] = useState(current);
  const setMonth = (m: string) => {
    setMonthState(m);
    const start = shiftMonth(chartEnd, -5);
    if (m > chartEnd) setChartEnd(m);
    else if (m < start) setChartEnd(shiftMonth(m, 5) > current ? current : shiftMonth(m, 5));
  };
  const pageChart = (dir: -1 | 1) => {
    const end = shiftMonth(chartEnd, dir * 6);
    const next = end > current ? current : end;
    setChartEnd(next);
    // keep the selected month visible
    if (month > next || month < shiftMonth(next, -5)) setMonthState(next);
  };
  const backToNow = () => {
    setMonthState(current);
    setChartEnd(current);
  };
  const [view, setView] = useState<View>('all');
  const [openCat, setOpenCat] = useState<string | null>(null);

  const value = (e: Expense) => (view === 'all' ? baseAmount(e) : shares(e)[view]);

  const byMonth = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of expenses) {
      const k = monthKey(e.date);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return m;
  }, [expenses]);

  const list = byMonth.get(month) ?? [];
  const total = list.reduce((s, e) => s + value(e), 0);
  const prevTotal = (byMonth.get(shiftMonth(month, -1)) ?? []).reduce((s, e) => s + value(e), 0);
  const delta = prevTotal ? (total - prevTotal) / prevTotal : null;
  const tomTotal = list.reduce((s, e) => s + shares(e).tom, 0);
  const nuriaTotal = list.reduce((s, e) => s + shares(e).nuria, 0);
  const paidTom = list.filter((e) => e.paidBy === 'tom').reduce((s, e) => s + baseAmount(e), 0);
  const paidNuria = list.filter((e) => e.paidBy === 'nuria').reduce((s, e) => s + baseAmount(e), 0);

  const monthTotal = (k: string) => (byMonth.get(k) ?? []).reduce((s, e) => s + value(e), 0);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(chartEnd, i - 5));
  const series = months.map((k) => ({ key: k, v: monthTotal(k) }));
  // average of the 5 months before the selected one (ignoring empty months)
  const avg = Array.from({ length: 5 }, (_, i) => monthTotal(shiftMonth(month, -1 - i))).filter((v) => v > 0);
  const avgPrev = avg.length ? avg.reduce((s, v) => s + v, 0) / avg.length : 0;
  const chartTitle =
    chartEnd === current
      ? 'Last 6 months'
      : `${monthLabel(months[0], 'short')}${months[0].slice(0, 4) !== chartEnd.slice(0, 4) ? ` ${months[0].slice(0, 4)}` : ''} – ${monthLabel(chartEnd, 'short')} ${chartEnd.slice(0, 4)}`;

  const cats = useMemo(() => {
    const m = new Map<string, { v: number; items: Expense[] }>();
    for (const e of list) {
      const x = m.get(e.category) ?? { v: 0, items: [] };
      x.v += value(e);
      x.items.push(e);
      m.set(e.category, x);
    }
    return [...m.entries()].filter(([, x]) => x.v > 0.004).sort((a, b) => b[1].v - a[1].v);
  }, [list, view]);
  const maxCat = cats[0]?.[1].v ?? 1;
  const isCurrent = month === current;

  return (
    <>
      <div className="month-nav">
        <button className="icon-btn" style={{ marginTop: 0 }} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <Icon name="left" size={18} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <h2>{monthLabel(month)}</h2>
          {!isCurrent && (
            <button className="chip" style={{ marginTop: 6, padding: '4px 10px', fontSize: 13 }} onClick={backToNow}>
              Back to this month
            </button>
          )}
        </div>
        <button
          className="icon-btn"
          style={{ marginTop: 0, opacity: isCurrent ? 0.3 : 1 }}
          disabled={isCurrent}
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label="Next month"
        >
          <Icon name="right" size={18} />
        </button>
      </div>

      <Seg
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'Both of us' },
          { value: 'tom', label: names.tom, className: 'tom' },
          { value: 'nuria', label: names.nuria, className: 'nuria' },
        ]}
      />

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="card stat">
          <div className="k">{view === 'all' ? 'Total spend' : `${names[view]}’s spend`}</div>
          <div className="v num">{fmt(total, base)}</div>
          {delta != null && (
            <div className="d text-2">
              {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}% vs {monthLabel(shiftMonth(month, -1), 'short')}
            </div>
          )}
        </div>
        <div className="card stat">
          <div className="k">5-month average</div>
          <div className="v num">{fmt(avgPrev, base)}</div>
          <div className="d text-2">{list.length} expense{list.length === 1 ? '' : 's'} this month</div>
        </div>
        {view === 'all' && total > 0 && (
          <div className="card stat wide">
            <div className="k">Whose cost it was</div>
            <div className="split-bar" aria-hidden="true">
              <div style={{ flex: tomTotal || 0.0001 }} />
              <div style={{ flex: nuriaTotal || 0.0001 }} />
            </div>
            <div className="legend num">
              <span><i style={{ background: 'var(--tom)' }} />{names.tom} {fmt(tomTotal, base)} ({Math.round((tomTotal / total) * 100)}%)</span>
              <span><i style={{ background: 'var(--nuria)' }} />{names.nuria} {fmt(nuriaTotal, base)} ({Math.round((nuriaTotal / total) * 100)}%)</span>
            </div>
            <div className="small-print" style={{ margin: '8px 0 0' }}>
              Paid upfront: {names.tom} {fmt(paidTom, base)} · {names.nuria} {fmt(paidNuria, base)}
            </div>
          </div>
        )}
      </div>

      <div className="section-title">
        <span>{chartTitle}</span>
        <span className="aside">tap a bar to see that month</span>
      </div>
      <div className="card pad">
        <div className="chart-nav">
          <button className="icon-btn" onClick={() => pageChart(-1)} aria-label="Earlier months">
            <Icon name="left" size={16} />
          </button>
          {chartEnd !== current ? (
            <button className="chip" style={{ padding: '4px 10px', fontSize: 13 }} onClick={backToNow}>
              Back to now
            </button>
          ) : (
            <span />
          )}
          <button
            className="icon-btn"
            onClick={() => pageChart(1)}
            disabled={chartEnd === current}
            style={{ opacity: chartEnd === current ? 0.3 : 1 }}
            aria-label="Later months"
          >
            <Icon name="right" size={16} />
          </button>
        </div>
        <MonthBars series={series} selected={month} onSelect={setMonthState} currency={base} />
      </div>

      <div className="section-title">
        <span>By category</span>
      </div>
      <div className="card pad cat-bars" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {cats.length === 0 && <div className="empty" style={{ padding: 20 }}>No spending this month.</div>}
        {cats.map(([id, x]) => {
          const c = categoryById(id);
          const open = openCat === id;
          return (
            <div key={id}>
              <button className="cb" onClick={() => setOpenCat(open ? null : id)} aria-expanded={open}>
                <span className="e">{c.emoji}</span>
                <span className="l">
                  {c.label}
                  <span className="pct">{Math.round((x.v / total) * 100)}%</span>
                </span>
                <span className="a num">{fmt(x.v, base)}</span>
                <span className="track">
                  <span className="fill" style={{ width: `${(x.v / maxCat) * 100}%`, display: 'block' }} />
                </span>
              </button>
              {open && (
                <div style={{ padding: '0 0 8px 38px' }}>
                  {x.items
                    .slice()
                    .sort((a, b) => value(b) - value(a))
                    .map((e) => (
                      <div key={e.id} className="inline" style={{ fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.description} <span className="muted">· {prettyDate(e.date)}</span>
                        </span>
                        <span className="num" style={{ textAlign: 'right', flex: 'none' }}>{fmt(value(e), base)}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="small-print">Settlements aren’t spending, so they’re left out. Foreign-currency expenses use the rate on the day they were added.</p>
    </>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function MonthBars({
  series,
  selected,
  onSelect,
  currency,
}: {
  series: { key: string; v: number }[];
  selected: string;
  onSelect: (k: string) => void;
  currency: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 340;
  const H = 170;
  const padL = 40;
  const padB = 22;
  const padT = 20;
  const max = niceMax(Math.max(...series.map((s) => s.v)));
  const innerW = W - padL;
  const innerH = H - padB - padT;
  const slot = innerW / series.length;
  const bw = Math.min(34, slot * 0.56);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const short = (v: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: 'compact', maximumSignificantDigits: 3 }).format(v);
  const tipKey = hover ?? selected;
  const tipIdx = series.findIndex((s) => s.key === tipKey);
  const tip = series[tipIdx];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly spend, last six months">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} strokeWidth={1} />
            <text className="axis" x={padL - 8} y={y(t) + 4} textAnchor="end">
              {short(t)}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          const x = padL + slot * i + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(s.v));
          const r = Math.min(4, h);
          const active = s.key === selected;
          return (
            <g
              key={s.key}
              onClick={() => onSelect(s.key)}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={padL + slot * i} y={padT - 10} width={slot} height={innerH + 10 + padB} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(s.v) + r} Q${x},${y(s.v)} ${x + r},${y(s.v)} H${x + bw - r} Q${x + bw},${y(s.v)} ${x + bw},${y(s.v) + r} V${y(0)} Z`}
                  fill={active ? 'var(--bar)' : 'var(--bar-dim)'}
                />
              )}
              <text className="axis" x={x + bw / 2} y={H - 4} textAnchor="middle" style={{ fontWeight: active ? 700 : 400, fill: active ? 'var(--text)' : undefined }}>
                {monthLabel(s.key, 'short')}
              </text>
            </g>
          );
        })}
      </svg>
      {tip && tip.v > 0 && (
        <div
          className="tip num"
          style={{
            left: `${((padL + slot * tipIdx + slot / 2) / W) * 100}%`,
            top: `${(y(tip.v) / H) * 100}%`,
            marginTop: -6,
          }}
        >
          {fmt(tip.v, currency)}
        </div>
      )}
    </div>
  );
}
