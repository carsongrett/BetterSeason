# Better Season

Daily NFL stat comparison game. Pick which player had the better season across three categories.

## Run locally

The game loads CSV data via `fetch`, so you need a local server (no `file://`):

```bash
npx serve
```

Then open the URL shown (e.g. http://localhost:3000).

## Data format

- CSV files live in `data/` with naming `{pos}_{year}.csv` (e.g. `qb_2024.csv`).
- Each CSV must have headers; first row is treated as column names.
- Quoted fields are supported. Player, Team, Pos, and stat columns (Yds, TD, Rec, Cmp%, Int, Rate, Y/A) are expected.

## Daily mode

Before launch, update `game.js`:

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

**Issue:** If any single CSV fetch or parse fails, the entire `loadData()` throws and the user sees a generic "Failed to load data" message. It's unclear which file caused the problem.

**Recommendation:** Add per-file try/catch and surface which file failed:

```javascript
for (const f of FILES) {
  try {
    const res = await fetch(`data/${f}.csv`);
    if (!res.ok) throw new Error(`${f}.csv: ${res.status}`);
    const text = await res.text();
    // ... parse and add to all
  } catch (err) {
    console.error(`Failed to load ${f}.csv:`, err);
    throw new Error(`Could not load ${f}.csv: ${err.message}`);
  }
}
```

You can also collect failed files and show a list to the user instead of failing entirely.

### Blitz timer / Confirm button

**Issue:** When Blitz time hits 0, `endBlitz()` runs on the next timer tick. Until then, the user can still click "Confirm" or "Next round" once. The click is ignored (`goNextBlitz` returns early), but the button remains enabled and can be confusing.

**Recommendation:** Disable the Confirm button as soon as time expires:

- In the timer callback, when `state.blitzTimeLeft <= 0`, also run something like `confirmBtn.disabled = true` (or set `confirmBtn.textContent = 'Time\'s up!'`).
- Alternatively, set `confirmBtn.disabled = true` at the start of `endBlitz()` before calling `showResults()`.

This makes it clear that no further input is allowed.
