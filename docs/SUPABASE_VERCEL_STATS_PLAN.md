# Supabase + Vercel: User Stats, Leaderboards & Percentile

Plan to track scores, show leaderboards, and give feedback like “You scored in the 89th percentile.”

---

## 1. Current state

- **Main app** (`game.js`): Saves score in `storeDailyScore(score, sport, mode, roundScores)` to localStorage. Daily key = e.g. `betterseason_nfl_daily`. Game seed for daily = `getTodaySeed()` (date) or mode-specific day seed (e.g. blind resume).
- **Golf** (`golf/game.js`): Score = sum of 4 picks (score to par). No backend. Seed = `Date.now()` (new puzzle every load), so there is no shared “daily puzzle” yet.

---

## 2. Goals

1. **Track** each completed game: sport, mode, puzzle id, score, (optional) user.
2. **Leaderboards** per puzzle: e.g. “Top 10 for NFL Daily – Feb 26”.
3. **Percentile** after submit: e.g. “You scored in the 89th percentile” (you beat 89% of players on this puzzle).

---

## 3. Supabase

### 3.1 Project

- Create a Supabase project (or use existing).
- Use **anon** key in the frontend (safe if RLS is strict). Optionally use a Vercel serverless route to proxy and hide the key; not required for MVP.

### 3.2 Table: `scores`

| Column        | Type      | Description |
|---------------|-----------|-------------|
| `id`          | `uuid`    | PK, default `gen_random_uuid()` |
| `puzzle_id`   | `text`    | Unique per puzzle (see below). Indexed. |
| `sport`       | `text`    | `nfl`, `nba`, `mlb`, `pga` |
| `mode`        | `text`    | `daily`, `rookie_qb`, `blind_resume`, etc. |
| `score`       | `integer` | Raw score (points for main app; sum to par for golf). |
| `score_display` | `integer` | Optional: “max possible” for display (e.g. 5/5). |
| `higher_is_better` | `boolean` | `true` main app, `false` golf (lower = better). |
| `anonymous_id` | `text`   | Client-generated UUID (localStorage), for “one submission per device per puzzle” and optional display. |
| `user_id`     | `uuid`    | Nullable; Supabase Auth user if you add login later. |
| `created_at`  | `timestamptz` | Default `now()`. |

- **Unique constraint** (optional but recommended): `(puzzle_id, anonymous_id)` so one submission per device per puzzle (and same for `user_id` when present).
- **Indexes**: `puzzle_id`, `(puzzle_id, score)`, `(puzzle_id, created_at)` for leaderboard and percentile queries.

### 3.3 Puzzle ID format

- **Main app daily**: `{date}_{sport}_{mode}`  
  - Example: `2025-02-26_nfl_daily`, `2025-02-26_nba_blind_resume_nba`.  
  - Use the same seed logic you already use for “today’s game” (e.g. `getTodaySeed()`, blind resume day seed).
- **Golf**:  
  - Today-only puzzle: `{date}_pga_majors` or `{date}_pga_all` (requires **golf to use a date-based seed** so everyone gets the same board for the day).  
  - Keep `mode` in DB as `pick_the_round_majors` / `pick_the_round` if you like.

So: **puzzle_id** = single canonical string that identifies “this exact daily puzzle” for both main app and golf.

### 3.4 RLS (Row Level Security)

- **Insert**: Allow anyone (anon) to insert a row (optionally restrict to your frontend origin via `request.headers` in a rule, or keep open for MVP).
- **Select**: Allow anyone to read (needed for leaderboards and percentile). Optionally restrict to only aggregate/leaderboard views later.
- **Update/Delete**: Deny for anon (no editing/deleting others’ scores).

---

## 4. Vercel

- **Static site**: Keep current deployment (HTML/JS/CSS). No change required for “just Supabase from client.”
- **Optional API routes** (e.g. `/api/submit-score`, `/api/leaderboard`, `/api/percentile`):
  - Use **Vercel serverless functions** in `/api/` to call Supabase with the **service_role** key (never exposed). Use when you want to:
    - Enforce server-side checks (e.g. rate limit, validate puzzle_id/score).
    - Compute percentile or leaderboard in one place and return JSON.
  - **MVP**: Call Supabase from the browser with **anon** key + RLS is enough; add API routes when you want stricter control or to hide keys.

**Env on Vercel**:  
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `SUPABASE_*` if only used in API routes).

---

## 5. Client flow

### 5.1 Anonymous ID

- On first visit, generate a UUID (e.g. `crypto.randomUUID()`), store in `localStorage` (e.g. `betterseason_anonymous_id`).
- Send this with every submit so you can:
  - Enforce “one submission per puzzle per device” (unique on `(puzzle_id, anonymous_id)`).
  - Show “Your rank” or “You” on leaderboards without requiring login.

### 5.2 Submit score (main app)

