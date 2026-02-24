/**
 * Better Season - Stat comparison game (NFL, NBA, MLB)
 * Modes: Unlimited, Daily, Blitz
 */

const SPORTS = {
  NFL: 'nfl',
  NBA: 'nba',
  MLB: 'mlb',
};

const AVAILABLE_SPORTS = ['nfl', 'nba', 'mlb'];

const SPORT_LABELS = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB' };

const SPORT_CONFIG = {
  nfl: {
    positions: ['QB', 'RB', 'WR', 'TE'],
    ratioColumn: 'Yds',
    ratioThreshold: (pos) => pos === 'QB' ? 0.70 : 0.65,
    blitzPositions: ['QB', 'RB', 'WR', 'TE'],
    round3Positions: ['WR', 'TE'],
  },
  nba: {
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    ratioColumn: 'PTS /G',
    ratioThreshold: () => 0.80,
    blitzPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
    round3Positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    noMatchPairs: [['PG', 'C']],
  },
  mlb: {
    positions: ['BATTERS', 'PITCHERS'],
    ratioColumn: (pos) => pos === 'BATTERS' ? 'R' : null,
    ratioThreshold: (pos) => pos === 'BATTERS' ? 0.70 : 0,
    blitzPositions: ['BATTERS', 'PITCHERS'],
  },
};

const MODES = {
  UNLIMITED: 'unlimited',
  DAILY: 'daily',
  BLITZ: 'blitz',
  ROOKIE_QB: 'rookie_qb',
  MLB_BATTERS: 'mlb_batters',
  MLB_PITCHERS: 'mlb_pitchers',
  BLIND_RESUME: 'blind_resume',
};

const MODE_LABELS = {
  unlimited: 'Unlimited',
  daily: 'Daily',
  blitz: 'Blitz',
  rookie_qb: 'Rookie QBs',
  mlb_batters: 'MLB Batters',
  mlb_pitchers: 'MLB Pitchers',
  blind_resume: 'Blind Resume',
};

const MODE_DESCRIPTIONS = {
  unlimited: 'Daily game with new players each time.',
  daily: 'The classic. Resets at midnight.',
  blitz: '60 seconds. As many rounds as you can.',
  rookie_qb: 'Rookies from 2016-2025.',
  mlb_batters: '2025 batting stats.',
  mlb_pitchers: '2025 pitching stats.',
  blind_resume: 'Guess the player as stats are revealed.',
};

const NFL_ONLY_MODES = ['rookie_qb', 'blind_resume'];
const MLB_ONLY_MODES = ['mlb_batters', 'mlb_pitchers'];

function getTodaySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getGameNumber() {
  // In daily mode, derive puzzle number from epoch days
  const epoch = new Date(2024, 8, 4); // NFL season start reference
  const today = new Date();
  const msPerDay = 86400000;
  const days = Math.floor((today - epoch) / msPerDay);
  return Math.max(1, days);
}

// Seeded random number generator (mulberry32)
function createSeededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ h >>> 15, h | 0);
    h = Math.imul(h ^ h >>> 13, h | 0);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  };
}

// Stat display names
const STAT_NAMES = {
  'Cmp%': 'Completion %',
  'Yds': null, // contextual
  'TD': null,
  'Int': 'Interceptions',
  'Rate': 'Passer Rating',
  'Y/A': 'Yards Per Carry',
  'Rec': 'Receptions',
  'Rush Yds': 'Rush Yards',
  'Team Wins': 'Team Wins',
};

function formatStatValue(val, stat, sport, mode) {
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (sport === 'mlb') {
    if (stat === 'BA' || stat === 'OPS') return n.toFixed(3);
    if (stat === 'ERA' || stat === 'SO9') return n.toFixed(2);
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toFixed(1);
  }
  if (sport === 'nba') {
    if (stat === 'FT%') return (n * 100).toFixed(1) + '%';
    if (['PTS /G', '3P /G', 'REB /G', 'AST /G'].includes(stat)) return n.toFixed(1);
    return n.toFixed(1);
  }
  if (stat === 'Cmp%' || stat === 'Rate' || stat === 'Y/A') return n.toFixed(1);
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

const NAME_SUFFIXES = new Set(['II', 'III', 'IV', 'Jr', 'Jr.', 'Sr', 'Sr.']);

function getLastName(player) {
  const parts = (player.Player || '').trim().split(/\s+/);
  if (parts.length <= 1) return player.Player || '?';
  const last = parts[parts.length - 1];
  if (NAME_SUFFIXES.has(last)) {
    return parts.length > 2 ? parts[parts.length - 2] : parts[0];
  }
  return last;
}

const NBA_STAT_NAMES = {
  'PTS /G': 'Points Per Game',
  '3P /G': '3-Pointers Per Game',
  'FT%': 'Free Throw %',
  'REB /G': 'Rebounds Per Game',
  'AST /G': 'Assists Per Game',
};

const NBA_HEADSHOT_URL = 'https://cdn.nba.com/headshots/nba/latest/1040x760';
const NBA_HEADSHOT_FALLBACK_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" fill="%234a5568"><ellipse cx="50" cy="38" rx="22" ry="26"/><path d="M15 120c0-22 15-40 35-40s35 18 35 40z"/></svg>'
);

