"""
Scrape PGA Tour tournament results from ESPN; store in SQLite and export CSV.

Run from repo root:
  1. pip install requests
  2. python scrape_espn_golf.py

Output:
  golf_data.db      — SQLite (events + results)
  event_ids.json    — checkpoint of event IDs
  golf/data/golf_results.csv — used by the Pick the Round game
  golf/data/golf_results_backup.csv — backup of CSV before each run (one file, overwritten)
"""

import json
import re
import shutil
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
YEARS = list(range(1999, 2027))  # 1999 through 2026
SLEEP_SEC = 1.5
RETRIES = 3
BACKOFF = 2.0
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"

REPO_ROOT = Path(__file__).resolve().parent
EVENT_IDS_JSON = REPO_ROOT / "event_ids.json"
DB_PATH = REPO_ROOT / "golf_data.db"
CSV_PATH = REPO_ROOT / "golf" / "data" / "golf_results.csv"
BACKUP_PATH = REPO_ROOT / "golf" / "data" / "golf_results_backup.csv"


def clean_event_name(name):
    """Remove 'Pres. by X' / 'presented by X' sponsor suffix from event names."""
    if not name or not isinstance(name, str):
        return name or ""
    return re.sub(r"\s+([Pp]res\.?|[Pp]resented)\s+[Bb]y\s+.+$", "", name).strip()


def is_ascii_player_name(name):
    """True if name is pure ASCII (avoids mojibake / encoding display issues)."""
    if not name or not isinstance(name, str):
        return False
    try:
        name.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


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
    event_name = clean_event_name(ev.get("name") or event.get("name") or "")
    event_date = ev.get("date") or event.get("date") or ""
    year = event_date[:4] if event_date else (event.get("date", "")[:4] or "")

    rows = []
    for c in competitors:
        name = (c.get("athlete") or {}).get("displayName") or ""
        name = name.strip()
        if not is_ascii_player_name(name):
            continue
        pos = (c.get("status") or {}).get("displayValue") or ""
        score_to_par = parse_score_to_par(c)
        rows.append({
            "player_name": name,
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
    """Export all results to CSV (full overwrite). Used for --clear runs."""
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


def append_results_to_csv(conn, path, event_ids):
    """Append only results for the given event_ids to CSV (no header). Creates file with header if missing."""
    if not event_ids:
        return 0
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    placeholders = ",".join("?" for _ in event_ids)
    cur = conn.execute(
        """SELECT player_name, event_name, year, score_to_par, position
           FROM results WHERE score_to_par IS NOT NULL AND event_id IN (%s)
           ORDER BY year, event_name, player_name"""
        % placeholders,
        list(event_ids),
    )
    rows = cur.fetchall()
    write_header = not path.exists()
    with path.open("a", encoding="utf-8") as f:
        if write_header:
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
    else:
        if CSV_PATH.exists():
            shutil.copy2(CSV_PATH, BACKUP_PATH)
            print(f"Backed up CSV to {BACKUP_PATH.name}")

    # Step 1: discover events (merge with existing so we can add older years without losing current data)
    events = []
    years_to_discover = list(YEARS)
    if EVENT_IDS_JSON.exists():
        print("Loading event IDs from", EVENT_IDS_JSON)
        with open(EVENT_IDS_JSON, encoding="utf-8") as f:
            events = json.load(f)
        years_present = {e.get("date", "")[:4] for e in events if (e.get("date") or "")[:4].isdigit()}
        years_to_discover = [y for y in YEARS if str(y) not in years_present]
        if years_to_discover:
            print(f"Discovering events for years not in file: {min(years_to_discover)}–{max(years_to_discover)} ({len(years_to_discover)} years)")
        else:
            print(f"All years {min(YEARS)}–{max(YEARS)} already in event list ({len(events)} events).")
    if years_to_discover:
        est_discovery_mins = (len(years_to_discover) * 52 * SLEEP_SEC) // 60 + 1
        print(f"  ~{len(years_to_discover) * 52} scoreboard calls, est. ~{est_discovery_mins} min...")
        new_events = discover_event_ids(session, years_to_discover)
        existing_by_id = {e["id"]: e for e in events}
        for e in new_events:
            existing_by_id[e["id"]] = e
        events = sorted(existing_by_id.values(), key=lambda x: (x.get("date") or "", x.get("id") or ""))
        with open(EVENT_IDS_JSON, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
        print(f"  Total unique events: {len(events)}")

    scraped = get_scraped_event_ids(conn)
    to_scrape = [e for e in events if e["id"] not in scraped]
    scrape_est = int(len(to_scrape) * SLEEP_SEC / 60) + 1
    print(f"Events to scrape: {len(to_scrape)} (already done: {len(scraped)}) — est. ~{scrape_est} min")

    scraped_this_run = set()

    # Step 2: scrape each event
    for i, ev in enumerate(to_scrape):
        try:
            rows = scrape_leaderboard(session, ev)
            if rows:
                save_to_db(conn, rows, ev["id"])
                scraped_this_run.add(ev["id"])
            print(f"  [{i+1}/{len(to_scrape)}] {ev.get('name', ev['id'])} — {len(rows)} players")
        except Exception as e:
            print(f"  Skip {ev.get('name', ev['id'])}: {e}")
        time.sleep(SLEEP_SEC)

    # Export: full overwrite on --clear, else append only new results
    if clear_db:
        n = export_csv(conn, CSV_PATH)
        print(f"Exported {n} rows to {CSV_PATH} (full)")
    elif scraped_this_run:
        n = append_results_to_csv(conn, CSV_PATH, scraped_this_run)
        print(f"Appended {n} rows to {CSV_PATH}")
    else:
        print("No new events scraped; CSV unchanged.")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
