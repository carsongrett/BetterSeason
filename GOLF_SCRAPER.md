# ESPN Golf Scraper — How to Run

## 1. Install Python dependency

From the **Bigger Season** folder (repo root):

```bash
pip install requests
```

## 2. Run the scraper

```bash
python scrape_espn_golf.py
```

- **First run:** Discovers PGA events (2016–2023) by calling the scoreboard API weekly, saves them to `event_ids.json`, then scrapes each event’s leaderboard and writes to `golf_data.db`. At the end it exports `golf/data/golf_results.csv` for the game.
- **Interrupted?** Run again: it skips events already in the DB and continues.
- **Rate limiting:** The script waits 1.5s between requests and backs off on 429.

## 3. Output files

| File | Purpose |
|------|--------|
| `golf_data.db` | SQLite DB with `events` and `results` tables |
| `event_ids.json` | List of discovered event IDs (used for resume) |
| `golf/data/golf_results.csv` | CSV used by the Pick the Round game (overwrites sample) |

## 4. Use in the game

After the scraper finishes, reload the golf game (e.g. http://localhost:3000). It reads `golf/data/golf_results.csv`, so you’ll now see real ESPN data.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'requests'`** → Run `pip install requests`.
- **Empty or small CSV** → Some ESPN responses may structure data differently (e.g. majors). Check the console for “Skip …” messages; you can open `golf_data.db` with a SQLite viewer to see what was stored.
- **429 / blocks** → The script retries with backoff. If it happens a lot, increase `SLEEP_SEC` in the script.