function normalizeNameForLookup(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function getNbaHeadshotUrl(playerName) {
  const playerIds = state.allData?.nba?.playerIds;
  if (!playerIds || typeof playerIds !== 'object') return null;
  const raw = (playerName || '').trim();
  if (!raw) return null;
  const id = playerIds[raw] || playerIds[normalizeNameForLookup(raw)];
  if (!id) return null;
  return `${NBA_HEADSHOT_URL}/${id}.png`;
}

const MLB_HEADSHOT_URL = 'https://img.mlbstatic.com/mlb-images/image/upload/v1/people';

function getMlbHeadshotUrl(playerName) {
  const playerIds = state.allData?.mlb?.playerIds;
  if (!playerIds || typeof playerIds !== 'object') return null;
  const raw = (playerName || '').trim();
  if (!raw) return null;
  const id = playerIds[raw] || playerIds[normalizeNameForLookup(raw)];
  if (!id) return null;
  return `${MLB_HEADSHOT_URL}/${id}/headshot/silo/current`;
}

const NFL_HEADSHOT_URL = 'https://a.espncdn.com/i/headshots/nfl/players/full';

function getNflHeadshotUrl(playerName) {
  const playerIds = state.allData?.nfl?.playerIds;
  if (!playerIds || typeof playerIds !== 'object') return null;
  const raw = (playerName || '').trim();
  if (!raw) return null;
  const id = playerIds[raw] || playerIds[normalizeNameForLookup(raw)];
  if (!id) return null;
  return `${NFL_HEADSHOT_URL}/${id}.png`;
}

const MLB_STAT_NAMES = {
  R: 'Runs',
  HR: 'Home Runs',
  RBI: 'Runs Batted In',
  SB: 'Stolen Bases',
  BA: 'Batting Average',
  OPS: 'OPS',
  W: 'Wins',
  ERA: 'ERA (select lower)',
  BB: 'Walks (select less)',
  SO9: 'K/9',
};

function getStatDisplayName(col, position, sport, mode) {
  if (sport === 'mlb') return MLB_STAT_NAMES[col] || col;
  if (sport === 'nba') return NBA_STAT_NAMES[col] || col;
  if (col === 'Rush Yds') return 'Rush Yards';
  if (col === 'Team Wins') return 'Team Wins';
  if (col === 'Yds') {
    if (position === 'QB') return 'Passing Yards';
    if (position === 'RB') return 'Rushing Yards';
    return 'Receiving Yards';
  }
  if (col === 'TD') {
    if (position === 'QB') return 'Passing Touchdowns';
    if (position === 'RB') return 'Rushing Touchdowns';
    return 'Receiving Touchdowns';
  }
  if (col === 'Int') return 'Interceptions (select less)';
  return STAT_NAMES[col] || col;
}

// Lower is better (Int, ERA, BB)
const LOWER_BETTER = new Set(['Int', 'ERA', 'BB']);

function isBetter(valA, valB, statCol, sport, mode) {
  const a = parseFloat(valA);
  const b = parseFloat(valB);
  if (LOWER_BETTER.has(statCol)) return a < b;
  return a > b;
}

const NFL_FILES = [
  'qb_2023', 'qb_2024', 'qb_2025',
  'rb_2023', 'rb_2024', 'rb_2025',
  'wr_2023', 'wr_2024', 'wr_2025',
  'te_2023', 'te_2024', 'te_2025',
];

const NBA_FILES = ['basketball_2026'];

const MLB_BATTERS_FILE = 'baseball_batters_2025.csv';
const MLB_PITCHERS_FILE = 'baseball_pitchers_2025.csv';

const ROOKIE_QB_FILE = 'rookie qbs 2016-2025.csv';
const BLIND_QB_FILE = 'blind_qb_2025.csv';
const ROOKIE_QB_STAT_POOL = ['TD', 'Int', 'Rush Yds', 'Team Wins'];

function pickRookieQBStats(rng) {
  const others = [...ROOKIE_QB_STAT_POOL];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return ['Yds', others[0], others[1], others[2]];
}

async function loadData() {
  const all = { nfl: {}, nba: {}, mlb: {} };

  for (const f of NFL_FILES) {
    try {
      const [pos, year] = f.split('_');
      const res = await fetch(`data/${f}.csv`);
      if (!res.ok) throw new Error(`${f}.csv: ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, j) => row[h] = vals[j] || '');
        row.season = parseInt(year, 10);
        rows.push(row);
      }
      const key = pos.toUpperCase();
      if (!all.nfl[key]) all.nfl[key] = [];
      all.nfl[key].push(...rows);
    } catch (err) {
      console.error(`Failed to load ${f}.csv:`, err);
      throw new Error(`Could not load ${f}.csv: ${err.message}`);
    }
  }

  for (const f of NBA_FILES) {
    try {
      const [sport, year] = f.split('_');
      const res = await fetch(`data/${f}.csv`);
      if (!res.ok) throw new Error(`${f}.csv: ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, j) => row[h] = vals[j] || '');
        row.season = parseInt(year, 10);
        rows.push(row);
      }
      const byPos = {};
      rows.forEach(r => {
        const pos = (r.Pos || '').trim().toUpperCase() || '?';
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(r);
      });
      ['PG', 'SG', 'SF', 'PF', 'C'].forEach(p => {
        all.nba[p] = byPos[p] || [];
      });
    } catch (err) {
      console.error(`Failed to load ${f}.csv:`, err);
      throw new Error(`Could not load ${f}.csv: ${err.message}`);
    }
  }

  try {
    const rosterRes = await fetch('data/nba-player-ids.json');
    if (rosterRes.ok) {
      const rosterJson = await rosterRes.json();
      all.nba.playerIds = rosterJson.players || {};
    } else {
      all.nba.playerIds = {};
    }
  } catch {
    all.nba.playerIds = {};
  }

  try {
    const res = await fetch(`data/${encodeURIComponent(BLIND_QB_FILE)}`);
    if (!res.ok) throw new Error(`${BLIND_QB_FILE}: ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim()).filter(Boolean);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const vals = parseCSVLine(line);
      const row = {};
      headers.forEach((h, j) => row[h] = (vals[j] || '').trim());
      rows.push(row);
    }
    all.nfl.BLIND_QB = rows;
  } catch (err) {
    console.error(`Failed to load ${BLIND_QB_FILE}:`, err);
    throw new Error(`Could not load ${BLIND_QB_FILE}: ${err.message}`);
  }

  try {
    const res = await fetch(`data/${encodeURIComponent(ROOKIE_QB_FILE)}`);
    if (!res.ok) throw new Error(`${ROOKIE_QB_FILE}: ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, j) => row[h] = vals[j] || '');
      row.season = parseInt(row.Season || row.season || '0', 10);
      rows.push(row);
    }
    all.nfl.ROOKIE_QB = rows;
  } catch (err) {
    console.error(`Failed to load ${ROOKIE_QB_FILE}:`, err);
    throw new Error(`Could not load ${ROOKIE_QB_FILE}: ${err.message}`);
  }

  try {
    const nflRosterRes = await fetch('data/nfl-player-ids.json');
    if (nflRosterRes.ok) {
      const nflRosterJson = await nflRosterRes.json();
      all.nfl.playerIds = nflRosterJson.players || {};
    } else {
      all.nfl.playerIds = {};
    }
  } catch {
    all.nfl.playerIds = {};
  }

  for (const f of [MLB_BATTERS_FILE, MLB_PITCHERS_FILE]) {
    try {
      const res = await fetch(`data/${encodeURIComponent(f)}`);
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, j) => row[h] = vals[j] || '');
        row.season = 2025;
        rows.push(row);
      }
      const key = f.includes('batters') ? 'BATTERS' : 'PITCHERS';
      all.mlb[key] = rows;
    } catch (err) {
      console.error(`Failed to load ${f}:`, err);
      throw new Error(`Could not load ${f}: ${err.message}`);
    }
  }

  try {
    const mlbRosterRes = await fetch('data/mlb-player-ids.json');
    if (mlbRosterRes.ok) {
      const mlbRosterJson = await mlbRosterRes.json();
      all.mlb.playerIds = mlbRosterJson.players || {};
    } else {
      all.mlb.playerIds = {};
    }
  } catch {
    all.mlb.playerIds = {};
  }

  return all;
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if ((c === ',' && !inQuotes) || c === '\r') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

// QB: Yds + 2 from [Cmp%, TD, Int, Rate]
const QB_STAT_POOL = ['Cmp%', 'TD', 'Int', 'Rate'];

function pickQBStats(rng) {
  const others = [...QB_STAT_POOL];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return ['Yds', others[0], others[1]];
}

// RB: Yds, TD, Y/A
const RB_STATS = ['Yds', 'TD', 'Y/A'];

// WR/TE: Rec, Yds, TD
const WR_TE_STATS = ['Rec', 'Yds', 'TD'];

// NBA: PPG always + 2 from [3P/G, FT%, REB%, AST/G]
const NBA_STAT_POOL = ['3P /G', 'FT%', 'REB /G', 'AST /G'];

