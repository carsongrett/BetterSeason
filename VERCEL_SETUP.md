# Vercel setup for Better Season stats API

Your game stays on **GitHub Pages** (betterseason.live). Only the **stats API** runs on Vercel. The game sends each completed play to Vercel and shows “Today: X games · Avg Y” on the results screen.

---

## 1. Create a Vercel account and install CLI (optional)

- Go to [vercel.com](https://vercel.com) and sign in with GitHub.
- Optional: install the CLI for local runs and deploys:
  ```bash
  npm i -g vercel
  ```

---

## 2. Deploy this repo to Vercel

**Option A – Deploy from the Vercel dashboard**

1. In the Vercel dashboard, click **Add New… → Project**.
2. Import your **BetterSeason** repo (the one that contains `api/`, `game.js`, `index.html`).
3. Leave **Root Directory** as `.` and **Framework Preset** as **Other** (or **Vite** if it detects something; it doesn’t matter for the API).
4. Click **Deploy**. Wait for the build to finish.
5. Copy your project URL, e.g. `https://betterseason-xxxx.vercel.app`.

**Option B – Deploy from the CLI**

1. In the project folder:
   ```bash
   cd "c:\Users\cmgre\OneDrive\Documents\Bigger Season"
   vercel
   ```
2. Log in or link the project when prompted. Follow the prompts to deploy.
3. Copy the deployment URL Vercel prints (e.g. `https://betterseason-xxxx.vercel.app`).

---

## 3. Add a Redis database (Upstash)

Vercel KV is deprecated; use **Upstash Redis** from the Vercel Marketplace.

1. In the Vercel dashboard, open your **BetterSeason** project.
2. Go to the **Storage** tab (or **Integrations**).
3. Click **Create Database** / **Add Integration** and choose **Upstash Redis** (or search “Redis” in the Marketplace).
4. Create a new Upstash Redis database (or connect an existing one). Name it e.g. `betterseason-stats`.
5. Attach it to this **Vercel project**. Vercel will add env vars like:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
6. **Redeploy** the project (Deployments → … on latest → Redeploy) so the new env vars are used.

---

## 4. Point the game at your API

In **game.js**, `STATS_API_BASE` is set to your Vercel URL (e.g. `https://betterseasonvercel.vercel.app`). If you use a different deployment URL, update that constant and commit/push.

---

## 5. Check that it works

1. Open your site (e.g. https://betterseason.live).
2. Play a game to completion (any sport/mode).
3. On the results screen you should see something like: **“12 games today · Avg 6.2/9”** (or “Avg 45 pts” for Blitz).
4. If you don’t see it: open the browser dev tools (F12) → Network tab, and look for requests to `…/api/play` and `…/api/stats`. If they fail, check CORS (your site origin must be in the allowed list in `api/lib/cors.js`) and that the Redis env vars are set on Vercel.

---

## Local development (optional)

To run and test the API locally with your Redis database:

1. **Link the project** (if you haven’t): from the project folder run `vercel link` and choose your Vercel project.
2. **Pull env vars** so the API can connect to Redis:
   ```bash
   vercel env pull .env.development.local
   ```
   That creates `.env.development.local` with `bstorage_REDIS_URL` (or similar). Don’t commit this file.
3. **Install dependencies**: `npm install` (includes the `redis` package the API uses).
4. **Run the dev server**: `vercel dev` to serve the site and API locally, or use your own static server for the game and hit the deployed API.

---

## Summary

| What              | Where it runs        |
|-------------------|----------------------|
| Game (HTML/JS/CSS)| GitHub Pages (betterseason.live) |
| Stats API         | Vercel (your *.vercel.app URL)   |
| Database          | Upstash Redis (via Vercel)       |

- **POST /api/play** – records one play (sport, mode, score).
- **GET /api/stats?date=YYYY-MM-DD&sport=nfl&mode=daily** – returns `gamesPlayed` and `averageScore` for that day and mode.

If you add a custom domain for the Vercel project later, update `STATS_API_BASE` in `game.js` to that domain and add it to `api/lib/cors.js` in `ALLOWED_ORIGINS`.

---

## Troubleshooting: stats never show / wrong commit deployed

**Symptom:** Vercel builds an old commit (e.g. `47534c6`), but your API and recent changes are in commits like `d26d165`, `531d330`. Stats never appear on the results screen.

**Cause:** Vercel is connected to the **wrong GitHub repo**. This project’s code lives in:

- **Correct repo:** `https://github.com/carsongrett/BetterSeason` (has `api/`, `vercel.json`, `game.js`)

If Vercel is linked to a different repo (e.g. `betterseasonvercel` or an old `Bigger-Season`), it will only have that repo’s commits, so it never deploys your API.

**Fix:**

1. In Vercel: open your project → **Settings** → **Git**.
2. **Disconnect** the current repository (e.g. betterseasonvercel).
3. **Connect** the repo that has your code: **BetterSeason** (`carsongrett/BetterSeason`).
4. Set **Production Branch** to `main` (or the branch you push to).
5. Trigger a deploy (push a commit to that branch, or **Deployments** → … → **Redeploy**).
6. In **Settings** → **Environment Variables**, re-add Upstash Redis vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) if this is a new project link—they don’t carry over.
7. In **game.js**, set `STATS_API_BASE` to the **new** Vercel URL (e.g. `https://betterseason-xxxx.vercel.app`) and add that URL to `api/lib/cors.js` in `ALLOWED_ORIGINS` if needed. Commit and push.

After this, Vercel will build from BetterSeason and your stats API will be what the game calls.
