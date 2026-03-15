/**
 * Puzzle builder for recap — replicates golf game puzzle logic for Node.
 * Uses same algorithms as golf/game.js so the same seed produces identical puzzles.
 */

const fs = require('fs');
const path = require('path');

const GOLFERS_PER_GAME = 4;
const CARDS_PER_GOLFER = 3;
const MIN_YEAR = 2001;
const MAX_YEAR = 2026;
const MIN_DISTINCT_YEARS = 4;
const RECENT_YEAR_START = 2022;
const RECENT_CARD_YEAR = 2015;
const RANK_WEIGHT_TOP_10 = 7;
const RANK_WEIGHT_TOP_50 = 6;
const RANK_WEIGHT_TOP_100 = 5;
const RANK_WEIGHT_DEFAULT = 1;
const ALLTIME_WEIGHT_FLOOR = 3;
const TOP_15_RANK = 15;
const GOLF_HEADSHOT_URL = 'https://a.espncdn.com/i/headshots/golf/players/full';

const EXCLUDED_POSITIONS = new Set(['cut', 'wd', 'dq', 'mdf']);
const MAJOR_EVENT_NAMES = new Set([
  'The Masters', 'Masters Tournament', 'PGA Championship', 'U.S. Open',
  'U.S. Open Championship', 'U.S. Open Golf Championship', 'The Open',
  'British Open Championship', 'The Players Championship', 'Memorial Tournament',
  'Arnold Palmer Invitational', 'Bay Hill Invitational',
]);
const MASTERS_EVENT_NAMES = new Set(['The Masters', 'Masters Tournament']);

function hashSeedToNumber(seedStr) {
  if (typeof seedStr !== 'string') return 1;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  if (h === 0) h = 1;
  return h;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeForMatch(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    const row = {};
    headers.forEach((h, j) => (row[h] = vals[j] ?? ''));
    rows.push(row);
  }
  return rows;
}

function parseCSVLineQuoted(line) {
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
  parts.push(cur.trim().replace(/^"|"$/g, ''));
  return parts;
}

function loadData(golfMode) {
  const root = path.resolve(__dirname, '..');
  const csvPath = path.join(root, 'golf', 'data', 'golf_results.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  let out = rows
    .filter((r) => r.score_to_par !== '' && r.score_to_par !== undefined)
    .filter((r) => !EXCLUDED_POSITIONS.has((r.position || '').trim().toLowerCase()))
    .map((r) => ({
      player_name: (r.player_name || '').trim(),
      event_name: (r.event_name || '').trim(),
      year: parseInt(r.year, 10) || 0,
      score_to_par: parseInt(r.score_to_par, 10),
    }))
    .filter((r) => r.player_name && !isNaN(r.score_to_par))
    .filter((r) => r.year >= MIN_YEAR && r.year <= MAX_YEAR);
  if (golfMode === 'majors') out = out.filter((r) => MAJOR_EVENT_NAMES.has(r.event_name));
  else if (golfMode === 'masters') out = out.filter((r) => MASTERS_EVENT_NAMES.has(r.event_name));
  return out;
}

function loadGolfPlayerIds() {
  const root = path.resolve(__dirname, '..');
  const p = path.join(root, 'golf', 'data', 'golf-player-ids.json');
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return json.players || {};
  } catch (e) {
    return {};
  }
}