function pickNBAStats(rng) {
  const others = [...NBA_STAT_POOL];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return ['PTS /G', others[0], others[1]];
}

// MLB Batters: one of BA or OPS (never both) + 2 from [R, HR, RBI, SB]
const MLB_BATTER_PRIMARY = ['BA', 'OPS'];
const MLB_BATTER_OTHERS = ['R', 'HR', 'RBI', 'SB'];

function pickMLBBatterStats(rng) {
  const primary = MLB_BATTER_PRIMARY[Math.floor(rng() * 2)];
  const others = [...MLB_BATTER_OTHERS];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return [primary, others[0], others[1]];
}

// MLB Pitchers: ERA always + 2 from [W, BB, SO9]
const MLB_PITCHER_OTHERS = ['W', 'BB', 'SO9'];

function pickMLBPitcherStats(rng) {
  const others = [...MLB_PITCHER_OTHERS];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return ['ERA', others[0], others[1]];
}

// Blind Resume: stat columns (Pos never shown)
const BLIND_RESUME_STAT_COLS = ['Pass Yds', 'Pass TD', 'Int', 'Rush Yds', 'Game Winning Drives'];
const BLIND_RESUME_EXTRA_COLS = ['Conference', 'Age'];
const BLIND_RESUME_TEAM_COL = 'Team';

const BLIND_RESUME_STAT_LABELS = {
  'Pass Yds': 'Pass Yds',
  'Pass TD': 'Pass TD',
  'Int': 'Int',
  'Rush Yds': 'Rush Yds',
  'Game Winning Drives': 'Game Winning Drives',
  'Conference': 'Conference',
  'Age': 'Age',
  'Team': 'Team',
};

function buildBlindResumeRevealOrder(rng) {
  const initialPool = [...BLIND_RESUME_STAT_COLS];
  for (let i = initialPool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [initialPool[i], initialPool[j]] = [initialPool[j], initialPool[i]];
  }
  const initial = initialPool.slice(0, 3);
  const remaining = initialPool.slice(3);
  const extras = [...BLIND_RESUME_EXTRA_COLS];
  for (let i = extras.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [extras[i], extras[j]] = [extras[j], extras[i]];
  }
  const toShuffle = [...remaining, ...extras];
  for (let i = toShuffle.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [toShuffle[i], toShuffle[j]] = [toShuffle[j], toShuffle[i]];
  }
  return [...initial, ...toShuffle, BLIND_RESUME_TEAM_COL];
}

function formatBlindStatValue(val, col) {
  const n = parseFloat(val);
  if (!isNaN(n) && Number.isInteger(n)) return n.toLocaleString();
  if (!isNaN(n)) return String(n);
  return String(val || '');
}

function normalizePlayerName(name) {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function isPlayerMatch(guess, actual) {
  const g = normalizePlayerName(guess);
  const a = normalizePlayerName(actual);
  if (g === a) return true;
  const aParts = a.split(' ');
  const gParts = g.split(' ');
  if (aParts.length >= 2 && gParts.length >= 2) {
    if (aParts[aParts.length - 1] === gParts[gParts.length - 1] && aParts[0] === gParts[0]) return true;
  }
  return false;
}

function pickStatsForRound(position, rng, sport, mode) {
  if (mode === MODES.MLB_BATTERS) return pickMLBBatterStats(rng);
  if (mode === MODES.MLB_PITCHERS) return pickMLBPitcherStats(rng);
  if (sport === 'nba') return pickNBAStats(rng);
  if (position === 'QB') return pickQBStats(rng);
  if (position === 'RB') return RB_STATS;
  return WR_TE_STATS;
}

function getRatioColumn(sport, position) {
  const cfg = SPORT_CONFIG[sport];
  if (cfg?.ratioColumn && typeof cfg.ratioColumn === 'function') {
    const val = cfg.ratioColumn(position);
    if (val != null) return val;
  }
  return sport === 'nba' ? 'PTS /G' : 'Yds';
}

function getRatio(playerA, playerB, sport, position) {
  const col = getRatioColumn(sport, position);
  if (!col) return 1;
  const a = parseFloat(playerA[col]) || 0;
  const b = parseFloat(playerB[col]) || 0;
  if (a === 0 && b === 0) return 1;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (max === 0) return 1;
  return min / max;
}

function sameTeamSeason(a, b) {
  return a.Team === b.Team && a.season === b.season;
}

function hasStatTie(a, b, stats) {
  for (const s of stats) {
    const va = parseFloat(a[s]);
    const vb = parseFloat(b[s]);
    if (va === vb && !isNaN(va)) return true;
  }
  return false;
}

function playerKey(p) {
  return `${p.Player}|${p.Team}|${p.season}`;
}

function getRatioThreshold(position, sport) {
  const cfg = SPORT_CONFIG[sport];
  const val = typeof cfg?.ratioThreshold === 'function' ? cfg.ratioThreshold(position) : cfg?.ratioThreshold;
  return val ?? 0.65;
}

function isNoMatchPair(posA, posB, sport) {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg?.noMatchPairs) return false;
  const a = (posA || '').toUpperCase();
  const b = (posB || '').toUpperCase();
  return cfg.noMatchPairs.some(([p1, p2]) =>
    (a === p1 && b === p2) || (a === p2 && b === p1)
  );
}

function generateMatchup(pool, stats, usedKeys, rng, position, allowReuseWhenEmpty = false, sport = 'nfl') {
  const list = Array.isArray(pool) ? pool : (pool || []);
  const minRatio = getRatioThreshold(position, sport);
  let validPairs = [];

  function collectPairs(keys) {
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (sameTeamSeason(a, b)) continue;
        if (keys.has(playerKey(a)) || keys.has(playerKey(b))) continue;
        if (isNoMatchPair(a.Pos, b.Pos, sport)) continue;
        if (getRatio(a, b, sport, position) < minRatio) continue;
        if (hasStatTie(a, b, stats)) continue;
        pairs.push([a, b]);
      }
    }
    return pairs;
  }

  validPairs = collectPairs(usedKeys);
  if (validPairs.length === 0 && allowReuseWhenEmpty) {
    validPairs = collectPairs(new Set());
  }
  if (validPairs.length === 0) return null;

  const idx = Math.floor(rng() * validPairs.length);
  const [a, b] = validPairs[idx];
  return rng() < 0.5 ? [a, b] : [b, a];
}

function getRound3Position(seed, rng, mode, sport) {
  if (sport === 'nfl') {
    if (mode === MODES.DAILY) return (new Date().getDate()) % 2 === 0 ? 'WR' : 'TE';
    const h = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return h % 2 === 0 ? 'WR' : 'TE';
  }
  if (sport === 'nba') {
    const positions = SPORT_CONFIG.nba.positions;
    return positions[rng() * positions.length | 0];
  }
  return 'WR';
}

