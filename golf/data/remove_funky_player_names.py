"""
One-time cleanup: remove all rows where player_name contains non-ASCII characters.
Run from repo root: python golf/data/remove_funky_player_names.py
This rewrites golf/data/golf_results.csv (no backup here; scraper already backs up on run).
"""

import csv
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CSV_PATH = SCRIPT_DIR / "golf_results.csv"


def main():
    with open(CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = [header]
        removed = 0
        for row in reader:
            if len(row) < 2:
                rows.append(row)
                continue
            name = row[0]
            try:
                name.encode("ascii")
            except UnicodeEncodeError:
                removed += 1
                continue
            rows.append(row)

    with open(CSV_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)

    print(f"Removed {removed} rows with non-ASCII player names. Wrote {CSV_PATH}")


if __name__ == "__main__":
    main()