function loadRankings() {
  const root = path.resolve(__dirname, '..');
  const p = path.join(root, 'golf', 'data', 'downloaded_rankings.csv');
  try {
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return new Map();
    const headerRow = parseCSVLineQuoted(lines[0]);
    const nameIdx = headerRow.findIndex((h) => h.trim().toUpperCase() === 'NAME');
    const rankIdx = headerRow.findIndex((h) => h.trim().toUpperCase() === 'RANKING');
    if (nameIdx < 0 || rankIdx < 0) return new Map();
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLineQuoted(lines[i]);
      const name = (parts[nameIdx] || '').trim();
      const rank = parseInt(parts[rankIdx], 10) || i;
      if (!name) continue;
      map.set(normalizeForMatch(name), rank);
      const comma = name.indexOf(', ');
      if (comma > 0) map.set(normalizeForMatch(name.slice(comma + 2) + ' ' + name.slice(0, comma)), rank);
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

function loadTopPlayersAlltime() {
  const root = path.resolve(__dirname, '..');
  const p = path.join(root, 'golf', 'data', 'top_players_alltime.csv');
  try {
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return new Set();
    const header = lines[0].split(',').map((h) => h.trim());
    const nameCol = header.findIndex((h) => /golfer\s*name/i.test(h));
    const col = nameCol >= 0 ? nameCol : 0;
    const set = new Set();
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      const name = (parts[col] || '').trim();
      if (!name) continue;
      set.add(normalizeForMatch(name));
      const comma = name.indexOf(', ');
      if (comma > 0) set.add(normalizeForMatch(name.slice(comma + 2) + ' ' + name.slice(0, comma)));
    }
    return set;
  } catch (e) {
    return new Set();
  }
}

function hasGolfHeadshot(playerName, playerIds) {
  if (!playerIds || typeof playerIds !== 'object') return false;
  const raw = (playerName || '').trim();
  if (!raw) return false;
  const norm = raw.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return !!(playerIds[raw] || playerIds[norm]);
}

function getGolfHeadshotUrl(playerName, playerIds) {
  if (!playerIds || typeof playerIds !== 'object') return null;
  const raw = (playerName || '').trim();
  if (!raw) return null;
  const norm = raw.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const id = playerIds[raw] || playerIds[norm];
  if (!id) return null;
  return `${GOLF_HEADSHOT_URL}/${id}.png`;
}

function buildPuzzle(rows, seed, rankMap, alltimeSet, playerIds) {
  const rng = mulberry32(hashSeedToNumber(seed));
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_name)) byPlayer.set(r.player_name, []);
    byPlayer.get(r.player_name).push(r);
  }
  const playersWithEnough = [...byPlayer.entries()].filter(([, events]) => {
    if (events.length < CARDS_PER_GOLFER) return false;
    const distinctYears = new Set(events.map((e) => e.year)).size;
    const hasRecentEvent = events.some((e) => e.year >= RECENT_YEAR_START && e.year <= MAX_YEAR);
    return distinctYears >= MIN_DISTINCT_YEARS || hasRecentEvent;
  });
  const playersWithHeadshot = playersWithEnough.filter(([pn]) => hasGolfHeadshot(pn, playerIds));
  if (playersWithHeadshot.length < GOLFERS_PER_GAME) {
    throw new Error(`Need at least ${GOLFERS_PER_GAME} golfers with headshots. Found ${playersWithHeadshot.length}.`);
  }
  const getWeight = (playerName) => {
    let w = RANK_WEIGHT_DEFAULT;
    if (rankMap && rankMap.size) {
      const rank = rankMap.get(normalizeForMatch(playerName));
      if (rank != null) {
        if (rank <= 10) w = RANK_WEIGHT_TOP_10;
        else if (rank <= 50) w = RANK_WEIGHT_TOP_50;
        else if (rank <= 100) w = RANK_WEIGHT_TOP_100;
      }
    }
    if (alltimeSet && alltimeSet.size && alltimeSet.has(normalizeForMatch(playerName))) {
      w = Math.max(w, ALLTIME_WEIGHT_FLOOR);
    }
    return w;
  };
  const selected = [];
  let pool = playersWithHeadshot.map((entry) => ({ entry, weight: getWeight(entry[0]) }));
  const top15Pool = rankMap && rankMap.size
    ? pool.filter((p) => {
        const rank = rankMap.get(normalizeForMatch(p.entry[0]));
        return rank != null && rank <= TOP_15_RANK;
      })
    : [];
  if (top15Pool.length > 0) {
    const totalWeight = top15Pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * totalWeight;
    for (let i = 0; i < top15Pool.length; i++) {
      r -= top15Pool[i].weight;
      if (r <= 0) {
        selected.push(top15Pool[i].entry);
        pool = pool.filter((p) => p.entry[0] !== top15Pool[i].entry[0]);
        break;
      }
    }
  }
  for (let k = selected.length; k < GOLFERS_PER_GAME && pool.length > 0; k++) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        selected.push(pool[i].entry);
        pool = pool.slice(0, i).concat(pool.slice(i + 1));
        break;
      }
    }
  }
  const pickedKey = (e) => `${e.event_name}|${e.year}`;
  return selected.map(([player, events]) => {
    let picked;
    const recentEvents = events.filter((e) => e.year >= RECENT_CARD_YEAR);
    if (recentEvents.length >= 1) {
      const oneRecent = shuffleWithRng([...recentEvents], rng)[0];
      const rest = events.filter((e) => pickedKey(e) !== pickedKey(oneRecent));
      const twoOthers = shuffleWithRng([...rest], rng).slice(0, CARDS_PER_GOLFER - 1);
      picked = shuffleWithRng([oneRecent, ...twoOthers], rng);
    } else {
      picked = shuffleWithRng([...events], rng).slice(0, CARDS_PER_GOLFER);
    }
    const allGreen = picked.every((e) => e.score_to_par < 0);
    const yellowOrRed = events.filter((e) => e.score_to_par >= 0);
    const pickedSet = new Set(picked.map(pickedKey));
    const available = yellowOrRed.filter((e) => !pickedSet.has(pickedKey(e)));
    if (allGreen && available.length > 0 && rng() < 0.25) {
      const swapIn = available[Math.floor(rng() * available.length)];
      const swapIdx = Math.floor(rng() * picked.length);
      picked = [...picked];
      picked[swapIdx] = swapIn;
    }
    return {
      player_name: player,
      cards: picked.map((e) => ({
        event_name: e.event_name,
        year: e.year,
        score_to_par: e.score_to_par,
      })),
    };
  });
}

/**
 * Build puzzle for a seed. Seed format: YYYY-MM-DD_majors | YYYY-MM-DD_masters | YYYY-MM-DD_all
 * Returns array of { player_name, cards: [{ event_name, year, score_to_par }] }
 * Each player also gets headshotUrl via getGolfHeadshotUrl.
 */
function buildPuzzleForSeed(seed) {
  const suffix = seed.endsWith('_masters') ? 'masters' : seed.endsWith('_all') ? 'normal' : 'majors';
  const rows = loadData(suffix);
  const playerIds = loadGolfPlayerIds();
  const rankMap = loadRankings();
  const alltimeSet = loadTopPlayersAlltime();
  const puzzle = buildPuzzle(rows, seed, rankMap, alltimeSet, playerIds);
  return puzzle.map((p) => ({
    ...p,
    headshotUrl: getGolfHeadshotUrl(p.player_name, playerIds),
  }));
}

module.exports = { buildPuzzleForSeed };