function getPositionOrder(sport, seed, rng, mode) {
  const cfg = SPORT_CONFIG[sport];
  if (mode === MODES.MLB_BATTERS) return ['BATTERS', 'BATTERS', 'BATTERS'];
  if (mode === MODES.MLB_PITCHERS) return ['PITCHERS', 'PITCHERS', 'PITCHERS'];
  if (!cfg) return ['QB', 'RB', 'WR'];
  if (sport === 'nfl') {
    return ['QB', 'RB', getRound3Position(seed, rng, mode, sport)];
  }
  if (sport === 'nba') {
    const positions = [...cfg.positions];
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    return positions.slice(0, 3);
  }
  return ['QB', 'RB', 'WR'];
}

// --- DOM ---
const startScreen = document.getElementById('start-screen');
const roundScreen = document.getElementById('round-screen');
const resultsScreen = document.getElementById('results-screen');
const startBtn = document.getElementById('start-btn');
const positionLabel = document.getElementById('position-label');
const playerAName = document.getElementById('player-a-name');
const playerAMeta = document.getElementById('player-a-meta');
const playerBName = document.getElementById('player-b-name');
const playerBMeta = document.getElementById('player-b-meta');
const statPicks = document.getElementById('stat-picks');
const roundIndicator = document.getElementById('round-indicator');
const blitzTimerEl = document.getElementById('blitz-timer');
const confirmBtn = document.getElementById('confirm-btn');
const comeBackTomorrow = document.getElementById('come-back-tomorrow');
const resultsScore = document.getElementById('results-score');
const resultsStreak = document.getElementById('results-streak');
const todayStatsEl = document.getElementById('today-stats');
const shareGrid = document.getElementById('share-grid');
const shareSmsBtn = document.getElementById('share-sms-btn');
const shareXBtn = document.getElementById('share-x-btn');
const newGameBtn = document.getElementById('new-game-btn');
const resultsModeButtons = document.getElementById('results-mode-buttons');
const resultsSportToolbar = document.getElementById('results-sport-toolbar');
const howToBtn = document.getElementById('how-to-btn');
const howToModal = document.getElementById('how-to-modal');
const modalClose = document.getElementById('modal-close');
const homeBtn = document.getElementById('home-btn');
const blindResumeWrap = document.getElementById('blind-resume-wrap');
const blindResumeScoreEl = document.getElementById('blind-resume-score');
const blindResumeStats = document.getElementById('blind-resume-stats');
const blindResumeInput = document.getElementById('blind-resume-input');
const blindResumeDropdown = document.getElementById('blind-resume-dropdown');
const blindResumeSubmit = document.getElementById('blind-resume-submit');
const blindResumeFeedback = document.getElementById('blind-resume-feedback');
const matchupWrap = document.getElementById('matchup-wrap');
const roundInstruction = document.getElementById('round-instruction');
const playerAHeadshot = document.getElementById('player-a-headshot');
const playerBHeadshot = document.getElementById('player-b-headshot');

let state = {
  sport: 'nfl',
  allData: null,
  data: null,
  mode: null,
  seed: null,
  rng: null,
  rounds: [],
  currentRound: 0,
  picks: [],
  score: 0,
  roundScores: [],
  blitzTimeLeft: 60,
  blitzTimerId: null,
  blitzUsedKeys: null,
};

function getGameSeed(mode) {
  const dailyModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.MLB_BATTERS, MODES.MLB_PITCHERS, MODES.BLIND_RESUME];
  if (dailyModes.includes(mode)) return getTodaySeed();
  return Math.random().toString(36).slice(2, 12);
}

function getDailyKey(sport, mode) {
  if (mode === MODES.ROOKIE_QB) return 'betterseason_rookieqb';
  if (mode === MODES.MLB_BATTERS) return 'betterseason_mlb_batters';
  if (mode === MODES.MLB_PITCHERS) return 'betterseason_mlb_pitchers';
  if (mode === MODES.BLIND_RESUME) return 'betterseason_blindresume';
  const suffix = sport === 'nfl' ? '' : `_${sport}`;
  return `betterseason${suffix}`;
}

function hasPlayedDailyToday(sport, mode) {
  const key = getDailyKey(sport, mode);
  const today = new Date().toDateString();
  return localStorage.getItem(`${key}_lastDate`) === today &&
    localStorage.getItem(`${key}_dailyScore`) != null;
}

function getStoredDailyScore(sport, mode) {
  const key = getDailyKey(sport, mode);
  return localStorage.getItem(`${key}_dailyScore`) || '0';
}

function storeDailyScore(score, sport, mode, roundScores = null) {
  const key = getDailyKey(sport, mode);
  localStorage.setItem(`${key}_dailyScore`, String(score));
  if (roundScores && roundScores.length > 0) {
    localStorage.setItem(`${key}_roundScores`, JSON.stringify(roundScores));
  }
}

