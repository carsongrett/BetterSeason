"""
Scrape PGA Tour tournament results from ESPN; store in SQLite and export CSV.

Run from repo root:
  1. pip install requests
  2. python scrape_espn_golf.py

Output:
  golf_data.db      — SQLite (events + results)
  event_ids.json    — checkpoint of event IDs
  golf/data/golf_results.csv — export for the Pick the Round game (overwrites sample)
"""

import json
import sqlite3
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    raise

# --- config
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard"
LEADERBOARD_URL = "https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard"
YEARS = [2025]  # one year for testing; expand to list(range(2016, 2026)) for full history
SLEEP_SEC = 1.5
RETRIES = 3
BACKOFF = 2.0
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"

REPO_ROOT = Path(__file__).resolve().parent
EVENT_IDS_JSON = REPO_ROOT / "event_ids.json"
DB_PATH = REPO_ROOT / "golf_data.db"
CSV_PATH = REPO_ROOT / "golf" / "data" / "golf_results.csv"


def get_session():
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def get_with_retry(session, url):
    for attempt in range(RETRIES):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 429:
                wait = BACKOFF ** attempt
                print(f"  429, waiting {wait:.0f}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == RETRIES - 1:
                raise
            time.sleep(BACKOFF ** attempt)
    return None


def mondays_in_year(year):
    """Yield YYYYMMDD for each Monday in the year."""
    import datetime
    d = datetime.date(year, 1, 1)
    while d.year == year:
        if d.weekday() == 0:
            yield d.strftime("%Y%m%d")
        d += datetime.timedelta(days=1)


def discover_event_ids(session, years):
    """Hit scoreboard API for weekly dates; return list of {id, name, date}."""
    seen = {}
    for year in years:
        for date_str in mondays_in_year(year):
            url = f"{SCOREBOARD_URL}?dates={date_str}"
            try:
                data = get_with_retry(session, url)
            except Exception as e:
                print(f"  Skip {date_str}: {e}")
                continue
            events = data.get("events") or []
            for ev in events:
                eid = ev.get("id")
                if not eid:
                    continue
                if eid not in seen:
                    seen[eid] = {
                        "id": eid,
                        "name": ev.get("name", ""),
                        "date": ev.get("date", "")[:10] if ev.get("date") else "",
                    }
            time.sleep(SLEEP_SEC)
    return list(seen.values())


def parse_score_to_par(competitor):
    """Get score vs par from competitor; return int or None."""
    stats = competitor.get("statistics") or []
    for s in stats:
        if s.get("name") == "scoreToPar":
            raw = (s.get("displayValue") or "").strip()
            if raw == "E" or raw.upper() == "EVEN":
                return 0
            if not raw:
                return None
            try:
                return int(raw)
            except ValueError:
                return None
    score = competitor.get("score", {}).get("displayValue")
    if score is not None and isinstance(score, (int, float)):
        return int(score)
    return None


def scrape_leaderboard(session, event):
    """Fetch one event leaderboard; return list of row dicts."""
    url = f"{LEADERBOARD_URL}?event={event['id']}"
    data = get_with_retry(session, url)
    events_list = data.get("events") or []
    if not events_list:
        return []
    # Handle majors / different nesting
    if isinstance(events_list[0], list):
        events_list = events_list[0] if events_list else []
    ev = events_list[0] if events_list else {}
    competitions = ev.get("competitions") or []
    if not competitions:
        return []
    competitors = competitions[0].get("competitors") or []
    event_name = ev.get("name") or event.get("name") or ""
    event_date = ev.get("date") or event.get("date") or ""
    year = event_date[:4] if event_date else (event.get("date", "")[:4] or "")

    rows = []
    for c in competitors:
        name = (c.get("athlete") or {}).get("displayName") or ""
        pos = (c.get("status") or {}).get("displayValue") or ""
        score_to_par = parse_score_to_par(c)
        rows.append({
            "player_name": name.strip(),
            "event_name": event_name.strip(),
            "year": int(year) if year.isdigit() else 0,
            "score_to_par": score_to_par,
            "position": pos.strip(),
            "event_id": event["id"],
        })
    return rows


def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            event_name TEXT,
            year INTEGER,
            scraped INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS results (
            player_name TEXT,
            event_name TEXT,
            year INTEGER,
            score_to_par INTEGER,
            position TEXT,
            event_id TEXT,
            PRIMARY KEY (player_name, event_id)
        );
    """)


def save_to_db(conn, rows, event_id):
    if not rows:
        return
    year = rows[0].get("year") or 0
    event_name = rows[0].get("event_name") or ""
    conn.execute(
        "INSERT OR REPLACE INTO events (event_id, event_name, year, scraped) VALUES (?, ?, ?, 1)",
        (event_id, event_name, year),
    )
    for r in rows:
        conn.execute(
            """INSERT OR REPLACE INTO results
               (player_name, event_name, year, score_to_par, position, event_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                r["player_name"],
                r["event_name"],
                r["year"],
                r["score_to_par"],
                r["position"],
                r["event_id"],
            ),
        )
    conn.commit()


