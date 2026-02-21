# Bigger Season

Daily NFL stat comparison game. Pick which player had the better season across three categories.

## Run locally

The game loads CSV data via `fetch`, so you need a local server (no `file://`):

```bash
npx serve
```

Then open the URL shown (e.g. http://localhost:3000).

## Daily mode

Before launch, update `game.js`:

1. In `getGameSeed()`: use `return getTodaySeed();` (line ~12)
2. In `getRound3Position()`: use calendar day for WR/TE alternation (see DAILY MODE comment)
3. Remove the "New Game" button from the results screen
