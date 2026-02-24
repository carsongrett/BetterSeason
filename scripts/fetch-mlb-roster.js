#!/usr/bin/env node
/**
 * Fetch MLB roster data from statsapi.mlb.com to get player IDs and names.
 *
 * Uses the public MLB Stats API (no key required). Fetches all 30 team rosters
 * for the given season and builds a name → player ID map for headshots.
 * Run: node scripts/fetch-mlb-roster.js
 *
 * Output: data/mlb-player-ids.json — used to build headshot URLs
 *         (img.mlbstatic.com/mlb-images/image/upload/v1/people/{id}/headshot/silo/current)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SEASON = 2025;
const TEAMS_URL = `https://statsapi.mlb.com/api/v1/teams?season=${SEASON}&sportId=1`;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Players in our CSV that may not match API name (e.g. spelling); add as needed.
const NAME_OVERRIDES = {};

function main() {
  console.log(`Fetching MLB teams for ${SEASON}...`);

  fetch(TEAMS_URL)
    .then(async (teamsData) => {
      const teams = teamsData.teams || [];
      const lookup = {};

      for (const team of teams) {
        const teamId = team.id;
        const teamName = team.name || team.shortName || teamId;
        const rosterUrl = `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?season=${SEASON}`;
        process.stdout.write(`  ${teamName}... `);
        try {
          const rosterData = await fetch(rosterUrl);
          const roster = rosterData.roster || [];
          for (const entry of roster) {
            const person = entry.person;
            if (person && person.id && person.fullName) {
              lookup[person.fullName] = String(person.id);
            }
          }
          console.log(`${roster.length} players`);
        } catch (err) {
          console.log(`failed: ${err.message}`);
        }
        await sleep(200);
      }

      Object.assign(lookup, NAME_OVERRIDES);

      const out = {
        season: String(SEASON),
        source: 'statsapi.mlb.com',
        fetchedAt: new Date().toISOString(),
        count: Object.keys(lookup).length,
        players: lookup,
      };

      const outPath = path.join(__dirname, '..', 'data', 'mlb-player-ids.json');
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

      console.log(`\n✓ Wrote ${Object.keys(lookup).length} players to data/mlb-player-ids.json`);
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

main();
