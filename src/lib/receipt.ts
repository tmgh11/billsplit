import type { ReceiptItem } from './types';
import { round2 } from './money';

export interface ParsedReceipt {
  merchant: string;
  items: ReceiptItem[];
  /** the TOTAL printed on the receipt, if we could find it */
  printedTotal: number | null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Lines that carry a price but aren't items.
const SKIP = new RegExp(
  [
    'sub\\s*-?\\s*total', '\\btotal\\b', 'balance', 'change', '\\bcash\\b', '\\bcard\\b', 'visa', 'master\\s*card',
    'amex', 'contactless', 'debit', 'credit', '\\bvat\\b', '\\btax\\b', 'amount\\s+due', 'to\\s+pay', 'tender',
    'payment', 'paid', 'you\\s+saved', 'total\\s+sav', 'points', 'auth', 'refund\\s+due', 'rounding', 'tip\\b',
    'service\\s+charge\\s+incl', 'net\\s+amount', 'gratuity',
  ].join('|'),
  'i',
);

const TOTAL = /\b(total|amount\s+due|to\s+pay|balance\s+due)\b/i;
// price at the end of a line: "1.25", "£1.25", "1,25", "-0.50", "1.25 A", "1.25*"
const PRICE_AT_END = /(-?)\s*[£€$]?\s*(-?\d{1,5}[.,]\s?\d{2})\s*(-|[A-Z]{1,2}|\*)?\s*$/;

function toNumber(s: string): number {
  return parseFloat(s.replace(/\s/g, '').replace(',', '.'));
}

function cleanName(s: string): string {
  return s
    .replace(/^[\s\-–—*#.:|]+/, '')
    .replace(/[\s\-–—*#.:|£€$]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\d+\s*[xX@]\s*/, '') // "2 x " quantity prefix
    .trim();
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[|`~]/g, ' ').trim())
    .filter(Boolean);

  const items: ReceiptItem[] = [];
  let printedTotal: number | null = null;
  let merchant = '';

  for (const line of lines) {
    const m = line.match(PRICE_AT_END);
    if (!m) {
      if (!merchant && /[a-z]{3,}/i.test(line) && !/\d{3,}/.test(line)) merchant = cleanName(line);
      continue;
    }
    let price = toNumber(m[2]);
    const negative = m[1] === '-' || m[3] === '-' || m[2].startsWith('-');
    if (negative) price = -Math.abs(price);
    const name = cleanName(line.slice(0, m.index));

    if (TOTAL.test(name) && !/sub/i.test(name) && !/sav/i.test(name)) {
      printedTotal = Math.abs(price); // keep the last TOTAL we see
      continue;
    }
    if (SKIP.test(name)) continue;
    if (!/[a-z]{2,}/i.test(name)) continue; // bare numbers, dates, card digits
    if (Math.abs(price) > 5000) continue;
    items.push({ id: uid(), name: titleCase(name), price: round2(price), owner: 'shared' });
  }

  return { merchant: titleCase(merchant), items, printedTotal };
}

function titleCase(s: string): string {
  if (!s) return s;
  // Receipts are often ALL CAPS; soften that but leave mixed-case names alone.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function receiptTotals(items: ReceiptItem[]) {
  const t = { tom: 0, nuria: 0, shared: 0 };
  for (const i of items) t[i.owner] += Number.isFinite(i.price) ? i.price : 0;
  const total = t.tom + t.nuria + t.shared;
  return {
    tomOnly: round2(t.tom),
    nuriaOnly: round2(t.nuria),
    shared: round2(t.shared),
    total: round2(total),
    tomShare: round2(t.tom + t.shared / 2),
    nuriaShare: round2(t.nuria + t.shared / 2),
  };
}

/** Downscale, greyscale and boost contrast – markedly improves Tesseract accuracy on phone photos. */
export async function preprocessImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // luminance histogram for auto-levels
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y;
    hist[y | 0]++;
  }
  const n = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function recogniseReceipt(
  file: Blob,
  onProgress: (p: number, status: string) => void,
): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js');
  const base = new URL('./ocr/', document.baseURI).href;
  onProgress(0.02, 'Preparing photo');
  const canvas = await preprocessImage(file);
  const worker = await createWorker('eng', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base,
    logger: (m: { status: string; progress: number }) => {
      const label = m.status.startsWith('recognizing') ? 'Reading receipt' : 'Loading scanner';
      const p = m.status.startsWith('recognizing') ? 0.3 + m.progress * 0.7 : 0.05 + m.progress * 0.25;
      onProgress(p, label);
    },
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