function getStoredRoundScores(sport, mode) {
  const key = getDailyKey(sport, mode);
  try {
    const raw = localStorage.getItem(`${key}_roundScores`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initGame(mode) {
  state.mode = mode;
  state.seed = getGameSeed(mode);
  state.rng = createSeededRandom(state.seed);
  state.rounds = [];
  state.currentRound = 0;
  state.picks = [];
  state.score = 0;
  state.roundScores = [];
  state.blitzUsedKeys = mode === MODES.BLITZ ? new Map() : null;
  state.totalPoints = mode === MODES.ROOKIE_QB ? 12 : 9;

  startScreen.classList.remove('active');
  roundScreen.classList.add('active');
  resultsScreen.classList.remove('active');
  blitzTimerEl.classList.remove('visible');
  homeBtn.style.display = 'flex';

  if (mode === MODES.BLITZ) {
    state.data = state.allData[state.sport];
    state.blitzTimeLeft = 60;
    blitzTimerEl.classList.add('visible');
    startBlitzTimer();
    addBlitzRound();
    renderRound();
    return;
  }

  const dailyModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.MLB_BATTERS, MODES.MLB_PITCHERS, MODES.BLIND_RESUME];
  if (dailyModes.includes(mode) && hasPlayedDailyToday(state.sport, mode)) {
    showDailyAlreadyPlayed();
    return;
  }

  if (mode === MODES.BLIND_RESUME) {
    initBlindResume();
    return;
  }

  const isRookieQB = mode === MODES.ROOKIE_QB;
  const isMLBBatters = mode === MODES.MLB_BATTERS;
  const isMLBPitchers = mode === MODES.MLB_PITCHERS;
  if (isRookieQB) {
    state.data = { QB: state.allData.nfl.ROOKIE_QB };
  } else if (isMLBBatters || isMLBPitchers) {
    state.sport = 'mlb';
    state.data = state.allData.mlb;
  } else {
    state.data = state.allData[state.sport];
  }

  const posOrder = isRookieQB ? ['QB', 'QB', 'QB'] : getPositionOrder(state.sport, state.seed, state.rng, mode);
  const usedKeys = new Set();
  const statsPerRound = isRookieQB ? 4 : 3;
  const totalPoints = isRookieQB ? 12 : 9;

  for (let r = 0; r < 3; r++) {
    const pos = posOrder[r];
    const stats = isRookieQB ? pickRookieQBStats(state.rng) : pickStatsForRound(pos, state.rng, state.sport, mode);
    const pool = state.data[pos];
    const matchup = generateMatchup(pool, stats, usedKeys, state.rng, pos, false, state.sport);
    if (!matchup) {
      if (!pool || pool.length < 2) continue;
      const a = pool[0], b = pool[1];
      usedKeys.add(playerKey(a));
      usedKeys.add(playerKey(b));
      const correct = stats.map(s => isBetter(a[s], b[s], s, state.sport, mode) ? 'A' : 'B');
      state.rounds.push({ position: pos, stats, playerA: a, playerB: b, correct });
    } else {
      const [a, b] = matchup;
      usedKeys.add(playerKey(a));
      usedKeys.add(playerKey(b));
      const correct = stats.map(s => isBetter(a[s], b[s], s, state.sport, mode) ? 'A' : 'B');
      state.rounds.push({ position: pos, stats, playerA: a, playerB: b, correct });
    }
  }

  renderRound();
}

function startBlitzTimer() {
  if (state.blitzTimerId) clearInterval(state.blitzTimerId);
  blitzTimerEl.textContent = state.blitzTimeLeft;
  state.blitzTimerId = setInterval(() => {
    state.blitzTimeLeft--;
    blitzTimerEl.textContent = Math.max(0, state.blitzTimeLeft);
    if (state.blitzTimeLeft <= 0) {
      clearInterval(state.blitzTimerId);
      state.blitzTimerId = null;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Time's up!";
      endBlitz();
    }
  }, 1000);
}

function addBlitzRound() {
  const cfg = SPORT_CONFIG[state.sport];
  const posOrder = cfg?.blitzPositions || ['QB', 'RB', 'WR', 'TE'];
  const roundIndex = state.rounds.length;
  const pos = posOrder[roundIndex % posOrder.length];
  const stats = pickStatsForRound(pos, state.rng, state.sport, state.mode);
  const pool = state.data[pos];
  const usedKeys = state.blitzUsedKeys.get(pos) || new Set();
  const matchup = generateMatchup(pool, stats, usedKeys, state.rng, pos, true, state.sport);
  if (!matchup) return;
  const [a, b] = matchup;
  if (!state.blitzUsedKeys.has(pos)) state.blitzUsedKeys.set(pos, new Set());
  state.blitzUsedKeys.get(pos).add(playerKey(a));
  state.blitzUsedKeys.get(pos).add(playerKey(b));
  const correct = stats.map(s => isBetter(a[s], b[s], s, state.sport, state.mode) ? 'A' : 'B');
  state.rounds.push({ position: pos, stats, playerA: a, playerB: b, correct });
}

function endBlitz() {
  showResults();
}

// --- Blind Resume ---
function initBlindResume() {
  state.data = state.allData.nfl.BLIND_QB;
  state.rounds = [];
  const pool = [...(state.data || [])];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let r = 0; r < 3; r++) {
    const player = pool[r];
    const revealOrder = buildBlindResumeRevealOrder(state.rng);
    state.rounds.push({
      player,
      revealOrder,
      revealedCount: 3,
      wrongGuessCount: 0,
    });
  }
  state.currentRound = 0;
  state.score = 0;
  state.roundScores = [];

  blindResumeWrap.style.display = 'flex';
  matchupWrap.style.display = 'none';
  statPicks.style.display = 'none';
  confirmBtn.style.display = 'none';
  positionLabel.textContent = 'QB';
  roundInstruction.textContent = 'Guess the player from their stats';
  renderBlindResumeRound();
}

function getBlindResumeDisplayScore() {
  return state.score;
}

function updateBlindResumeScoreDisplay() {
  blindResumeScoreEl.textContent = getBlindResumeDisplayScore();
}

function renderBlindResumeRound() {
  const r = state.rounds[state.currentRound];
  if (!r) return;

  roundIndicator.textContent = `Round ${state.currentRound + 1}/3`;
  updateBlindResumeScoreDisplay();
  blindResumeStats.innerHTML = '';
  for (let i = 0; i < r.revealedCount && i < r.revealOrder.length; i++) {
    const col = r.revealOrder[i];
    const val = r.player[col];
    const label = BLIND_RESUME_STAT_LABELS[col] || col;
    const displayVal = formatBlindStatValue(val, col);
    const row = document.createElement('div');
    row.className = 'blind-resume-stat-row';
    row.innerHTML = `<span class="blind-resume-stat-label">${label}</span><span class="blind-resume-stat-value">${displayVal}</span>`;
    blindResumeStats.appendChild(row);
  }

  blindResumeInput.value = '';
  blindResumeInput.disabled = false;
  blindResumeDropdown.innerHTML = '';
  blindResumeDropdown.classList.remove('visible');
  blindResumeSubmit.disabled = true;
  blindResumeFeedback.textContent = '';
  blindResumeFeedback.className = 'blind-resume-feedback';

  setupBlindResumeInput();
}

function setupBlindResumeInput() {
  const pool = state.allData.nfl.BLIND_QB;

  function filterNames(q) {
    const lower = q.toLowerCase().trim();
    if (!lower) return [];
    return pool.filter(p => {
      const name = (p.Player || '').toLowerCase();
      return name.includes(lower);
    }).map(p => p.Player).slice(0, 8);
  }

  function showDropdown(items) {
    blindResumeDropdown.innerHTML = '';
    items.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'blind-resume-dropdown-item' + (i === 0 ? ' highlighted' : '');
      el.textContent = name;
      el.onclick = () => {
        blindResumeInput.value = name;
        blindResumeDropdown.classList.remove('visible');
        blindResumeSubmit.disabled = false;
      };
      blindResumeDropdown.appendChild(el);
    });
    blindResumeDropdown.classList.toggle('visible', items.length > 0);
  }

  blindResumeInput.oninput = () => {
    const q = blindResumeInput.value.trim();
    blindResumeSubmit.disabled = !q;
    showDropdown(filterNames(q));
  };

  blindResumeInput.onfocus = () => {
    const q = blindResumeInput.value.trim();
    if (q) showDropdown(filterNames(q));
  };

  blindResumeInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (blindResumeInput.value.trim()) handleBlindResumeGuess();
    }
    if (e.key === 'Escape') {
      blindResumeDropdown.classList.remove('visible');
    }
  };

  setTimeout(() => {
    document.addEventListener('click', function closeDropdown(e) {
      if (!blindResumeInput.contains(e.target) && !blindResumeDropdown.contains(e.target)) {
        blindResumeDropdown.classList.remove('visible');
        document.removeEventListener('click', closeDropdown);
      }
    });
  }, 0);

  blindResumeSubmit.onclick = handleBlindResumeGuess;
}

