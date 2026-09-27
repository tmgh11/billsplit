import type { ReceiptItem } from './types';
import { round2 } from './money';

export interface ParsedReceipt {
  merchant: string;
  items: ReceiptItem[];
  /** the TOTAL printed on the receipt, if we could find it */
  printedTotal: number | null;
  /** whole-basket discounts after the subtotal (e.g. "CLUB SAVE 10%"), as a negative number */
  basketDiscount: number;
  /** amounts on payment lines (VISA 12.34 …) – they normally repeat the total, a useful cross-check */
  payments: number[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Lines that carry a price but aren't items.
const SKIP = new RegExp(
  [
    'sub\\s*-?\\s*t[o0]t[a-z0-9]{1,3}', '\\btotal\\b', 'balance', 'change', '\\bcash\\b', '\\bcard\\b', 'visa', 'master\\s*card',
    'amex', 'contactless', 'debit', 'credit', '\\bvat\\b', '\\btax\\b', 'amount\\s+due', 'to\\s+pay', 'tender',
    'payment', 'paid', 'saved', 'total\\s+sav', 'points', 'auth', 'refund\\s+due', 'rounding', 'tip\\b',
    'service\\s+charge\\s+incl', 'net\\s+amount', 'gratuity', 'package\\s+price', 'items?\\s+sold', 'cashback',
  ].join('|'),
  'i',
);

const TOTAL = /\b(t[o0]t[a4][l1i|]|amount\s+due|to\s+pay|balance\s+due)\b/i; // tolerant of TOTAI / T0TAL
const NOT_THE_TOTAL = /sub|sav|tax|vat|net|item/i;
const SUBTOTAL = /sub\s*-?\s*t[o0]t[a-z0-9]{1,3}/i; // also OCR'd variants like 'Subtotil'
const PAYMENT = /visa|master\s*card|amex|contactless|\bcard\b|debit|credit|\bcash\b|apple\s*pay|google\s*pay/i;
// Lines that adjust a price rather than being an item of their own
const DISCOUNT = /discount|saving|clubcard|nectar|price\s*cut|multi\s*-?\s*buy|offer|promo|reduc|coupon|\bsave\b|\boff\b|deal|voucher|reward/i;

// price at the end of a line: "1.25", "£1.25", "1,25", "-0.50", "1.25 A", "1.25*"
const PRICE_AT_END = /(-?)\s*[£€$]?\s*(-?\d{1,5}[.,]\s?\d{2})\s*(-|[A-Z]{1,2}|\*)?\s*$/;
// Same, but tolerating the classic OCR swaps inside numbers on faded print (O→0, l→1, S→5, B→8 …)
const LENIENT_PRICE_AT_END = /(-?)\s*[£€$]?\s*(-?[\dOoDIl|SsBZ]{1,5}\s?[.,]\s?[\dOoDIl|SsBZ]{2})\s*(-|[A-Z]{1,2}|\*)?\s*$/;
const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2' };

function toNumber(s: string): number {
  return parseFloat(
    s
      .replace(/\s/g, '')
      .replace(/[OoDIl|SsBZ]/g, (c) => OCR_DIGIT[c])
      .replace(',', '.'),
  );
}

function matchPrice(line: string): RegExpMatchArray | null {
  const strict = line.match(PRICE_AT_END);
  if (strict) return strict;
  const loose = line.match(LENIENT_PRICE_AT_END);
  // only accept a lenient match that still has at least two real digits in it
  if (loose && (loose[2].match(/\d/g) ?? []).length >= 2) return loose;
  return null;
}

function cleanName(s: string): string {
  return s
    .replace(/^[\s\-–—*#.:|,'"`_]+/, '')
    .replace(/[\s\-–—*#.:|£€$,'"`_]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(?=[\dOoIl|SsB]*\d{4})[\dOoIl|SsB]{6,}\s+/, '') // barcode / product code in front of the name
    .replace(/^\d+\s*[xX@]\s*/, '') // "2 x " quantity prefix
    .replace(/^(?:[a-z]{1,2}|[^A-Za-z0-9\s]{1,3})\s+(?=[A-Z]{2})/, '') // OCR crumbs before an ALL-CAPS name
    .trim();
}

const hasWords = (s: string) => /[a-z]{2,}/i.test(s);

// Well-known shops, matched anywhere on the receipt (logos often don't OCR, but the web
// address or small print usually mentions the name).
const SHOPS: [RegExp, string][] = [
  [/tesco/i, 'Tesco'], [/sainsbury/i, 'Sainsbury’s'], [/asda/i, 'ASDA'], [/\baldi\b/i, 'Aldi'], [/\blidl\b/i, 'Lidl'],
  [/waitrose/i, 'Waitrose'], [/marks\s*(&|and)\s*spencer|\bm\s*&\s*s\b/i, 'M&S'], [/co-?op\b/i, 'Co-op'],
  [/morrisons/i, 'Morrisons'], [/iceland/i, 'Iceland'], [/ocado/i, 'Ocado'], [/pets\s*(at\s*home|club)/i, 'Pets at Home'],
  [/\bboots\b/i, 'Boots'], [/superdrug/i, 'Superdrug'], [/wilko/i, 'Wilko'], [/\bikea\b/i, 'IKEA'], [/argos/i, 'Argos'],
  [/b\s*&\s*q\b/i, 'B&Q'], [/homebase/i, 'Homebase'], [/primark/i, 'Primark'], [/whole\s*foods/i, 'Whole Foods'],
  [/pret\s*a\s*manger/i, 'Pret'], [/costa\b/i, 'Costa'], [/starbucks/i, 'Starbucks'], [/greggs/i, 'Greggs'],
  [/mercadona/i, 'Mercadona'], [/carrefour/i, 'Carrefour'], [/el\s*corte\s*ingl/i, 'El Corte Inglés'],
];

function findShop(text: string): string | null {
  for (const [re, name] of SHOPS) if (re.test(text)) return name;
  return null;
}

/** A line that plausibly is a shop name: mostly letters, a real word, not an address/number line. */
const looksLikeName = (line: string) => {
  const letters = (line.match(/[a-z]/gi) ?? []).length;
  return /[a-z]{4,}/i.test(line) && letters / line.replace(/\s/g, '').length > 0.75 && !/\d{3,}/.test(line);
};

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[`~]/g, ' ').replace(/\s+\|\s+/g, ' ').trim())
    .filter(Boolean);

  const items: ReceiptItem[] = [];
  let printedTotal: number | null = null;
  let basketDiscount = 0;
  let merchant = '';
  let afterSubtotal = false;
  // a name-only line whose price may have wrapped onto the next line
  let pendingName = '';
  // was the most recent priced line an item (so a following discount belongs to it)?
  let lastWasItem = false;

  const payments: number[] = [];

  for (const line of lines) {
    const m = matchPrice(line);
    if (m && PAYMENT.test(line) && !/change/i.test(line)) {
      const amount = Math.abs(toNumber(m[2]));
      if (Number.isFinite(amount) && amount > 0) payments.push(round2(amount));
    }
    if (printedTotal != null) continue; // after the total, only payment lines matter
    if (!m) {
      if (SUBTOTAL.test(line)) afterSubtotal = true;
      if (!merchant && !items.length && looksLikeName(line)) merchant = cleanName(line);
      else if (/[a-z]{3,}/i.test(line) && !SKIP.test(line) && !TOTAL.test(line) && !DISCOUNT.test(line)) pendingName = cleanName(line);
      else pendingName = '';
      continue;
    }
    let price = toNumber(m[2]);
    if (!Number.isFinite(price) || Math.abs(price) > 5000) continue;
    const negative = m[1] === '-' || m[3] === '-' || m[2].startsWith('-');
    if (negative) price = -Math.abs(price);
    let name = cleanName(line.slice(0, m.index));
    const wrapped = !hasWords(name) && pendingName;
    if (wrapped) name = pendingName; // price printed on the line below its name
    pendingName = '';

    if (SUBTOTAL.test(name)) {
      afterSubtotal = true;
      lastWasItem = false;
      continue;
    }
    if (TOTAL.test(name) && !NOT_THE_TOTAL.test(name)) {
      printedTotal = Math.abs(price);
      continue;
    }
    if (price < 0 && (DISCOUNT.test(name) || !hasWords(name))) {
      if (afterSubtotal || !lastWasItem || !items.length) basketDiscount += price;
      else items[items.length - 1].price = round2(items[items.length - 1].price + price);
      lastWasItem = false;
      continue;
    }
    if (SKIP.test(name) || !hasWords(name)) {
      lastWasItem = false;
      continue;
    }
    items.push({ id: uid(), name: titleCase(name), price: round2(price), owner: 'shared' });
    lastWasItem = true;
  }

  return reconcileTotal({
    merchant: findShop(text) ?? titleCase(merchant),
    items,
    printedTotal,
    basketDiscount: round2(basketDiscount),
    payments,
  });
}

/**
 * Sanity-check the printed total against the payment lines. If the items add up to one of
 * them, that's the total (the TOTAL line itself is often bold and misread). A "total" smaller
 * than the dearest single item is impossible, so it's replaced or dropped.
 */
export function reconcileTotal(r: ParsedReceipt, allItems: ReceiptItem[] = r.items): ParsedReceipt {
  const sum = receiptSum({ items: allItems, basketDiscount: r.basketDiscount });
  const candidates = [r.printedTotal, ...r.payments].filter((t): t is number => t != null);
  const exact = candidates.find((t) => Math.abs(t - sum) < 0.005);
  if (exact != null) return { ...r, printedTotal: exact };
  const dearest = Math.max(0, ...allItems.map((i) => i.price));
  if (r.printedTotal != null && r.printedTotal + 0.005 < dearest) {
    return { ...r, printedTotal: r.payments.find((p) => p + 0.005 >= dearest) ?? null };
  }
  if (r.printedTotal == null && r.payments.length) return { ...r, printedTotal: r.payments[r.payments.length - 1] };
  return r;
}

export const receiptSum = (p: Pick<ParsedReceipt, 'items' | 'basketDiscount'>) =>
  round2(p.items.reduce((s, i) => s + i.price, 0) + (p.basketDiscount || 0));

/** How believable a parse is: matching the printed total beats everything, then more lines. */
export function parseScore(p: ParsedReceipt): number {
  const sum = receiptSum(p);
  let score = p.items.length;
  if (p.printedTotal != null) {
    if (Math.abs(sum - p.printedTotal) < 0.005) score += 1000;
    else score -= Math.min(20, (Math.abs(sum - p.printedTotal) / Math.max(1, p.printedTotal)) * 20);
  }
  return score;
}

export const totalsMatch = (p: ParsedReceipt) => p.printedTotal != null && Math.abs(receiptSum(p) - p.printedTotal) < 0.005;

// ---------- joining several photos of one long receipt ----------

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function similarity(a: string, b: string): number {
  a = simplify(a);
  b = simplify(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function sameLine(a: ReceiptItem, b: ReceiptItem): boolean {
  const sim = similarity(a.name, b.name);
  return (Math.abs(a.price - b.price) < 0.005 && sim >= 0.55) || sim >= 0.85;
}

/**
 * Append the items from the next photo, dropping the lines that were in both photos.
 * The overlap is the longest run at the END of what we have that matches a run at the
 * START of the new photo (allowing the first line or two of the new photo – and the last
 * line of the previous one – to be half cut off at the edge of the frame).
 */
export function mergeParts(prev: ReceiptItem[], next: ReceiptItem[]): { items: ReceiptItem[]; skipped: number; overlapFound: boolean } {
  let best = { i0: 0, j0: 0, len: 0 };
  for (let j0 = 0; j0 <= Math.min(2, next.length - 1); j0++) {
    for (let i0 = Math.max(0, prev.length - 15); i0 < prev.length; i0++) {
      let len = 0;
      while (i0 + len < prev.length && j0 + len < next.length && sameLine(prev[i0 + len], next[j0 + len])) len++;
      const reachesEnd = i0 + len >= prev.length - 1; // last line of prev may be the cut-off one
      if (len > 0 && reachesEnd && (len > best.len || (len === best.len && j0 < best.j0))) best = { i0, j0, len };
    }
  }
  if (!best.len) return { items: [...prev, ...next], skipped: 0, overlapFound: false };

  let kept = prev;
  let skipped = best.j0 + best.len;
  // prev's final line wasn't matched: it's the half-visible line; the new photo's copy is better
  if (best.i0 + best.len === prev.length - 1) {
    kept = prev.slice(0, -1);
    skipped += 1;
  }
  return { items: [...kept, ...next.slice(best.j0 + best.len)], skipped, overlapFound: true };
}

function titleCase(s: string): string {
  if (!s) return s;
  // Receipts are often ALL CAPS; soften that but leave mixed-case names alone.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/**
 * Totals for the review screen. A whole-basket discount is shared in proportion to what
 * each person bought (a 10% club saving takes 10% off everyone's share).
 */
export function receiptTotals(items: ReceiptItem[], basketDiscount = 0) {
  const t = { tom: 0, nuria: 0, shared: 0 };
  for (const i of items) t[i.owner] += Number.isFinite(i.price) ? i.price : 0;
  const gross = t.tom + t.nuria + t.shared;
  const factor = gross > 0 ? (gross + basketDiscount) / gross : 1;
  const total = round2(gross + basketDiscount);
  const tomExact = (t.tom + t.shared / 2) * factor;
  const tomShare = round2(tomExact);
  return {
    tomOnly: round2(t.tom * factor),
    nuriaOnly: round2(t.nuria * factor),
    shared: round2(t.shared * factor),
    total,
    tomShare,
    nuriaShare: round2(total - tomShare),
    /** Tom's share before rounding: saved as the split, so an odd penny follows the usual rule */
    tomExact,
  };
}

// Size limits for the image handed to the OCR engine. Limiting total pixels (not just the long
// side) keeps text on long, thin receipts big enough to read.
const MAX_PIXELS = 5_000_000;
const MAX_SIDE = 4000;

function scaledCanvas(src: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  if (!width || !height) throw new Error('image has no size');
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Decode the photo straight to a smaller canvas. Modern phone cameras produce 12–50 MP images;
 * decoding those at full size can exhaust a mobile browser's memory, so we try the most
 * memory-friendly decoders first and fall back through the others.
 */
async function decodeToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const errors: string[] = [];
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return scaledCanvas(img, img.naturalWidth, img.naturalHeight);
  } catch (e) {
    errors.push(`img: ${(e as Error)?.message ?? e}`);
  } finally {
    URL.revokeObjectURL(url);
  }
  try {
    const probe = await createImageBitmap(file, { resizeWidth: 2000, resizeQuality: 'high', imageOrientation: 'from-image' });
    const c = scaledCanvas(probe, probe.width, probe.height);
    probe.close?.();
    return c;
  } catch (e) {
    errors.push(`bitmap: ${(e as Error)?.message ?? e}`);
  }
  throw new Error(`Couldn’t open that photo (${errors.join('; ')})`);
}

function toGrey(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const g = new Float32Array(c.width * c.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

function fromGrey(g: Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const im = ctx.createImageData(w, h);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) {
    im.data[i] = im.data[i + 1] = im.data[i + 2] = g[p];
    im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

/** Summed-area table, for fast local means. */
function integral(g: Float32Array, w: number, h: number): Float64Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += g[(y - 1) * w + (x - 1)];
      sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + row;
    }
  }
  return sat;
}

/**
 * Divide out the paper's uneven lighting (creases, shadows, curl) using a large local mean,
 * so ink is judged against the paper right around it rather than the whole photo.
 */
function flatten(g: Float32Array, w: number, h: number): Float32Array {
  const sat = integral(g, w, h);
  const r = Math.max(12, Math.round(Math.min(w, h) / 30)); // ~ a few text lines tall
  const W = w + 1;
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - r), y2 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r), x2 = Math.min(w, x + r + 1);
      const mean = (sat[y2 * W + x2] - sat[y1 * W + x2] - sat[y2 * W + x1] + sat[y1 * W + x1]) / ((x2 - x1) * (y2 - y1));
      out[y * w + x] = Math.min(1.1, g[y * w + x] / (mean + 1)) * 232;
    }
  }
  return out;
}

/** Stretch contrast between the darkest ink and the paper; gamma > 1 pushes faint show-through to white. */
function stretch(g: Float32Array, gamma = 1): Float32Array {
  const hist = new Uint32Array(256);
  for (let p = 0; p < g.length; p++) hist[Math.min(255, Math.max(0, g[p] | 0))]++;
  const n = g.length;
  let lo = 0;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.005; lo++);
  let hi = 255;
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.4; hi--);
  const range = Math.max(8, hi - lo);
  const out = new Float32Array(n);
  for (let p = 0; p < n; p++) out[p] = 255 * Math.pow(Math.max(0, Math.min(1, (g[p] - lo) / range)), gamma);
  return out;
}

/** 3×3 minimum filter: thickens dark strokes so broken/dot-matrix characters join up. */
function thicken(g: Float32Array, w: number, h: number): Float32Array {
  const t = new Float32Array(g.length);
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      t[p] = Math.min(g[p], x > 0 ? g[p - 1] : 255, x < w - 1 ? g[p + 1] : 255);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      out[p] = Math.min(t[p], y > 0 ? t[p - w] : 255, y < h - 1 ? t[p + w] : 255);
    }
  return out;
}

/**
 * The OCR attempts, in order. Each photo is tried until one reading adds up to the printed
 * total. The recipes were chosen by measuring them on real, crinkled, faded receipts.
 */
function readingPlan(photo: HTMLCanvasElement) {
  const w = photo.width, h = photo.height;
  let flat: Float32Array | null = flatten(toGrey(photo), w, h);
  const evenLight = fromGrey(stretch(flat), w, h);
  const bolder = fromGrey(thicken(stretch(flat, 1.8), w, h), w, h);
  flat = null;
  return [
    { image: evenLight, psm: '6', label: 'Reading receipt' },
    { image: bolder, psm: '6', label: 'Double-checking' },
    { image: evenLight, psm: '4', label: 'Double-checking' },
  ];
}

/** Cleaned-up image for OCR (first recipe). */
export async function preprocessImage(file: Blob): Promise<HTMLCanvasElement> {
  return readingPlan(await decodeToCanvas(file))[0].image;
}

type Progress = (p: number, status: string) => void;

/** Set localStorage 'billsplit.debugOcr' = '1' to keep each pass's image and raw text on window.__ocr. */
function debugLog(label: string, canvas: HTMLCanvasElement, text: string) {
  try {
    if (localStorage.getItem('billsplit.debugOcr') !== '1') return;
    const w = window as unknown as { __ocr?: { label: string; text: string; image: string }[] };
    (w.__ocr ??= []).push({ label, text, image: canvas.toDataURL('image/jpeg', 0.7) });
  } catch {
    /* ignore */
  }
}
type TessWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

/**
 * Reads receipt photos. Keeps one OCR engine alive between photos (much faster for
 * multi-photo receipts) – call `dispose()` when done.
 */
export class ReceiptReader {
  private worker: Promise<TessWorker> | null = null;
  private progress: Progress = () => {};
  private span: [number, number] = [0, 1];

  private report(p: number, status: string) {
    const [a, b] = this.span;
    this.progress(a + (b - a) * p, status);
  }

  private getWorker(): Promise<TessWorker> {
    if (!this.worker) {
      this.worker = (async () => {
        const { createWorker, PSM } = await import('tesseract.js');
        const base = new URL('./ocr/', document.baseURI).href;
        const w = await createWorker('eng', 1, {
          workerPath: base + 'worker.min.js',
          corePath: base,
          langPath: base,
          logger: (m: { status: string; progress: number }) => {
            if (m.status.startsWith('recognizing')) this.report(m.progress, 'Reading receipt');
            else this.progress(0.05 + m.progress * 0.2, 'Loading scanner');
          },
        });
        await w.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        return w;
      })();
      this.worker.catch(() => (this.worker = null));
    }
    return this.worker;
  }

  private async ocr(canvas: HTMLCanvasElement, psm: string, from: number, to: number, label: string): Promise<ParsedReceipt> {
    const worker = await this.getWorker();
    this.span = [from, to];
    this.report(0, label);
    await worker.setParameters({ tessedit_pageseg_mode: psm as never });
    const { data } = await worker.recognize(canvas);
    debugLog(label, canvas, data.text);
    return parseReceiptText(data.text);
  }

  /**
   * `before` = items already read from earlier photos of the same receipt, so the
   * "does it add up to the printed total?" check covers the whole receipt.
   */
  async read(file: Blob, onProgress: Progress, before: ReceiptItem[] = []): Promise<ParsedReceipt> {
    const whole = (r: ParsedReceipt): ParsedReceipt => {
      const all = before.length ? mergeParts(before, r.items).items : r.items;
      return { ...reconcileTotal(r, all), items: all };
    };
    this.progress = onProgress;
    onProgress(0.02, 'Preparing photo');
    const [photo] = await Promise.all([decodeToCanvas(file), this.getWorker()]);
    const plan = readingPlan(photo);
    const results: ParsedReceipt[] = [];
    const step = 0.73 / plan.length;
    for (const [i, pass] of plan.entries()) {
      const parsed = await this.ocr(pass.image, pass.psm, 0.25 + i * step, 0.25 + (i + 1) * step, pass.label);
      results.push(parsed);
      if (totalsMatch(whole(parsed))) return { ...parsed, printedTotal: whole(parsed).printedTotal };
    }
    // No reading added up. A pass that missed the TOTAL line may still be right: borrow the
    // total another pass found, then keep the most believable reading.
    const totals = results.map((r) => r.printedTotal).filter((t): t is number => t != null);
    for (const r of results) {
      if (r.printedTotal == null) {
        const match = totals.find((t) => Math.abs(receiptSum(whole(r)) - t) < 0.005);
        r.printedTotal = match ?? totals[0] ?? null;
      }
    }
    const best = results.reduce((b, r) => (parseScore(whole(r)) > parseScore(whole(b)) ? r : b));
    return { ...best, printedTotal: whole(best).printedTotal };
  }

  async dispose() {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w).terminate().catch(() => {});
  }
}

/** One-off convenience wrapper. */
export async function recogniseReceipt(file: Blob, onProgress: Progress): Promise<ParsedReceipt> {
  const r = new ReceiptReader();
  try {
    return await r.read(file, onProgress);
  } finally {
    await r.dispose();
  }
}
