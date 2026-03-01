#!/usr/bin/env node
/**
 * Fetch golf player IDs for Best Ball headshots using ESPN's golf leaderboard API.
 *
 * Uses the leaderboard endpoint with event= (not tournamentId=) so that historical
 * events return that event's competitors. Fetches current event + historical majors
 * to build a name -> ESPN ID map for headshot URLs.
 *
 * Run: node scripts/fetch-golf-player-ids.js
 * Headshot URL: https://a.espncdn.com/i/headshots/golf/players/full/{id}.png
 * Output: golf/data/golf-player-ids.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const LEADERBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard';

// Current/weekend events: default leaderboard (no params) returns the live event.

// Historical majors: use event= (not tournamentId=). One event per tournament;
// failed fetches are skipped. Order: by year 1999–2026, then Masters / PGA / U.S. Open / Open.
const HISTORICAL_EVENT_IDS = [
  // 1999–2004
  '127',   // Masters
  '15',    // Masters
  '25',    // U.S. Open 2001
  // 2005–2008
  '210',   // Masters 2005
  '219',   // U.S. Open 2005
  '309',   // Masters 2007
  '425',   // Masters 2008
  '433',   // U.S. Open 2008
  '411',   // British Open 2008
  '439',   // PGA Championship 2008
  // 2009
  '545',   // U.S. Open 2009
  // 2010
  '774',   // Masters 2010
  '797',   // U.S. Open 2010
  // 2011
  '980',   // Masters 2011
  // 2012–2013
  '1192',  // Masters 2013
  '1200',  // U.S. Open 2013
  // 2014–2015
  '1317',  // Masters 2014
  '2241',  // Masters 2015
  '2249',  // U.S. Open 2015
  // 2016–2017
  '2493',  // Masters 2016
  '2505',  // The Open 2016
  '2700',  // Masters 2017
  '2710',  // The Open 2017
  // 2018–2019
  '401025255', // U.S. Open 2018
  '401025263', // PGA Championship 2018
  '401056527', // Masters 2019
  '401056556', // U.S. Open 2019
  // 2020
  '401219478', // Masters 2020
  '401219333', // U.S. Open 2020
  '401219481', // PGA Championship 2020
  // 2021
  '401243010', // Masters 2021
  '401243414', // U.S. Open 2021
  // 2022
  '401353232', // Masters 2022
  '401353226', // PGA Championship 2022
  '401353222', // U.S. Open 2022
  '401353217', // The Open 2022
  // 2023
  '401465508', // Masters 2023
  '401465533', // U.S. Open 2023
  '401465539', // The Open 2023
  // 2024
  '401580353', // PGA Championship 2024
  '401580354', // The Open Championship 2024
  '401580355', // U.S. Open 2024
  // 2025
  '401703504', // Masters 2025
  '401703511', // PGA Championship 2025
  '401703515', // U.S. Open 2025
  '401703521', // The Open 2025
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        });
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractPlayersFromLeaderboard(json) {
  const lookup = {};
  const events = json.events || [];
  for (const event of events) {
    const competitions = event.competitions || [];
    for (const comp of competitions) {
      const competitors = comp.competitors || [];
      for (const c of competitors) {
        const athlete = c.athlete;
        if (athlete && athlete.id && athlete.displayName) {
          const name = athlete.displayName.trim();
          const id = String(athlete.id).trim();
          if (name && id) lookup[name] = id;
        }
      }
    }
  }
  return lookup;
}

async function main() {
  console.log('Fetching golf player IDs from ESPN leaderboard API...\n');

  const allPlayers = {};

  // 1) Default leaderboard (current event)
  try {
    process.stdout.write('  Default leaderboard... ');
    const json = await fetch(LEADERBOARD_URL);
    const batch = extractPlayersFromLeaderboard(json);
    const n = Object.keys(batch).length;
    Object.assign(allPlayers, batch);
    console.log(`${n} players`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }

  await sleep(300);

  // 2) Historical majors (event= returns that event's competitors)
  for (const eventId of HISTORICAL_EVENT_IDS) {
    try {
      process.stdout.write(`  Event ${eventId}... `);
      const json = await fetch(`${LEADERBOARD_URL}?event=${eventId}`);
      const batch = extractPlayersFromLeaderboard(json);
      const n = Object.keys(batch).length;
      let added = 0;
      for (const [name, id] of Object.entries(batch)) {
        if (!allPlayers[name]) {
          allPlayers[name] = id;
          added++;
        }
      }
      console.log(`${n} total, ${added} new`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
    }
    await sleep(400);
  }

  // Preserve any existing manual overrides (existing file wins on name conflict)
  const outPath = path.join(__dirname, '..', 'golf', 'data', 'golf-player-ids.json');
  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      const existingPlayers = existing.players || {};
      let overrides = 0;
      for (const [name, id] of Object.entries(existingPlayers)) {
        if (!allPlayers[name]) {
          allPlayers[name] = id;
          overrides++;
        }
      }
      if (overrides) console.log(`  Kept ${overrides} existing entries from current file.`);
    } catch (_) {}
  }

  const count = Object.keys(allPlayers).length;
  const out = {
    source: 'espn-golf-leaderboard',
    fetchedAt: new Date().toISOString(),
    count,
    players: allPlayers,
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n✓ Wrote ${count} players to golf/data/golf-player-ids.json`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