function handleBlindResumeGuess() {
  const guess = blindResumeInput.value.trim();
  if (!guess) return;

  const r = state.rounds[state.currentRound];
  const correct = isPlayerMatch(guess, r.player.Player);

  if (correct) {
    state.score += 100;
    blindResumeScoreEl.textContent = state.score;
    blindResumeFeedback.textContent = `Correct! ${r.player.Player} (+100 pts)`;
    blindResumeFeedback.className = 'blind-resume-feedback correct';
    blindResumeInput.disabled = true;
    blindResumeSubmit.disabled = true;
    blindResumeDropdown.classList.remove('visible');
    setTimeout(() => goNextBlindResumeRound(), 1200);
  } else {
    r.wrongGuessCount++;
    state.score -= 10;
    updateBlindResumeScoreDisplay();
    if (r.revealedCount < r.revealOrder.length) {
      blindResumeFeedback.textContent = `Wrong (-10 pts). One more stat revealed.`;
      blindResumeFeedback.className = 'blind-resume-feedback wrong';
      r.revealedCount++;
      setTimeout(() => renderBlindResumeRound(), 800);
    } else {
      blindResumeFeedback.textContent = `It was ${r.player.Player}. (-10 pts)`;
      blindResumeFeedback.className = 'blind-resume-feedback wrong';
      blindResumeInput.disabled = true;
      blindResumeSubmit.disabled = false;
      blindResumeSubmit.textContent = 'Next round →';
      blindResumeSubmit.onclick = () => {
        blindResumeSubmit.textContent = 'Guess';
        blindResumeSubmit.onclick = handleBlindResumeGuess;
        goNextBlindResumeRound();
      };
    }
  }
}

function goNextBlindResumeRound() {
  state.currentRound++;
  if (state.currentRound < 3) {
    roundScreen.classList.remove('active');
    setTimeout(() => {
      roundScreen.classList.add('active');
      renderBlindResumeRound();
    }, 150);
  } else {
    storeDailyScore(state.score, state.sport, state.mode, []);
    updateStreak();
    blindResumeWrap.style.display = 'none';
    matchupWrap.style.display = '';
    statPicks.style.display = '';
    confirmBtn.style.display = '';
    showResults();
  }
}

function renderResultsModeButtons(justPlayedMode) {
  resultsModeButtons.innerHTML = '';
  let allModes;
  if (state.sport === 'nfl') allModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.BLIND_RESUME];
  else if (state.sport === 'mlb') allModes = [MODES.MLB_BATTERS, MODES.MLB_PITCHERS];
  else allModes = [MODES.DAILY];
  const otherModes = allModes.filter(m => m !== justPlayedMode);
  otherModes.forEach(mode => {
    const btn = document.createElement('button');
    btn.className = 'results-mode-btn';
    btn.textContent = `Play ${MODE_LABELS[mode]}`;
    btn.onclick = () => {
      state.mode = mode;
      updateStartScreen();
      initGame(mode);
    };
    resultsModeButtons.appendChild(btn);
  });
}

function renderResultsSportToolbar() {
  resultsSportToolbar.innerHTML = '';
  ['nfl', 'nba', 'mlb'].forEach(sport => {
    const pill = document.createElement('button');
    pill.className = 'results-sport-pill';
    pill.classList.add(`results-sport-pill--${sport}`);
    if (!AVAILABLE_SPORTS.includes(sport)) pill.classList.add('coming-soon');
    pill.textContent = SPORT_LABELS[sport];
    if (AVAILABLE_SPORTS.includes(sport)) {
      pill.onclick = () => {
        state.sport = sport;
        goToStartScreen();
      };
    }
    if (sport === state.sport) pill.classList.add('selected');
    resultsSportToolbar.appendChild(pill);
  });
}

function showDailyAlreadyPlayed() {
  startScreen.classList.remove('active');
  roundScreen.classList.remove('active');
  resultsScreen.classList.add('active');
  homeBtn.style.display = 'flex';
  const score = parseInt(getStoredDailyScore(state.sport, state.mode), 10);
  const roundScores = getStoredRoundScores(state.sport, state.mode);
  const total = (state.mode === MODES.ROOKIE_QB) ? 12 : (state.mode === MODES.BLIND_RESUME) ? null : 9;
  resultsScore.textContent = total != null ? `${score}/${total}` : `${score} pts`;
  resultsStreak.textContent = '';
  shareGrid.textContent = buildShareGridForMode(state.mode, score, roundScores, state.sport);
  renderResultsModeButtons(state.mode);
  renderResultsSportToolbar();
  const shareText = buildShareGridForMode(state.mode, score, roundScores, state.sport);
  shareSmsBtn.onclick = () => { window.location.href = 'sms:?body=' + encodeURIComponent(shareText); };
  shareXBtn.onclick = () => { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText)); };
  newGameBtn.style.display = 'none';
  fetchTodayStats();
}

