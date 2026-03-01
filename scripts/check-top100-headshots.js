#!/usr/bin/env node
/**
 * Check which players in the top 100 rankings (downloaded_rankings.csv) do not have
 * a headshot in golf-player-ids.json. Run from repo root: node scripts/check-top100-headshots.js
 */

const fs = require('fs');
const path = require('path');

function normalizeNameForLookup(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function parseCSVLine(line) {
  const parts = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if ((c === ',' && !inQuotes) || c === '\r') {
      parts.push(cur.trim().replace(/^"|"$/g, ''));
      cur = '';
    } else cur += c;
  }
  if (cur.length) parts.push(cur.trim().replace(/^"|"$/g, ''));
  return parts;
}

const base = path.join(__dirname, '..');
const csvPath = path.join(base, 'golf', 'data', 'downloaded_rankings.csv');
const idsPath = path.join(base, 'golf', 'data', 'golf-player-ids.json');

const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.trim().split(/\r?\n/);
const header = parseCSVLine(lines[0]);
const nameIdx = header.findIndex((h) => h.trim() === 'NAME');
const rankIdx = header.findIndex((h) => h.trim() === 'RANKING');
if (nameIdx < 0 || rankIdx < 0) throw new Error('NAME or RANKING column not found');

const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
const players = ids.players || {};

const top100 = [];
for (let i = 1; i < lines.length && top100.length < 100; i++) {
  const row = parseCSVLine(lines[i]);
  const rank = parseInt(row[rankIdx], 10);
  const name = (row[nameIdx] || '').trim();
  if (!name || isNaN(rank)) continue;
  if (rank >= 1 && rank <= 100) top100.push({ rank, name });
}
top100.sort((a, b) => a.rank - b.rank);

const missing = [];
for (const { rank, name } of top100) {
  const norm = normalizeNameForLookup(name);
  const has = players[name] || players[norm];
  if (!has) missing.push({ rank, name });
}

console.log('Top 100 rankings: players WITHOUT headshot (' + missing.length + '):\n');
missing.forEach(({ rank, name }) => console.log('  ' + rank + '. ' + name));
if (missing.length === 0) console.log('  (All top 100 have headshots)');
