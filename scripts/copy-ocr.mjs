// Copies the Tesseract.js worker, WASM core and English language data into public/ocr
// so receipt scanning works offline and never depends on a third-party CDN.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });

const tessDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const engDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tessDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].flatMap((n) => [
    [join(coreDir, `${n}.wasm.js`), `${n}.wasm.js`],
  ]),
  [join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing OCR asset: ${from}`);
  copyFileSync(from, join(out, to));
}
console.log(`OCR assets copied to ${out}`);
