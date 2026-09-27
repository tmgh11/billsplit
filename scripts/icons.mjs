// Renders the PNG app icons from the SVGs (run once: node scripts/icons.mjs). Needs Playwright.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const mask = readFileSync('public/icons/icon-maskable.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  [svg, 192, 'icon-192.png', false],
  [svg, 512, 'icon-512.png', false],
  [mask, 512, 'icon-maskable-512.png', false],
  [mask, 180, 'apple-touch-icon.png', false],
];
for (const [src, size, name] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true });
}
await browser.close();
