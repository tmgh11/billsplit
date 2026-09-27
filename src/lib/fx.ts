/**
 * Exchange rates from ExchangeRate-API's free, key-less "open access" endpoint.
 * https://www.exchangerate-api.com/docs/free  (updates daily; attribution required)
 * Rates are cached per base currency so the app keeps working offline.
 */

export const CURRENCIES = [
  'GBP', 'EUR', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD', 'NZD', 'JPY',
  'CNY', 'HKD', 'SGD', 'THB', 'INR', 'AED', 'MAD', 'TRY', 'MXN', 'BRL', 'ARS', 'COP', 'CLP', 'ZAR',
  'ISK', 'KRW', 'IDR', 'VND', 'PHP', 'MYR', 'ILS', 'EGP',
];

export const CURRENCY_FLAGS: Record<string, string> = {
  GBP: '🇬🇧', EUR: '🇪🇺', USD: '🇺🇸', CHF: '🇨🇭', SEK: '🇸🇪', NOK: '🇳🇴', DKK: '🇩🇰', PLN: '🇵🇱', CZK: '🇨🇿',
  HUF: '🇭🇺', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', JPY: '🇯🇵', CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', THB: '🇹🇭',
  INR: '🇮🇳', AED: '🇦🇪', MAD: '🇲🇦', TRY: '🇹🇷', MXN: '🇲🇽', BRL: '🇧🇷', ARS: '🇦🇷', COP: '🇨🇴', CLP: '🇨🇱',
  ZAR: '🇿🇦', ISK: '🇮🇸', KRW: '🇰🇷', IDR: '🇮🇩', VND: '🇻🇳', PHP: '🇵🇭', MYR: '🇲🇾', ILS: '🇮🇱', EGP: '🇪🇬',
};

interface RateTable {
  base: string;
  fetchedAt: number;
  updatedUtc?: string;
  rates: Record<string, number>; // units of X per 1 base
}

const KEY = (base: string) => `billsplit.fx.${base}`;
const MAX_AGE = 6 * 60 * 60 * 1000;

function cached(base: string): RateTable | null {
  try {
    const raw = localStorage.getItem(KEY(base));
    return raw ? (JSON.parse(raw) as RateTable) : null;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<RateTable | null>>();

export async function getRates(base: string, force = false): Promise<RateTable | null> {
  const c = cached(base);
  if (c && !force && Date.now() - c.fetchedAt < MAX_AGE) return c;
  if (inflight.has(base)) return inflight.get(base)!;
  const p = (async () => {
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
      const json = await res.json();
      if (json.result !== 'success') throw new Error(json['error-type'] ?? 'FX error');
      const table: RateTable = {
        base,
        fetchedAt: Date.now(),
        updatedUtc: json.time_last_update_utc,
        rates: json.rates,
      };
      try {
        localStorage.setItem(KEY(base), JSON.stringify(table));
      } catch {
        /* storage full / private mode */
      }
      return table;
    } catch {
      return c; // offline: fall back to whatever we have
    } finally {
      inflight.delete(base);
    }
  })();
  inflight.set(base, p);
  return p;
}

/** How many `base` units one unit of `currency` is worth. */
export async function rateToBase(currency: string, base: string): Promise<number | null> {
  if (currency === base) return 1;
  const t = await getRates(base);
  const r = t?.rates[currency];
  return r ? 1 / r : null;
}
