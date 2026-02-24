#!/usr/bin/env node
/**
 * Step 1: Fetch NBA roster data to get player IDs and names.
 *
 * Uses the Basketball-GM community roster (GitHub), which includes NBA
 * headshot URLs. stats.nba.com blocks or times out, so this source is more reliable.
 * Run: node scripts/fetch-nba-roster.js
 *
 * Output: data/nba-player-ids.json — a mapping of player name → player ID
 *         used to build headshot URLs (cdn.nba.com/headshots/nba/latest/1040x760/{id}.png)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROSTER_URL = 'https://raw.githubusercontent.com/alexnoob/BasketBall-GM-Rosters/master/2024-25.NBA.Roster.json';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function extractPersonIdFromImgUrl(imgURL) {
  if (!imgURL || typeof imgURL !== 'string') return null;
  const match = imgURL.match(/\/(\d+)\.png$/);
  return match ? match[1] : null;
}

// Players missing from Basketball-GM roster but needed for headshots (e.g. different name in our CSV).
const NAME_OVERRIDES = {
  'Giannis Antetokounmpo': '203507',
};

function main() {
  console.log('Fetching NBA roster from Basketball-GM (GitHub)...');

  fetch(ROSTER_URL)
    .then((json) => {
      const players = json.players;
      if (!Array.isArray(players)) {
        throw new Error('Expected "players" array in roster JSON');
      }

      const lookup = {};
      for (const p of players) {
        const name = p.name;
        const id = extractPersonIdFromImgUrl(p.imgURL);
        if (name && id) {
          lookup[name] = id;
        }
      }
      Object.assign(lookup, NAME_OVERRIDES);

      const out = {
        season: '2024-25',
        source: 'BasketBall-GM-Rosters',
        fetchedAt: new Date().toISOString(),
        count: Object.keys(lookup).length,
        players: lookup,
      };

      const outPath = path.join(__dirname, '..', 'data', 'nba-player-ids.json');
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

      console.log(`✓ Wrote ${Object.keys(lookup).length} players to data/nba-player-ids.json`);
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

main();