function renderRound() {
  const r = state.rounds[state.currentRound];
  if (!r) return;

  positionLabel.textContent = r.position;
  if (state.mode === MODES.BLITZ) {
    roundIndicator.textContent = `Round ${state.currentRound + 1}`;
  } else {
    roundIndicator.textContent = `Round ${state.currentRound + 1}/3`;
  }
  playerAName.textContent = r.playerA.Player;
  playerAMeta.textContent = `${r.playerA.Team} · ${r.playerA.season}`;
  playerBName.textContent = r.playerB.Player;
  playerBMeta.textContent = `${r.playerB.Team} · ${r.playerB.season}`;

  const showHeadshots = (state.sport === 'nfl' && state.allData?.nfl?.playerIds) ||
    (state.sport === 'nba' && state.allData?.nba?.playerIds) ||
    (state.sport === 'mlb' && state.allData?.mlb?.playerIds);
  if (showHeadshots) {
    const urlA = state.sport === 'nfl' ? getNflHeadshotUrl(r.playerA.Player) : state.sport === 'nba' ? getNbaHeadshotUrl(r.playerA.Player) : getMlbHeadshotUrl(r.playerA.Player);
    const urlB = state.sport === 'nfl' ? getNflHeadshotUrl(r.playerB.Player) : state.sport === 'nba' ? getNbaHeadshotUrl(r.playerB.Player) : getMlbHeadshotUrl(r.playerB.Player);
    playerAHeadshot.style.display = '';
    playerBHeadshot.style.display = '';
    playerAHeadshot.innerHTML = '<img src="' + (urlA || NBA_HEADSHOT_FALLBACK_SVG) + '" alt="" loading="lazy">';
    playerBHeadshot.innerHTML = '<img src="' + (urlB || NBA_HEADSHOT_FALLBACK_SVG) + '" alt="" loading="lazy">';
    playerAHeadshot.querySelector('img').onerror = function () { this.src = NBA_HEADSHOT_FALLBACK_SVG; };
    playerBHeadshot.querySelector('img').onerror = function () { this.src = NBA_HEADSHOT_FALLBACK_SVG; };
  } else {
    playerAHeadshot.style.display = 'none';
    playerAHeadshot.innerHTML = '';
    playerBHeadshot.style.display = 'none';
    playerBHeadshot.innerHTML = '';
  }

  state.picks = [];
  statPicks.innerHTML = '';

  const nameA = getLastName(r.playerA);
  const nameB = getLastName(r.playerB);

  for (let i = 0; i < r.stats.length; i++) {
    const stat = r.stats[i];
    const label = getStatDisplayName(stat, r.position, state.sport, state.mode);
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.dataset.statIndex = i;
    row.innerHTML = `
      <span class="stat-label">${label}</span>
      <div class="stat-buttons">
        <button class="stat-btn" data-pick="A" data-stat-index="${i}">${nameA}</button>
        <button class="stat-btn" data-pick="B" data-stat-index="${i}">${nameB}</button>
      </div>
    `;
    statPicks.appendChild(row);

    const btnA = row.querySelector('[data-pick="A"]');
    const btnB = row.querySelector('[data-pick="B"]');

    btnA.addEventListener('click', () => pickStat(i, 'A', row));
    btnB.addEventListener('click', () => pickStat(i, 'B', row));
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Confirm';
  confirmBtn.onclick = handleConfirm;
}

function pickStat(index, pick, row) {
  state.picks[index] = pick;
  const btns = row.querySelectorAll('.stat-btn');
  btns.forEach(b => b.classList.remove('selected'));
  const chosen = row.querySelector(`[data-pick="${pick}"]`);
  chosen.classList.add('selected');
  confirmBtn.disabled = state.picks.some(p => p == null);
}

function handleConfirm() {
  const r = state.rounds[state.currentRound];
  let roundScore = 0;

  r.stats.forEach((stat, i) => {
    const pick = state.picks[i];
    const correct = r.correct[i];
    const isCorrect = pick === correct;
    if (isCorrect) roundScore++;

    const row = statPicks.children[i];
    row.classList.add('revealed');

    const btnA = row.querySelector('[data-pick="A"]');
    const btnB = row.querySelector('[data-pick="B"]');
    btnA.disabled = true;
    btnB.disabled = true;

    btnA.classList.remove('selected');
    btnB.classList.remove('selected');

    const label = getStatDisplayName(stat, r.position, state.sport, state.mode);
    const valA = formatStatValue(r.playerA[stat], stat, state.sport, state.mode);
    const valB = formatStatValue(r.playerB[stat], stat, state.sport, state.mode);

    btnA.textContent = valA;
    btnB.textContent = valB;

    const pickedBtn = pick === 'A' ? btnA : btnB;
    pickedBtn.classList.add('picked');
    const feedback = document.createElement('span');
    feedback.className = isCorrect ? 'feedback-check' : 'feedback-wrong';
    feedback.textContent = isCorrect ? '✓' : '✗';
    feedback.setAttribute('aria-hidden', 'true');
    pickedBtn.appendChild(feedback);

    row.querySelector('.stat-label').textContent = label;
  });

  state.score += roundScore;
  state.roundScores.push({ position: r.position, score: roundScore, total: r.stats.length });

  if (state.mode === MODES.BLITZ) {
    if (state.blitzTimeLeft <= 0) return;
    confirmBtn.textContent = 'Next round →';
    confirmBtn.onclick = goNextBlitz;
  } else {
    confirmBtn.textContent = state.currentRound < 2 ? 'Next round →' : 'See results';
    confirmBtn.onclick = goNext;
  }
}

function goNext() {
  state.currentRound++;
  if (state.currentRound < 3) {
    roundScreen.classList.remove('active');
    setTimeout(() => {
      renderRound();
      roundScreen.classList.add('active');
    }, 150);
  } else {
    const dailyModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.MLB_BATTERS, MODES.MLB_PITCHERS];
    if (dailyModes.includes(state.mode)) {
      storeDailyScore(state.score, state.sport, state.mode, state.roundScores);
    }
    updateStreak();
    showResults();
  }
}

function goNextBlitz() {
  state.currentRound++;
  if (state.blitzTimeLeft <= 0) return;
  addBlitzRound();
  roundScreen.classList.remove('active');
  setTimeout(() => {
    renderRound();
    roundScreen.classList.add('active');
  }, 100);
}

function updateStreak() {
  if (state.mode === MODES.BLITZ) return;
  const prefix = getDailyKey(state.sport, state.mode);
  const key = `${prefix}_streak`;
  const dateKey = `${prefix}_lastDate`;
  const today = new Date().toDateString();

  let streak = parseInt(localStorage.getItem(key) || '0', 10);
  const last = localStorage.getItem(dateKey);

  if (last === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  if (last === yesterdayStr) streak++;
  else streak = 1;

  localStorage.setItem(key, String(streak));
  localStorage.setItem(dateKey, today);
}

function getStreak(sport, mode) {
  const prefix = getDailyKey(sport || state.sport, mode || state.mode);
  return parseInt(localStorage.getItem(`${prefix}_streak`) || '0', 10);
}

const SHARE_URL_PLACEHOLDER = 'https://betterseason.live';
const SHARE_X_USERNAME = '@BetterSznGame';

// Vercel API for recording plays and today's stats. Set to your Vercel deployment URL (e.g. https://your-project.vercel.app).
const STATS_API_BASE = 'https://betterseasonvercel.vercel.app';

const SHORT_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

function getShareDateStr() {
  const d = new Date();
  return `(${SHORT_MONTHS[d.getMonth()]} ${d.getDate()})`;
}

function buildShareText(mode, score, roundScores, sport) {
  const modeStr = mode === 'daily' ? 'Daily' : mode === 'blitz' ? 'Blitz' : mode === 'rookie_qb' ? 'Rookie QBs' : mode === 'mlb_batters' ? 'MLB Batters' : mode === 'mlb_pitchers' ? 'MLB Pitchers' : mode === 'blind_resume' ? 'Blind Resume' : 'Unlimited';
  const total = mode === 'rookie_qb' ? 12 : 9;
  const scoreStr = (mode === 'blitz' || mode === 'blind_resume') ? `${score} pts` : `${score}/${total}pts`;
  const urlSuffix = (SHARE_X_USERNAME && SHARE_URL_PLACEHOLDER)
    ? `\n\n${SHARE_X_USERNAME}\n${SHARE_URL_PLACEHOLDER}`
    : SHARE_URL_PLACEHOLDER ? `\n\n${SHARE_URL_PLACEHOLDER}` : '';
  const dailyModes = ['daily', 'rookie_qb', 'mlb_batters', 'mlb_pitchers', 'blind_resume'];
  const isDaily = dailyModes.includes(mode);
  const dash = isDaily ? ' - ' : ' — ';
  const dateSuffix = isDaily ? ` ${getShareDateStr()}` : '';
  if (mode === 'blitz') {
    return `${scoreStr} — ${modeStr}${urlSuffix}`;
  }
  if (mode === 'blind_resume') {
    return `${scoreStr} — ${modeStr}${dateSuffix}` + urlSuffix;
  }
  let text = `${scoreStr}${dash}${modeStr}${dateSuffix}`;
  if (roundScores && roundScores.length > 0) {
    text += '\n\n';
    roundScores.forEach(({ position, score: rs, total: t }, idx) => {
      const correct = '✅'.repeat(rs);
      const wrong = '❌'.repeat(t - rs);
      if (mode === 'rookie_qb' || mode === 'mlb_batters' || mode === 'mlb_pitchers') {
        text += `Rd. ${idx + 1}  ${correct}${wrong}  ${rs}/${t}\n`;
      } else {
        text += `${position}  ${correct}${wrong}  ${rs}/${t}\n`;
      }
    });
  }
  return text.trimEnd() + urlSuffix;
}

function buildShareGridForMode(mode, score, roundScores, sport) {
  return buildShareText(mode, score, roundScores, sport);
}

function buildShareGrid() {
  return buildShareGridForMode(state.mode, state.score, state.roundScores, state.sport);
}

function recordPlay() {
  if (!STATS_API_BASE || !todayStatsEl) return;
  const url = STATS_API_BASE.replace(/\/$/, '') + '/api/play';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sport: state.sport,
      mode: state.mode,
      score: state.score,
    }),
  }).catch(() => {});
}

