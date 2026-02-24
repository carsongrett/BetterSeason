# Better Season

Athletic resume game. Pick which player had the better stat in each category. Supports NFL, NBA, and MLB.

## Current game modes

| Sport | Modes |
|-------|-------|
| NFL | Daily, Rookie QBs, Blind Resume |
| NBA | Daily |
| MLB | MLB Batters, MLB Pitchers |

**Blind Resume** (NFL, Daily): Guess the QB from their stats. Start at 0. +100 per correct guess, -10 per wrong. Score carries across rounds.

**Note:** Blitz and Unlimited have been removed from NFL and NBA and are planned to be replaced with new modes. The underlying code for Blitz/Unlimited remains in `game.js` but is not exposed in the UI.

## Run locally

The game loads CSV data via `fetch`, so you need a local server (no `file://`):

```bash
npx serve
```

Then open the URL shown (e.g. http://localhost:3000).

## Data format

- CSV files live in `data/`. NFL uses `{pos}_{year}.csv` (e.g. `qb_2024.csv`). Blind Resume uses `blind_qb_2025.csv` (columns: Player, Age, Team, Conference, Pass Yds, Pass TD, Int, Rush Yds, Game Winning Drives). MLB uses `baseball_batters_2025.csv` and `baseball_pitchers_2025.csv`. NBA uses `basketball_2026.csv`.
- Each CSV must have headers; first row is treated as column names.
- Quoted fields are supported. `Player`, `Team`, `Pos`, and sport-specific stat columns are expected.

## Player headshots (NBA & MLB)

Headshots are loaded from `data/nba-player-ids.json` and `data/mlb-player-ids.json`. To refresh:

- **NBA:** `node scripts/fetch-nba-roster.js` (uses Basketball-GM roster from GitHub).
- **MLB:** `node scripts/fetch-mlb-roster.js` (uses statsapi.mlb.com; takes ~15–20 seconds for all teams).

## Deployment config

Before launch, update `game.js`:

- `SHARE_URL_PLACEHOLDER` and `SHARE_X_USERNAME` for share links.
- `CNAME` file for custom domain (e.g. betterseason.live) if using GitHub Pages.

## Daily mode setup

For daily-only launch, update `game.js`:

1. In `getGameSeed()`: use `return getTodaySeed();` (line ~12)
2. In `getRound3Position()`: use calendar day for WR/TE alternation (see DAILY MODE comment)
3. Remove the "New Game" button from the results screen

## Recommended improvements

These changes improve robustness and UX. They are optional but suggested for maintainers.

### Empty pool fallback

**Issue:** In `initGame`, when `generateMatchup` returns `null`, the fallback uses `pool[0]` and `pool[1]` without checking pool length. With fewer than two players for a position, this will throw.

**Recommendation:** Add a length check before the fallback:

```javascript
if (!matchup) {
  if (!pool || pool.length < 2) {
    // Skip round or show an error message; do not assume pool[0]/pool[1] exist
    continue;
  }
  const a = pool[0], b = pool[1];
  // ...
}
```

Alternatively, ensure all position/year CSVs have at least two players that can form a valid matchup (different teams/seasons, yards ratio ≥ threshold, no stat ties).

### LoadData error handling

**Status:** Per-file try/catch is already in place; the thrown error includes the filename. For even better UX, you could collect failed files and show a list instead of failing entirely.

### Blitz timer / Confirm button (when Blitz is re-enabled)

**Issue:** When Blitz time hits 0, `endBlitz()` runs on the next timer tick. Until then, the user can still click "Confirm" or "Next round" once. The click is ignored (`goNextBlitz` returns early), but the button remains enabled and can be confusing.

**Recommendation:** Disable the Confirm button as soon as time expires in the timer callback (e.g. `confirmBtn.disabled = true`) or at the start of `endBlitz()`.