def get_scraped_event_ids(conn):
    cur = conn.execute("SELECT event_id FROM events WHERE scraped = 1")
    return {r[0] for r in cur.fetchall()}


def export_csv(conn, path):
    """Export results to CSV (only rows with non-null score_to_par)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cur = conn.execute(
        """SELECT player_name, event_name, year, score_to_par, position
           FROM results WHERE score_to_par IS NOT NULL
           ORDER BY year, event_name, player_name"""
    )
    rows = cur.fetchall()
    with path.open("w", encoding="utf-8") as f:
        f.write("player_name,event_name,year,score_to_par,position\n")
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\n")
    return len(rows)


def main():
    import sys
    clear_db = "--clear" in sys.argv or "-c" in sys.argv

    session = get_session()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    if clear_db:
        print("Clearing existing data (--clear)...")
        conn.execute("DELETE FROM results")
        conn.execute("DELETE FROM events")
        conn.commit()
        print("  Done. Proceeding with scrape.")

    # Step 1: discover events
    if EVENT_IDS_JSON.exists():
        print("Loading event IDs from", EVENT_IDS_JSON)
        with open(EVENT_IDS_JSON, encoding="utf-8") as f:
            events = json.load(f)
    else:
        years_str = ", ".join(str(y) for y in YEARS)
        # ~52 Mondays per year × 1.5s sleep
        est_discovery_mins = (len(YEARS) * 52 * SLEEP_SEC) // 60 + 1
        print(f"Discovering event IDs for {years_str} (~{len(YEARS) * 52} calls, ~{est_discovery_mins} min)...")
        events = discover_event_ids(session, YEARS)
        with open(EVENT_IDS_JSON, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
        print(f"  Found {len(events)} unique events")

    scraped = get_scraped_event_ids(conn)
    to_scrape = [e for e in events if e["id"] not in scraped]
    scrape_est = int(len(to_scrape) * SLEEP_SEC / 60) + 1
    print(f"Events to scrape: {len(to_scrape)} (already done: {len(scraped)}) — est. ~{scrape_est} min")

    # Step 2: scrape each event
    for i, ev in enumerate(to_scrape):
        try:
            rows = scrape_leaderboard(session, ev)
            if rows:
                save_to_db(conn, rows, ev["id"])
            print(f"  [{i+1}/{len(to_scrape)}] {ev.get('name', ev['id'])} — {len(rows)} players")
        except Exception as e:
            print(f"  Skip {ev.get('name', ev['id'])}: {e}")
        time.sleep(SLEEP_SEC)

    # Export
    n = export_csv(conn, CSV_PATH)
    print(f"Exported {n} rows to {CSV_PATH}")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