function formatTodayStats(gamesPlayed, averageScore, mode) {
  if (gamesPlayed == null || gamesPlayed === 0) return '';
  const isPoints = mode === MODES.BLITZ || mode === MODES.BLIND_RESUME;
  const avgStr = averageScore != null
    ? (isPoints ? `Avg ${averageScore} pts` : `Avg ${averageScore}/9`)
    : '';
  const parts = [`${gamesPlayed} game${gamesPlayed !== 1 ? 's' : ''} today`];
  if (avgStr) parts.push(avgStr);
  return parts.join(' · ');
}

function renderTodayStats(text) {
  if (!todayStatsEl) return;
  todayStatsEl.textContent = text || '';
  todayStatsEl.classList.toggle('visible', !!text);
}

function fetchTodayStats() {
  if (!STATS_API_BASE || !todayStatsEl) return;
  const date = new Date().toISOString().slice(0, 10);
  const url = `${STATS_API_BASE.replace(/\/$/, '')}/api/stats?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(state.sport)}&mode=${encodeURIComponent(state.mode)}`;
  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      const gamesPlayed = data.gamesPlayed ?? 0;
      const averageScore = data.averageScore ?? null;
      renderTodayStats(formatTodayStats(gamesPlayed, averageScore, state.mode));
    })
    .catch(() => renderTodayStats(''));
}

function showResults() {
  if (state.blitzTimerId) {
    clearInterval(state.blitzTimerId);
    state.blitzTimerId = null;
  }
  blitzTimerEl.classList.remove('visible');

  roundScreen.classList.remove('active');
  resultsScreen.classList.add('active');
  homeBtn.style.display = 'flex';

  if (state.mode === MODES.BLITZ) {
    resultsScore.textContent = state.score + ' pts';
  } else if (state.mode === MODES.BLIND_RESUME) {
    resultsScore.textContent = state.score + ' pts';
  } else {
    const total = state.totalPoints || 9;
    resultsScore.textContent = `${state.score}/${total}`;
  }
  resultsStreak.textContent = '';
  shareGrid.textContent = buildShareGrid();
  renderResultsModeButtons(state.mode);
  renderResultsSportToolbar();

  recordPlay();
  fetchTodayStats();

  const shareText = buildShareGrid();
  shareSmsBtn.onclick = () => { window.location.href = 'sms:?body=' + encodeURIComponent(shareText); };
  shareXBtn.onclick = () => { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText)); };

  const dailyModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.MLB_BATTERS, MODES.MLB_PITCHERS, MODES.BLIND_RESUME];
  newGameBtn.style.display = dailyModes.includes(state.mode) ? 'none' : 'inline-flex';
  newGameBtn.onclick = () => {
    if (state.mode === MODES.BLITZ) {
      goToStartScreen();
    } else {
      initGame(state.mode);
    }
  };
}

function setupHowToPlay() {
  howToBtn.addEventListener('click', () => {
    howToModal.classList.add('open');
    howToModal.setAttribute('aria-hidden', 'false');
  });
  modalClose.addEventListener('click', closeHowToModal);
  howToModal.addEventListener('click', (e) => {
    if (e.target === howToModal) closeHowToModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && howToModal.classList.contains('open')) closeHowToModal();
  });
}

function closeHowToModal() {
  howToModal.classList.remove('open');
  howToModal.setAttribute('aria-hidden', 'true');
}

function goToStartScreen() {
  if (state.blitzTimerId) {
    clearInterval(state.blitzTimerId);
    state.blitzTimerId = null;
  }
  blindResumeWrap.style.display = 'none';
  matchupWrap.style.display = '';
  statPicks.style.display = '';
  confirmBtn.style.display = '';
  homeBtn.style.display = 'none';
  startScreen.classList.add('active');
  roundScreen.classList.remove('active');
  resultsScreen.classList.remove('active');
  roundInstruction.textContent = 'Who had the better season?';
  updateStartScreen();
}

function updateStartScreen() {
  document.querySelectorAll('.sport-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.sport === state.sport);
  });
  document.querySelectorAll('.mode-card--nfl-only').forEach(card => {
    card.style.display = state.sport === 'nfl' ? '' : 'none';
  });
  document.querySelectorAll('.mode-card--mlb-only').forEach(card => {
    card.style.display = state.sport === 'mlb' ? 'flex' : 'none';
  });
  document.querySelectorAll('.mode-card--nfl-nba').forEach(card => {
    card.style.display = (state.sport === 'nfl' || state.sport === 'nba') ? '' : 'none';
  });
  document.querySelectorAll('.mode-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.mode === state.mode);
  });
  const sportAvailable = AVAILABLE_SPORTS.includes(state.sport);
  startBtn.disabled = !state.mode || !sportAvailable;
}

function setupSportTabs() {
  document.querySelectorAll('.sport-card').forEach(card => {
    const sport = card.dataset.sport;
    const isAvailable = AVAILABLE_SPORTS.includes(sport);
    if (!isAvailable) return;
    card.addEventListener('click', () => {
      state.sport = sport;
      if (sport !== 'nfl' && NFL_ONLY_MODES.includes(state.mode)) state.mode = null;
      if (sport !== 'mlb' && MLB_ONLY_MODES.includes(state.mode)) state.mode = null;
      if (sport === 'mlb' && !MLB_ONLY_MODES.includes(state.mode)) state.mode = null;
      document.querySelectorAll('.sport-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      updateStartScreen();
    });
  });
  document.querySelector('.sport-card--nfl').classList.add('selected');
}

function setupModeCards() {
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      state.mode = card.dataset.mode;
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateStartScreen();
    });
  });
}

function setupStartBtn() {
  startBtn.addEventListener('click', () => {
    if (!state.mode) return;
    const dailyModes = [MODES.DAILY, MODES.ROOKIE_QB, MODES.MLB_BATTERS, MODES.MLB_PITCHERS, MODES.BLIND_RESUME];
    if (dailyModes.includes(state.mode) && hasPlayedDailyToday(state.sport, state.mode)) {
      showDailyAlreadyPlayed();
    } else {
      initGame(state.mode);
    }
  });
}

function setupHomeBtn() {
  homeBtn.addEventListener('click', goToStartScreen);
}

async function main() {
  try {
    setupHowToPlay();
    setupHomeBtn();
    setupSportTabs();
    setupModeCards();
    setupStartBtn();
    state.allData = await loadData();
    state.data = state.allData[state.sport];
    goToStartScreen();
  } catch (e) {
    document.body.innerHTML = `
      <div style="padding:2rem;text-align:center;color:#f0f0f0;">
        <p>Failed to load data. Run a local server (e.g. <code>npx serve</code>) — fetch does not work with file:// URLs.</p>
        <p style="margin-top:1rem;font-size:0.9rem;color:#888;">${e.message}</p>
      </div>
    `;
  }
}

main();