- When you call `storeDailyScore(score, sport, mode, roundScores)` (daily / rookie_qb / mlb / blind resume), **also**:
  - Build `puzzle_id` = `getTodaySeed()` (or the same seed string you use for the game) + `_` + sport + `_` + mode (normalize mode to match DB, e.g. `blind_resume`, `blind_resume_nba`).
  - POST to Supabase: insert into `scores` with `puzzle_id`, `sport`, `mode`, `score`, `score_display` (e.g. total rounds), `higher_is_better: true`, `anonymous_id`.
- Same place you currently call `storeDailyScore` (after last round, before/with `showResults`).

### 5.3 Submit score (golf)

- **Prerequisite**: Make golf daily if you want same-puzzle leaderboards: e.g. seed = date string (e.g. `YYYY-MM-DD`) or `YYYY-MM-DD_majors` / `YYYY-MM-DD_all` so everyone gets the same 4 golfers and cards for the day.
- When user finishes (all 4 picks), compute total (sum to par). Insert into `scores`: `puzzle_id` = e.g. `2025-02-26_pga_majors`, `sport: 'pga'`, `mode: 'pick_the_round_majors'`, `score` = that sum, `higher_is_better: false`, `anonymous_id`.

### 5.4 Percentile (after submit)

- **Higher-is-better (main app)**:  
  Percentile = (count of rows where `puzzle_id = ?` and `score < my_score`) / (total count for puzzle) * 100.  
  (Or “strictly below”: count `score < my_score`; then percentile = below / (total - 1) if you prefer.)
- **Lower-is-better (golf)**:  
  Percentile = (count where `score > my_score`) / total * 100 (worse score = higher number; you beat them).
- Options:
  - **Client**: After insert, run a Supabase query: `select score from scores where puzzle_id = ? order by score desc` (main) or `order by score asc` (golf), then compute percentile in JS.
  - **Server**: Vercel function or Supabase RPC that takes `puzzle_id` and `my_score`, returns `{ percentile, total_players }` so you don’t send all scores to the client.

Show in UI: “You scored in the 89th percentile (better than 89% of players).”

### 5.5 Leaderboard

- Query: `select anonymous_id, score, created_at from scores where puzzle_id = ? order by score desc limit 20` (main) or `order by score asc limit 20` (golf).
- Display: “Top 20” with rank; optionally show “You” next to the row where `anonymous_id` matches (or `user_id` when you add auth). Mask names as “Player #abc” or “Anonymous” if you only have `anonymous_id`.
- Place to show: results screen (main app and golf) and/or a small “Leaderboard” tab or section.

---

## 6. Golf: daily puzzle (recommended for leaderboards)

- In `golf/game.js`, replace `getSeed()` (currently `Date.now()`) with a **date-based seed** so the same calendar day produces the same puzzle for everyone, e.g.:

  ```js
  function getSeed() {
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return state.easyMode ? `${dateStr}_majors` : `${dateStr}_all`;
  }
  ```

- Then `puzzle_id` for DB can be `2025-02-26_pga_majors` or `2025-02-26_pga_all` (and use the same string as seed, or derive from `state.easyMode` + date).

---

## 7. Implementation order

1. **Supabase**: Create project, `scores` table, RLS (insert + select for anon).
2. **Client**: Add anonymous_id (localStorage), small “stats” module: `submitScore(puzzleId, sport, mode, score, scoreDisplay, higherIsBetter)`, then `fetchPercentile(puzzleId, myScore, higherIsBetter)` (or call an RPC).
3. **Main app**: After `storeDailyScore`, call `submitScore` with current puzzle_id (from existing seed/date logic). On results screen, fetch and show percentile (and optionally leaderboard).
4. **Golf**: Switch to date-based seed; on results modal open, submit score and show percentile/leaderboard.
5. **Vercel**: Add env vars; optionally add `/api/submit-score` and `/api/leaderboard` (and `/api/percentile`) later for server-side validation and to hide anon key.

---

## 8. Optional later

- **Supabase Auth**: Optional sign-in; store `user_id` in `scores`; “My history” and persistent identity across devices.
- **One submission per puzzle**: Enforce with unique `(puzzle_id, anonymous_id)` and handle 409 in UI (“Already submitted for today”).
- **Rate limiting**: In API route or Supabase (e.g. pg_net or edge function) to avoid spam.
- **Caching**: Cache leaderboard/percentile in Supabase or Vercel for 1–5 minutes to reduce read load.

---

## 9. Summary

| Item | Action |
|------|--------|
| **Supabase** | New table `scores`; puzzle_id + sport + mode + score + anonymous_id; RLS insert/select. |
| **Vercel** | Env for Supabase URL + anon key; optional `/api` routes later. |
| **Main app** | Submit score after `storeDailyScore`; show percentile (and leaderboard) on results. |
| **Golf** | Date-based seed so puzzle_id is shared; submit on finish; show percentile/leaderboard. |
| **Percentile** | Query counts by puzzle_id and compare to my_score (direction by higher_is_better). |

This gives you tracking, leaderboards, and “You scored in the 89th percentile” with Supabase + Vercel and minimal backend code.
