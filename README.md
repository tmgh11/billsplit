# Billsplit

A small, fast web app for Tom and Nuria to split shared costs. It replaces Splitwise. It installs on both phones like a normal app, works offline, and keeps the two phones in sync through a free Supabase database.

- **Running balance.** One open-ended ledger that always shows who owes whom.
- **Quick splits.** 50/50, all Tom's, all Nuria's, or a custom %.
- **Any currency.** Live rates come from [ExchangeRate-API](https://www.exchangerate-api.com), and each expense keeps the rate from the day it was added. You can also switch the whole ledger's currency.
- **Settle up.** Record a full or partial transfer in either direction.
- **Repeating expenses.** Weekly, every 2 weeks, monthly, yearly, or a list of set dates. They're added automatically, including any missed while nobody had the app open.
- **Scan receipt.** Receipts are read on the phone with Tesseract.js, and nothing is uploaded. You can edit every line, then tap **Tom / Nuria / Shared** on each item. The uneven totals go straight into the ledger.
- **Spending.** Monthly totals, a 6-month chart and a category breakdown. You can view it for the household or for each person's share.
- **Categories.** These are guessed from the description ("Tesco" → Groceries, "Council tax" → Bills). If you override a guess, the app learns it for next time.
- **Your data.** Import your Splitwise history, export to CSV, and make full backups.

---

## 1. Set up Supabase (about 5 minutes, free)

1. Create a free account at [supabase.com](https://supabase.com), then create a **New project**. Any name and region are fine; London is `eu-west-2`.
2. Go to **SQL Editor → New query** and paste in the whole of [`supabase/schema.sql`](supabase/schema.sql). **Replace the two example emails at the bottom with your real ones**, then press **Run**.
3. Go to **Authentication → Users → Add user → Create new user**. Add Tom's email and a password, and tick **Auto Confirm User**. Repeat for Nuria.
4. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Nobody else can create an account now. Even if someone did, the database only lets in the two emails you listed.
5. Go to **Project Settings → API** (or **Connect**) and copy the **Project URL** and the **anon / publishable key**. The key is designed to be public. Your data is protected by row-level security, so only your two signed-in accounts can read or write it.

> Free Supabase projects pause after about a week with no activity. If that happens, press **Restore** in the dashboard. The app keeps working offline in the meantime and syncs once the project is back.

## 2. Put it online (GitHub Pages, free)

1. Push this folder to a GitHub repo called `billsplit`:
   ```bash
   git init && git add . && git commit -m "Billsplit"
   git branch -M main
   git remote add origin https://github.com/<you>/billsplit.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. *(Optional, recommended)* Go to **Settings → Secrets and variables → Actions → Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The Supabase connection is then built in and neither phone has to paste it.
4. Every push to `main` builds, tests and deploys to `https://<you>.github.io/billsplit/`. You can follow it in the **Actions** tab.

GitHub Pages on a free account needs a public repo. That's fine because the repo contains only code. Your expenses live in Supabase behind your logins.

## 3. Install on your phones

- **iPhone (Safari):** open the site, tap **Share → Add to Home Screen**.
- **Pixel (Chrome):** open the site, tap **⋮ → Install app** (or **Add to Home screen**).

On first open, pick whose phone it is. Then go to **Settings → Sync between phones**, paste the URL and key if you didn't build them in, and sign in with that person's email and password. You only need to do this once per phone.

**Moving from Splitwise:** open your group in Splitwise, then **Settings → Export as spreadsheet**. In Billsplit, go to **Settings → Import from Splitwise** and choose which column is Tom. Payments come across as settlements, so the running balance matches Splitwise's.

---

## How the split works

Every expense has **who paid** and **whose cost it is**:

| Paid by | Whose cost | Result |
|---|---|---|
| Tom | 50/50 | Nuria owes Tom half |
| Tom | All Nuria's | Nuria owes Tom the full amount |
| Tom | All Tom's | Nobody owes anything, but it still counts in Spending |
| Nuria | Custom 70/30 (Tom/Nuria) | Tom owes Nuria 70% |

The form always spells out the result ("Nuria owes Tom £12.30") before you save.

For a receipt, the Tom items plus half the Shared items are Tom's cost, and the rest is Nuria's. It's saved as one expense with a custom split, and the item list is kept on the expense.

## Develop locally

```bash
npm install
npm run dev      # opens on your network too – visit the "Network" URL from your phone
npm test         # balance maths, recurring dates, receipt parsing, Splitwise import
npm run build
```

Without Supabase configured, the app runs in local-only mode (data stays in that browser). Copy `.env.example` to `.env.local` if you want the connection baked into dev builds.

### Project layout

```
src/lib/          plain TypeScript logic (unit-tested in lib.test.ts)
  money.ts        shares, balance, formatting
  recurring.ts    schedule maths (deterministic ids so two phones never duplicate)
  receipt.ts      image clean-up, Tesseract OCR, line/price parser
  categories.ts   categories, keyword auto-categorisation, learned rules
  fx.ts           ExchangeRate-API with offline cache
  store.ts        local-first store with change queue
  persist.ts      phone storage (IndexedDB, migrates older localStorage data)
  sync.ts         Supabase push/pull + realtime, last-write-wins
  splitwise.ts    Splitwise CSV import
src/components/   screens and sheets (React)
supabase/schema.sql  one table + row-level security + conflict-resolving trigger
public/sw.js      offline caching
scripts/copy-ocr.mjs copies the OCR engine + English data into public/ocr at build time
```

**Sync model.** Each phone writes locally first. Changes are pushed to a single `entries` table, and the other phone picks them up instantly over Supabase Realtime (or on the next open). If both phones edit the same item while offline, the most recent edit wins. Deletes are soft, so the other phone learns about them, and each has an **Undo**.

**Receipt tips.** Lay the receipt flat, use good light, and fill the frame. For a long receipt, photograph it in sections with **Take photo** under "Receipt longer than one photo?", overlapping the last few lines each time; lines that appear in both photos are counted once (and **Undo** is there if it gets it wrong). The scanner tries up to three clean-up recipes per photo and keeps the one whose items add up to the printed total (or the card payment line). Per-item discounts are folded into their item, and whole-basket savings after the subtotal are shared in proportion. If it still doesn't add up, the app warns you so you can fix a misread line. Faint dot-matrix printing is the hardest case for the on-phone reader.
