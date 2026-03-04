/**
 * Pick the Round — Golf game
 * 4 golfers × 3 cards (tournaments). Tap a card → flip → score locks in. Total = sum of 4 picks.
 * Data: golf_results.csv (player_name, event_name, year, score_to_par, position)
 */

const PAR_4_ROUNDS = 288; // 4 × 72
const GOLFERS_PER_GAME = 4;
const CARDS_PER_GOLFER = 3;
const DATA_URL = 'data/golf_results.csv';
const GOLF_PLAYER_IDS_URL = 'data/golf-player-ids.json';
const RANKINGS_CSV_URL = 'data/downloaded_rankings.csv';
const TOP_PLAYERS_ALLTIME_URL = 'data/top_players_alltime.csv';
// All-time list: minimum weight for players on the list (rank weight still applies, we take max)
const ALLTIME_WEIGHT_FLOOR = 3;
// Weight by rank: top 10 = 7, 11–50 = 6, 51–100 = 5, 101+ or not on list = 1
const RANK_WEIGHT_TOP_10 = 7;
const RANK_WEIGHT_TOP_50 = 6;
const RANK_WEIGHT_TOP_100 = 5;
const RANK_WEIGHT_DEFAULT = 1;
const GOLF_HEADSHOT_URL = 'https://a.espncdn.com/i/headshots/golf/players/full';
const GOLF_SHARE_URL = 'https://betterseason.live/golf';
const GOLF_SHARE_URL_ROOT = 'https://betterseason.live'; // use root in X share so tweet card uses main site og-image
const GOLF_SHARE_HANDLE = '@BetterSznGame';
const GOLF_SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Daily puzzle and leaderboard use this timezone; day rolls at midnight Central. */
const DAILY_TIMEZONE = 'America/Chicago';
/** localStorage key prefix for "completed this seed" (one play per day per mode). */
const GOLF_COMPLETED_KEY_PREFIX = 'betterseason_golf_completed_';
/** localStorage key prefix for stored result (picks, total, stats) so we can show grid + share on "already played". */
const GOLF_RESULT_KEY_PREFIX = 'betterseason_golf_result_';

const GOLF_HEADSHOT_FALLBACK_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" fill="%234a5568"><ellipse cx="50" cy="38" rx="22" ry="26"/><path d="M15 120c0-22 15-40 35-40s35 18 35 40z"/></svg>'
);

// Delay before showing results modal after the last card is picked (so user can see the final grid)
const RESULTS_MODAL_DELAY_MS = 2000;

// Year range: 2001–2026 (both normal and hard mode use full data range)
const MIN_YEAR = 2001;
const MAX_YEAR = 2026;

// Player pool: require 4+ distinct years of tournaments, unless they have a tournament in 2022–2026 (new/relevant)
const MIN_DISTINCT_YEARS = 4;
const RECENT_YEAR_START = 2022; // 2022–MAX_YEAR = "recent"; players with a tournament here skip the distinct-years rule
// Card selection: when a player has any tournament from this year onward, require at least 1 of their 3 cards to be from this set
const RECENT_CARD_YEAR = 2015;

// Only use results where the player made the cut (exclude CUT, WD, DQ, MDF)
const EXCLUDED_POSITIONS = new Set(['cut', 'wd', 'dq', 'mdf']);

// Normal mode: only these four majors (exact event_name match in CSV; include all tournament name variants in data)
const MAJOR_EVENT_NAMES = new Set([
  'The Masters',
  'Masters Tournament',
  'PGA Championship',
  'U.S. Open',
  'U.S. Open Championship',
  'U.S. Open Golf Championship',
  'The Open',
  'British Open Championship',
]);

// Seeded RNG for repeatable puzzles. Date string (e.g. "2026-03-02_majors") must be hashed to a number so mulberry32 gets a proper numeric state.
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

/** Normalize name for matching: lowercase, trim, remove diacritics, collapse spaces. */
function normalizeForMatch(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Parse a CSV line with quoted fields (strips surrounding quotes from each value). */
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

function loadData(easyMode) {
  return fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${DATA_URL}: ${r.status}`);
      return r.text();
    })
    .then(parseCSV)
    .then((rows) => {
      let out = rows
        .filter((r) => r.score_to_par !== '' && r.score_to_par !== undefined)
        .filter((r) => {
          const pos = (r.position || '').trim().toLowerCase();
          return !EXCLUDED_POSITIONS.has(pos);
        })
        .map((r) => ({
          player_name: (r.player_name || '').trim(),
          event_name: (r.event_name || '').trim(),
          year: parseInt(r.year, 10) || 0,
          score_to_par: parseInt(r.score_to_par, 10),
        }))
        .filter((r) => r.player_name && !isNaN(r.score_to_par))
        .filter((r) => r.year >= MIN_YEAR && r.year <= MAX_YEAR);
      if (easyMode) {
        out = out.filter((r) => MAJOR_EVENT_NAMES.has(r.event_name));
      }
      return out;
    });
}

function buildPuzzle(rows, seed, rankMap, alltimeSet) {
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
  const playersWithHeadshot = playersWithEnough.filter(([playerName]) => hasGolfHeadshot(playerName));
  if (playersWithHeadshot.length < GOLFERS_PER_GAME) {
    throw new Error(
      `Need at least ${GOLFERS_PER_GAME} golfers with headshots and ${CARDS_PER_GOLFER}+ tournaments. Found ${playersWithHeadshot.length}.`
    );
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
  const TOP_15_RANK = 15;
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
        const chosenEntry = top15Pool[i].entry;
        pool = pool.filter((p) => p.entry[0] !== chosenEntry[0]);
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
  const puzzle = selected.map(([player, events]) => {
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
  return puzzle;
}

// --- DOM
const grid = document.getElementById('grid');
const resultsModal = document.getElementById('results-modal');
const resultsModalClose = document.getElementById('results-modal-close');
const resultsModalBackdrop = document.getElementById('results-modal-backdrop');
const finalTotal = document.getElementById('final-total');
const scorebugEl = document.getElementById('scorebug');
const scorebugValue = document.getElementById('scorebug-value');
const scorebugShareBtn = document.getElementById('scorebug-share-btn');
const howToModal = document.getElementById('how-to-modal');
const howToModalBackdrop = document.getElementById('how-to-modal-backdrop');
const howToModalClose = document.getElementById('how-to-modal-close');
const howToModalBtn = document.getElementById('how-to-modal-btn');
const golfShareGrid = document.getElementById('golf-share-grid');
const golfShareNativeBtn = document.getElementById('golf-share-native-btn');
const golfShareSmsBtn = document.getElementById('golf-share-sms-btn');
const golfSaveImageBtn = document.getElementById('golf-save-image-btn');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const howToDetailModal = document.getElementById('how-to-detail-modal');
const howToDetailModalBackdrop = document.getElementById('how-to-detail-modal-backdrop');
const howToDetailModalClose = document.getElementById('how-to-detail-modal-close');
const hardModeBtn = document.getElementById('hard-mode-btn');
const easyModeBtn = document.getElementById('easy-mode-btn');
const leaveGameHardModal = document.getElementById('leave-game-hard-modal');
const leaveGameHardModalBackdrop = document.getElementById('leave-game-hard-modal-backdrop');
const leaveGameHardGo = document.getElementById('leave-game-hard-go');
const leaveGameHardStay = document.getElementById('leave-game-hard-stay');
const leaveGameEasyModal = document.getElementById('leave-game-easy-modal');
const leaveGameEasyModalBackdrop = document.getElementById('leave-game-easy-modal-backdrop');
const leaveGameEasyGo = document.getElementById('leave-game-easy-go');
const leaveGameEasyStay = document.getElementById('leave-game-easy-stay');
const resultsStatsSection = document.getElementById('results-stats-section');
const resultsStatsPercentile = document.getElementById('results-stats-percentile');
const resultsStatsLeaderboard = document.getElementById('results-stats-leaderboard');
const resultsStatsLeaderboardListWrap = document.getElementById('results-stats-leaderboard-list-wrap');
const resultsStatsLeaderboardToggle = document.getElementById('results-stats-leaderboard-toggle');
const resultsShareSection = document.getElementById('results-share-section');
const resultsStatsLoading = document.getElementById('results-stats-loading');
const alreadyPlayedImageBtn = document.getElementById('already-played-image-btn');
const alreadyPlayedTextBtn = document.getElementById('already-played-text-btn');
const initialsModal = document.getElementById('initials-modal');
const initialsModalBackdrop = document.getElementById('initials-modal-backdrop');
const initialsInput = document.getElementById('initials-input');
const initialsSubmit = document.getElementById('initials-submit');
const initialsError = document.getElementById('initials-error');

let state = {
  puzzle: null,
  picks: [], // one score_to_par per row (index = row)
  seed: 0,
  golfPlayerIds: {}, // name -> ESPN id for headshots
  easyMode: (function () {
    const m = new URLSearchParams(window.location.search).get('mode');
    return m !== 'hard' && m !== 'normal'; // no param or other = majors; ?mode=hard or ?mode=normal = Best Ball (Hard)
  })(),
};
let hasShownHowToThisSession = false;

function normalizeNameForLookup(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function hasGolfHeadshot(playerName) {
  const playerIds = state.golfPlayerIds;
  if (!playerIds || typeof playerIds !== 'object') return false;
  const raw = (playerName || '').trim();
  if (!raw) return false;
  return !!(playerIds[raw] || playerIds[normalizeNameForLookup(raw)]);
}

function getGolfHeadshotUrl(playerName) {
  const playerIds = state.golfPlayerIds;
  if (!playerIds || typeof playerIds !== 'object') return null;
  const raw = (playerName || '').trim();
  if (!raw) return null;
  const id = playerIds[raw] || playerIds[normalizeNameForLookup(raw)];
  if (!id) return null;
  return `${GOLF_HEADSHOT_URL}/${id}.png`;
}

function getCompletedForSeed(seed) {
  if (!seed || typeof seed !== 'string') return false;
  try {
    return localStorage.getItem(GOLF_COMPLETED_KEY_PREFIX + seed) === '1';
  } catch (e) {
    return false;
  }
}

function setCompletedForSeed(seed) {
  if (!seed || typeof seed !== 'string') return;
  try {
    localStorage.setItem(GOLF_COMPLETED_KEY_PREFIX + seed, '1');
  } catch (e) {}
}

function getStoredResult(seed) {
  if (!seed || typeof seed !== 'string') return null;
  try {
    const raw = localStorage.getItem(GOLF_RESULT_KEY_PREFIX + seed);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && Array.isArray(data.picks) && typeof data.total === 'number' ? data : null;
  } catch (e) {
    return null;
  }
}

function setStoredResult(seed, data) {
  if (!seed || typeof seed !== 'string' || !data) return;
  try {
    localStorage.setItem(GOLF_RESULT_KEY_PREFIX + seed, JSON.stringify(data));
  } catch (e) {}
}

/**
 * Current calendar date in DAILY_TIMEZONE (America/Chicago). Used so the puzzle day rolls at midnight Central.
 */
function getTodayCentralDateString() {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DAILY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('Central date fallback:', e);
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Daily seed so everyone gets the same puzzle. Use ?test=1 or ?seed=YYYY-MM-DD to force a fixed puzzle for testing. */
function getSeed() {
  const params = new URLSearchParams(window.location.search);
  const testSeed = params.get('seed'); // e.g. ?seed=2025-03-01
  if (testSeed) {
    return state.easyMode ? `${testSeed}_majors` : `${testSeed}_all`;
  }
  if (params.get('test') === '1') {
    const d = new Date();
    const fixed = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return state.easyMode ? `${fixed}_majors` : `${fixed}_all`;
  }
  const dateStr = getTodayCentralDateString();
  return state.easyMode ? `${dateStr}_majors` : `${dateStr}_all`;
}

function formatScore(n) {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

/** Normalize tournament name for display: strip year prefix, strip "World Golf Championships-", fix capitalization. */
function formatEventNameForDisplay(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.trim();
  s = s.replace(/^\d{4}\s+/, ''); // remove leading year (e.g. "2017 Masters Tournament")
  s = s.replace(/^World\s+Golf\s+Championships-\s*/i, ''); // remove "World Golf Championships-" prefix
  if (!s) return name.trim();
  if (s === 'The Open') return 'The Open Championship';
  if (s.startsWith('the ')) s = 'The ' + s.slice(4);
  else if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Card background: 3 shades of green, 3 of yellow, 3 of red. Tuned for strong contrast with white score text. */
function getScoreBackgroundColor(scoreToPar) {
  const greenShades = ['hsl(152, 42%, 46%)', 'hsl(152, 40%, 50%)', 'hsl(152, 38%, 54%)'];
  const yellowShades = ['hsl(48, 56%, 40%)', 'hsl(48, 52%, 44%)', 'hsl(48, 48%, 48%)'];
  const redShades = ['hsl(0, 52%, 46%)', 'hsl(0, 54%, 42%)', 'hsl(0, 56%, 38%)'];

  if (scoreToPar <= -10) return greenShades[0];
  if (scoreToPar <= -4) return greenShades[1];
  if (scoreToPar <= -1) return greenShades[2];
  if (scoreToPar <= 0) return yellowShades[0];
  if (scoreToPar <= 2) return yellowShades[1];
  if (scoreToPar <= 5) return yellowShades[2];
  if (scoreToPar <= 9) return redShades[2];
  if (scoreToPar <= 15) return redShades[1];
  return redShades[0];
}

function renderGrid() {
  grid.innerHTML = '';
  state.puzzle.forEach((golfer, colIndex) => {
    const colEl = document.createElement('div');
    colEl.className = 'grid-col';
    colEl.setAttribute('role', 'column');

    const infoWrap = document.createElement('div');
    infoWrap.className = 'golfer-info';

    const headshotEl = document.createElement('div');
    headshotEl.className = 'golfer-headshot';
    headshotEl.setAttribute('aria-hidden', 'true');
    const headshotUrl = getGolfHeadshotUrl(golfer.player_name);
    const imgSrc = headshotUrl || GOLF_HEADSHOT_FALLBACK_SVG;
    headshotEl.innerHTML = '<img src="' + imgSrc + '" alt="" loading="lazy">';
    const img = headshotEl.querySelector('img');
    if (img) img.onerror = function () { this.src = GOLF_HEADSHOT_FALLBACK_SVG; };
    infoWrap.appendChild(headshotEl);

    const nameCell = document.createElement('div');
    nameCell.className = 'golfer-name';
    nameCell.innerHTML = `<span class="golfer-name-inner">${escapeHtml(golfer.player_name)}</span>`;
    infoWrap.appendChild(nameCell);

    colEl.appendChild(infoWrap);
    golfer.cards.forEach((card, cardIndex) => {
      const picked = state.picks[colIndex] !== undefined;
      const isThisPicked = picked && state.picks[colIndex] === card.score_to_par;
      const cardEl = document.createElement('div');
      cardEl.className = 'card' + (picked ? ' flipped' : '') + (isThisPicked ? ' picked' : '');
      cardEl.setAttribute('role', 'gridcell');
      cardEl.dataset.col = colIndex;
      cardEl.dataset.card = cardIndex;
      const scoreBg = getScoreBackgroundColor(card.score_to_par);
      const displayName = formatEventNameForDisplay(card.event_name);
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-front">
            <span class="event-name">${escapeHtml(displayName)}</span>
            <span class="event-year">${card.year}</span>
          </div>
          <div class="card-back" style="--score-bg: ${scoreBg}">
            <span class="card-back-event">${escapeHtml(displayName)} ${card.year}</span>
            <span class="score">${formatScore(card.score_to_par)}</span>
          </div>
        </div>
      `;
      if (!picked) {
        cardEl.addEventListener('click', () => pickCard(colIndex, card.score_to_par, cardEl));
      }
      colEl.appendChild(cardEl);
    });
    if (state.picks[colIndex] !== undefined) colEl.classList.add('column-picked');
    grid.appendChild(colEl);
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function pickCard(colIndex, scoreToPar, cardEl) {
  if (state.picks[colIndex] !== undefined) return;
  state.picks[colIndex] = scoreToPar;
  cardEl.classList.add('picked', 'flipped');
  const col = cardEl.closest('.grid-col');
  col.classList.add('column-picked');
  col.querySelectorAll('.card').forEach((c) => c.classList.add('flipped'));
  updateScorebug();
  const definedCount = state.picks.filter((p) => p !== undefined).length;
  if (definedCount === 4) {
    setTimeout(showResults, RESULTS_MODAL_DELAY_MS);
  }
}

function updateScorebug() {
  if (!scorebugEl || !scorebugValue) return;
  const defined = state.picks.filter((p) => p !== undefined);
  scorebugEl.classList.remove('scorebug--under', 'scorebug--over', 'scorebug--even');
  if (scorebugShareBtn) {
    scorebugShareBtn.classList.toggle('hidden', defined.length !== 4);
  }
  if (defined.length === 0) {
    scorebugValue.textContent = '—';
    return;
  }
  const sum = defined.reduce((a, b) => a + b, 0);
  scorebugValue.textContent = formatScore(sum);
  if (sum < 0) scorebugEl.classList.add('scorebug--under');
  else if (sum > 0) scorebugEl.classList.add('scorebug--over');
  else scorebugEl.classList.add('scorebug--even');
}

function getGolfShareDateStr() {
  const dateStr = getTodayCentralDateString();
  const parts = dateStr.split('-').map(Number);
  if (parts.length >= 3) {
    const month = parts[1];
    const day = parts[2];
    if (month >= 1 && month <= 12) return `${GOLF_SHARE_MONTHS[month - 1]} ${day}`;
  }
  const d = new Date();
  return `${GOLF_SHARE_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Map score to par to share emoji — must match card color bands: green < 0, yellow 0–5, red 6+. */
function scoreToShareEmoji(scoreToPar) {
  if (scoreToPar < 0) return '🟩';
  if (scoreToPar <= 5) return '🟨';
  return '🟥';
}

function buildGolfShareText(total, forSms) {
  const dateStr = getGolfShareDateStr();
  const scoreStr = formatScore(total);
  const modeLabel = state.easyMode ? 'Best Ball' : 'Best Ball (Hard)';
  const emojiRow = (state.picks || []).map(scoreToShareEmoji).join('\n');
  const percentileLine = state.lastPercentile != null ? `${state.lastPercentile}th percentile` : '';
  const lines = [
    `${modeLabel}⛳ ${dateStr}`,
    scoreStr,
    percentileLine,
    emojiRow || '',
  ].filter(Boolean);
  const urlPart = GOLF_SHARE_URL ? `\n\n${GOLF_SHARE_URL}` : '';
  const body = lines.join('\n');
  if (forSms) return body + urlPart;
  // X share uses root URL so the tweet card shows the main site og-image, not /golf
  const handlePart = GOLF_SHARE_HANDLE ? `\n\n${GOLF_SHARE_HANDLE}\n${GOLF_SHARE_URL_ROOT}` : (GOLF_SHARE_URL_ROOT ? `\n\n${GOLF_SHARE_URL_ROOT}` : '');
  return body + handlePart;
}

/** Share preview only (no handle or URL) for display in the modal. */
function buildGolfSharePreview(total) {
  const dateStr = getGolfShareDateStr();
  const scoreStr = formatScore(total);
  const modeLabel = state.easyMode ? 'Best Ball' : 'Best Ball (Hard)';
  const emojiRow = (state.picks || []).map(scoreToShareEmoji).join('\n');
  const percentileLine = state.lastPercentile != null ? `${state.lastPercentile}th percentile` : '';
  const lines = [
    `${modeLabel}⛳ ${dateStr}`,
    scoreStr,
    percentileLine,
    emojiRow || '',
  ].filter(Boolean);
  return lines.join('\n');
}

function setupGolfShareButtons(shareTextX, shareTextSms, total) {
  const hasWebShare = typeof navigator !== 'undefined' && navigator.share;
  if (golfShareNativeBtn) {
    if (hasWebShare) {
      golfShareNativeBtn.classList.remove('hidden');
      const shareTextOnly = buildGolfSharePreview(total); // no URL in text; URL is passed separately
      golfShareNativeBtn.onclick = async () => {
        try {
          await navigator.share({
            text: shareTextOnly,
            url: GOLF_SHARE_URL,
          });
        } catch (e) {
          if (e.name !== 'AbortError') console.error('Share failed:', e);
        }
      };
    } else {
      golfShareNativeBtn.classList.add('hidden');
    }
  }
  if (golfShareSmsBtn) {
    golfShareSmsBtn.classList.toggle('hidden', !!hasWebShare);
    golfShareSmsBtn.onclick = () => { window.location.href = 'sms:?body=' + encodeURIComponent(shareTextSms); };
  }
  if (golfSaveImageBtn) {
    golfSaveImageBtn.onclick = () => {
      const dateStr = getGolfShareDateStr();
      const picksParam = (state.picks || []).map((p) => p).join(',');
      const params = new URLSearchParams({
        score: String(total),
        date: dateStr,
        mode: state.easyMode ? 'majors' : 'hard',
        picks: picksParam,
      });
      if (state.lastPercentile != null) params.set('percentile', String(state.lastPercentile));
      if (state.lastTotalPlayers != null) params.set('totalPlayers', String(state.lastTotalPlayers));
      const lb = state.lastLeaderboard || [];
      if (lb.length > 0) {
        params.set('leaderboard', lb.map((r) => r.score).join(','));
        const youRow = lb.find((r) => r.isYou);
        if (youRow) {
          params.set('youRank', String(youRow.rank));
          const youInitials = window.PlayerInitials && window.PlayerInitials.getInitials && window.PlayerInitials.getInitials();
          if (youInitials) params.set('youInitials', youInitials);
        }
      }
      if (state.puzzle && state.puzzle.length >= 4) {
        state.puzzle.forEach((golfer, i) => {
          const url = getGolfHeadshotUrl(golfer.player_name);
          if (url) params.set('headshot' + (i + 1), url);
        });
      }
      params.set('auto', '1');
      window.open('share-card-mock.html?' + params.toString(), '_blank', 'noopener');
    };
  }
}

function setupAlreadyPlayedShareButtons(total) {
  const shareTextSms = buildGolfShareText(total, true);
  const shareTextOnly = buildGolfSharePreview(total);
  const hasWebShare = typeof navigator !== 'undefined' && navigator.share;
  if (alreadyPlayedImageBtn) {
    alreadyPlayedImageBtn.onclick = () => {
      const dateStr = getGolfShareDateStr();
      const picksParam = (state.picks || []).map((p) => p).join(',');
      const params = new URLSearchParams({
        score: String(total),
        date: dateStr,
        mode: state.easyMode ? 'majors' : 'hard',
        picks: picksParam,
      });
      if (state.lastPercentile != null) params.set('percentile', String(state.lastPercentile));
      if (state.lastTotalPlayers != null) params.set('totalPlayers', String(state.lastTotalPlayers));
      const lb = state.lastLeaderboard || [];
      if (lb.length > 0) {
        params.set('leaderboard', lb.map((r) => r.score).join(','));
        const youRow = lb.find((r) => r.isYou);
        if (youRow) {
          params.set('youRank', String(youRow.rank));
          const youInitials = window.PlayerInitials && window.PlayerInitials.getInitials && window.PlayerInitials.getInitials();
          if (youInitials) params.set('youInitials', youInitials);
        }
      }
      if (state.puzzle && state.puzzle.length >= 4) {
        state.puzzle.forEach((golfer, i) => {
          const url = getGolfHeadshotUrl(golfer.player_name);
          if (url) params.set('headshot' + (i + 1), url);
        });
      }
      params.set('auto', '1');
      window.open('share-card-mock.html?' + params.toString(), '_blank', 'noopener');
    };
  }
  if (alreadyPlayedTextBtn) {
    alreadyPlayedTextBtn.onclick = async () => {
      if (hasWebShare) {
        try {
          await navigator.share({ text: shareTextOnly, url: GOLF_SHARE_URL });
        } catch (e) {
          if (e.name !== 'AbortError') console.error('Share failed:', e);
        }
      } else {
        window.location.href = 'sms:?body=' + encodeURIComponent(shareTextSms);
      }
    };
  }
}

function renderStatsInModal(stats) {
  if (!stats) return;
  // One line: percentile · players · avg
  if (resultsStatsPercentile) {
    const parts = [];
    if (stats.percentile != null) parts.push(`${stats.percentile}th percentile`);
    if (stats.totalPlayers > 0) parts.push(`${stats.totalPlayers} player${stats.totalPlayers !== 1 ? 's' : ''} today`);
    if (stats.averageScore != null && !isNaN(stats.averageScore)) {
      const avgStr = formatScore(Math.round(stats.averageScore * 10) / 10);
      parts.push(`Avg ${avgStr}`);
    }
    if (parts.length > 0) {
      resultsStatsPercentile.textContent = 'You: ' + parts.join(' · ');
      resultsStatsPercentile.classList.remove('hidden');
    } else {
      resultsStatsPercentile.classList.add('hidden');
    }
  }
  // Leaderboard: populate list with rank (left), initials, score columns; keep collapsed by default
  if (resultsStatsLeaderboard) {
    resultsStatsLeaderboard.innerHTML = '';
    (stats.leaderboard || []).forEach((row) => {
      const li = document.createElement('li');
      li.className = 'results-stats-leaderboard-row' + (row.isYou ? ' results-stats-leaderboard-row--you' : '');
      const rankSpan = document.createElement('span');
      rankSpan.className = 'results-stats-leaderboard-rank';
      rankSpan.textContent = row.rank + '.';
      const initialsSpan = document.createElement('span');
      initialsSpan.className = 'results-stats-leaderboard-initials';
      initialsSpan.textContent = row.initials || '—';
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'results-stats-leaderboard-score';
      scoreSpan.textContent = formatScore(row.score) + (row.isYou ? ' (You)' : '');
      li.appendChild(rankSpan);
      li.appendChild(initialsSpan);
      li.appendChild(scoreSpan);
      resultsStatsLeaderboard.appendChild(li);
    });
  }
  if (resultsStatsLeaderboardListWrap) resultsStatsLeaderboardListWrap.classList.add('hidden');
  if (resultsStatsLeaderboardToggle) {
    resultsStatsLeaderboardToggle.textContent = 'See Top 10';
    resultsStatsLeaderboardToggle.setAttribute('aria-expanded', 'false');
  }
  if (resultsStatsSection) resultsStatsSection.classList.remove('hidden');
  state.lastPercentile = stats.percentile != null ? stats.percentile : undefined;
  state.lastLeaderboard = stats.leaderboard || [];
  state.lastTotalPlayers = stats.totalPlayers != null ? stats.totalPlayers : undefined;
  // Rebuild share text so it includes percentile
  const total = state.picks.reduce((a, b) => a + b, 0);
  const shareTextX = buildGolfShareText(total, false);
  const shareTextSms = buildGolfShareText(total, true);
  if (golfShareGrid) golfShareGrid.textContent = buildGolfSharePreview(total);
  setupGolfShareButtons(shareTextX, shareTextSms, total);
}

function toggleLeaderboardInModal() {
  if (!resultsStatsLeaderboardListWrap || !resultsStatsLeaderboardToggle) return;
  const isHidden = resultsStatsLeaderboardListWrap.classList.contains('hidden');
  resultsStatsLeaderboardListWrap.classList.toggle('hidden', !isHidden);
  resultsStatsLeaderboardToggle.textContent = isHidden ? 'Hide leaderboard' : 'See Top 10';
  resultsStatsLeaderboardToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  if (resultsShareSection) resultsShareSection.classList.toggle('hidden', isHidden);
}

if (resultsStatsLeaderboardToggle) resultsStatsLeaderboardToggle.addEventListener('click', toggleLeaderboardInModal);

function runSubmitAndShowStats(total) {
  const puzzleId = state.seed;
  const sport = 'pga';
  const mode = state.easyMode ? 'pick_the_round_majors' : 'pick_the_round';
  const higherIsBetter = false;

  if (resultsModal) resultsModal.classList.remove('hidden');
  if (resultsStatsSection) resultsStatsSection.classList.add('hidden');
  if (resultsShareSection) resultsShareSection.classList.remove('hidden');
  if (resultsStatsLoading) resultsStatsLoading.classList.remove('hidden');

  if (window.GolfStats && window.GolfStats.submitAndFetchStats) {
    window.GolfStats.submitAndFetchStats(puzzleId, sport, mode, total, higherIsBetter, function (stats) {
      if (resultsStatsLoading) resultsStatsLoading.classList.add('hidden');
      if (stats) {
        renderStatsInModal(stats);
        state.hasSubmittedForSeed = true;
        setStoredResult(state.seed, {
          picks: state.picks.slice(),
          total,
          lastPercentile: state.lastPercentile,
          lastTotalPlayers: state.lastTotalPlayers,
          lastLeaderboard: state.lastLeaderboard || [],
          hasSubmittedForSeed: true,
        });
      }
    });
  } else {
    if (resultsStatsLoading) resultsStatsLoading.classList.add('hidden');
  }

  if (resultsModalClose) resultsModalClose.focus();
}

function runFetchOnlyAndShowStats(total) {
  const puzzleId = state.seed;
  const higherIsBetter = false;

  if (resultsModal) resultsModal.classList.remove('hidden');
  if (resultsStatsSection) resultsStatsSection.classList.add('hidden');
  if (resultsShareSection) resultsShareSection.classList.remove('hidden');
  if (resultsStatsLoading) resultsStatsLoading.classList.remove('hidden');

  if (window.GolfStats && window.GolfStats.fetchStatsOnly) {
    window.GolfStats.fetchStatsOnly(puzzleId, total, higherIsBetter, function (stats) {
      if (resultsStatsLoading) resultsStatsLoading.classList.add('hidden');
      if (stats) {
        renderStatsInModal(stats);
        setStoredResult(state.seed, {
          picks: state.picks.slice(),
          total,
          lastPercentile: state.lastPercentile,
          lastTotalPlayers: state.lastTotalPlayers,
          lastLeaderboard: state.lastLeaderboard || [],
          hasSubmittedForSeed: true,
        });
      }
    });
  } else {
    if (resultsStatsLoading) resultsStatsLoading.classList.add('hidden');
  }

  if (resultsModalClose) resultsModalClose.focus();
}

function showResults() {
  const total = state.picks.reduce((a, b) => a + b, 0);
  setCompletedForSeed(state.seed);
  setStoredResult(state.seed, {
    picks: state.picks.slice(),
    total,
    lastPercentile: state.lastPercentile,
    lastTotalPlayers: state.lastTotalPlayers,
    lastLeaderboard: state.lastLeaderboard || [],
    hasSubmittedForSeed: state.hasSubmittedForSeed || false,
  });
  finalTotal.textContent = formatScore(total);
  const shareTextX = buildGolfShareText(total, false);
  const shareTextSms = buildGolfShareText(total, true);
  if (golfShareGrid) golfShareGrid.textContent = buildGolfSharePreview(total);
  setupGolfShareButtons(shareTextX, shareTextSms, total);

  const needInitials = window.PlayerInitials && !window.PlayerInitials.hasInitials();
  if (needInitials && initialsModal) {
    window.__golfInitialsSubmitCallback = function () {
      runSubmitAndShowStats(total);
    };
    initialsModal.classList.remove('hidden');
    if (initialsError) { initialsError.classList.add('hidden'); initialsError.textContent = ''; }
    if (initialsInput) { initialsInput.value = ''; initialsInput.focus(); }
    return;
  }

  if (state.hasSubmittedForSeed) {
    runFetchOnlyAndShowStats(total);
  } else {
    runSubmitAndShowStats(total);
  }
}

function closeResultsModal() {
  if (resultsModal) resultsModal.classList.add('hidden');
}

if (resultsModalClose) resultsModalClose.addEventListener('click', closeResultsModal);
if (resultsModalBackdrop) resultsModalBackdrop.addEventListener('click', closeResultsModal);

if (initialsInput) {
  initialsInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (initialsSubmit) initialsSubmit.click();
    }
  });
}

function showHowToModal() {
  if (howToModal) howToModal.classList.remove('hidden');
}

function closeHowToModal() {
  if (howToModal) howToModal.classList.add('hidden');
}

if (howToModalBackdrop) howToModalBackdrop.addEventListener('click', closeHowToModal);
if (howToModalClose) howToModalClose.addEventListener('click', closeHowToModal);
if (howToModalBtn) howToModalBtn.addEventListener('click', closeHowToModal);

function showHowToDetailModal() {
  if (howToDetailModal) howToDetailModal.classList.remove('hidden');
}

function closeHowToDetailModal() {
  if (howToDetailModal) howToDetailModal.classList.add('hidden');
}

if (howToPlayBtn) howToPlayBtn.addEventListener('click', showHowToDetailModal);
if (howToDetailModalBackdrop) howToDetailModalBackdrop.addEventListener('click', closeHowToDetailModal);
if (howToDetailModalClose) howToDetailModalClose.addEventListener('click', closeHowToDetailModal);

function handleInitialsSubmit() {
  const raw = initialsInput ? initialsInput.value.trim() : '';
  const result = window.PlayerInitials && window.PlayerInitials.validate ? window.PlayerInitials.validate(raw) : { valid: false, message: 'Enter 2 letters.' };
  if (!result.valid) {
    if (initialsError) {
      initialsError.textContent = result.message || 'Enter 2 letters.';
      initialsError.classList.remove('hidden');
    }
    return;
  }
  if (window.PlayerInitials && window.PlayerInitials.setInitials) window.PlayerInitials.setInitials(result.normalized);
  if (initialsModal) initialsModal.classList.add('hidden');
  if (window.__golfInitialsSubmitCallback) {
    const fn = window.__golfInitialsSubmitCallback;
    window.__golfInitialsSubmitCallback = null;
    fn();
  }
}

if (initialsSubmit) initialsSubmit.addEventListener('click', handleInitialsSubmit);
if (initialsModalBackdrop) {
  initialsModalBackdrop.addEventListener('click', function () {
    if (!initialsModal) return;
    initialsModal.classList.add('hidden');
    if (window.__golfInitialsSubmitCallback) {
      const fn = window.__golfInitialsSubmitCallback;
      window.__golfInitialsSubmitCallback = null;
      fn();
    }
  });
}

function showLeaveGameHardModal() {
  if (leaveGameHardModal) leaveGameHardModal.classList.remove('hidden');
}
function closeLeaveGameHardModal() {
  if (leaveGameHardModal) leaveGameHardModal.classList.add('hidden');
}
if (hardModeBtn) hardModeBtn.addEventListener('click', showLeaveGameHardModal);
if (leaveGameHardModalBackdrop) leaveGameHardModalBackdrop.addEventListener('click', closeLeaveGameHardModal);
if (leaveGameHardStay) leaveGameHardStay.addEventListener('click', closeLeaveGameHardModal);
if (leaveGameHardGo) leaveGameHardGo.addEventListener('click', () => {
  closeLeaveGameHardModal();
  window.location.href = window.location.pathname + '?mode=hard';
});

function showLeaveGameEasyModal() {
  if (leaveGameEasyModal) leaveGameEasyModal.classList.remove('hidden');
}
function closeLeaveGameEasyModal() {
  if (leaveGameEasyModal) leaveGameEasyModal.classList.add('hidden');
}
if (easyModeBtn) easyModeBtn.addEventListener('click', showLeaveGameEasyModal);
if (leaveGameEasyModalBackdrop) leaveGameEasyModalBackdrop.addEventListener('click', closeLeaveGameEasyModal);
if (leaveGameEasyStay) leaveGameEasyStay.addEventListener('click', closeLeaveGameEasyModal);
if (leaveGameEasyGo) leaveGameEasyGo.addEventListener('click', () => {
  closeLeaveGameEasyModal();
  window.location.href = window.location.pathname;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && howToDetailModal && !howToDetailModal.classList.contains('hidden')) {
    closeHowToDetailModal();
  }
  if (e.key === 'Escape' && leaveGameHardModal && !leaveGameHardModal.classList.contains('hidden')) {
    closeLeaveGameHardModal();
  }
  if (e.key === 'Escape' && leaveGameEasyModal && !leaveGameEasyModal.classList.contains('hidden')) {
    closeLeaveGameEasyModal();
  }
});

if (scorebugShareBtn) scorebugShareBtn.addEventListener('click', showResults);

function loadGolfPlayerIds() {
  return fetch(GOLF_PLAYER_IDS_URL)
    .then((r) => (r.ok ? r.json() : { players: {} }))
    .then((json) => {
      state.golfPlayerIds = json.players || {};
    })
    .catch(() => {
      state.golfPlayerIds = {};
    });
}

/** Load top_players_alltime.csv (Golfer Name column); return Set(normalizedName). */
function loadTopPlayersAlltime() {
  return fetch(TOP_PLAYERS_ALLTIME_URL)
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => {
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
    })
    .catch(() => new Set());
}

/** Load rankings CSV (RANKING + NAME columns); return Map(normalizedName -> rank number). */
function loadRankings() {
  return fetch(RANKINGS_CSV_URL)
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => {
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
        const norm = normalizeForMatch(name);
        map.set(norm, rank);
        const comma = name.indexOf(', ');
        if (comma > 0) map.set(normalizeForMatch(name.slice(comma + 2) + ' ' + name.slice(0, comma)), rank);
      }
      return map;
    })
    .catch(() => new Map());
}

function updatePageTitleAndHeader() {
  const title = state.easyMode ? 'Best Ball' : 'Best Ball (Hard)';
  document.title = title + ' — Golf';
  const titleEl = document.getElementById('golf-page-title');
  if (titleEl) titleEl.textContent = title;
  const hardWrap = document.getElementById('hard-mode-btn-wrap');
  const easyWrap = document.getElementById('easy-mode-btn-wrap');
  if (hardWrap) {
    if (state.easyMode) hardWrap.classList.remove('hidden');
    else hardWrap.classList.add('hidden');
  }
  if (easyWrap) {
    if (state.easyMode) easyWrap.classList.add('hidden');
    else easyWrap.classList.remove('hidden');
  }
}

const gridWrapper = document.getElementById('grid-wrapper');
const alreadyPlayedWrap = document.getElementById('already-played-wrap');

function showAlreadyPlayedView(seed, result) {
  if (gridWrapper) gridWrapper.classList.remove('hidden');
  if (alreadyPlayedWrap) {
    const shareBtns = alreadyPlayedWrap.querySelector('.already-played-share-buttons');
    if (shareBtns) shareBtns.classList.toggle('hidden', !result || typeof result.total !== 'number');
    alreadyPlayedWrap.classList.remove('hidden');
    if (result && typeof result.total === 'number') setupAlreadyPlayedShareButtons(result.total);
  }
  if (scorebugValue && state.picks && state.picks.length === 4) {
    const sum = state.picks.reduce((a, b) => a + b, 0);
    scorebugValue.textContent = formatScore(sum);
    scorebugEl.classList.remove('scorebug--under', 'scorebug--over', 'scorebug--even');
    if (sum < 0) scorebugEl.classList.add('scorebug--under');
    else if (sum > 0) scorebugEl.classList.add('scorebug--over');
    else scorebugEl.classList.add('scorebug--even');
    if (scorebugShareBtn) scorebugShareBtn.classList.remove('hidden');
  }
}

function hideAlreadyPlayedView() {
  if (alreadyPlayedWrap) alreadyPlayedWrap.classList.add('hidden');
  if (gridWrapper) gridWrapper.classList.remove('hidden');
}

function initGame() {
  const seed = getSeed();
  const wasCompleted = getCompletedForSeed(seed);
  state = {
    puzzle: null,
    picks: [],
    seed,
    golfPlayerIds: state.golfPlayerIds || {},
    easyMode: state.easyMode,
  };
  updatePageTitleAndHeader();
  if (!wasCompleted) hideAlreadyPlayedView();
  Promise.all([loadGolfPlayerIds(), loadData(state.easyMode), loadRankings(), loadTopPlayersAlltime()])
    .then(([, rows, rankMap, alltimeSet]) => {
      state.puzzle = buildPuzzle(rows, seed, rankMap, alltimeSet);
      if (wasCompleted) {
        const result = getStoredResult(seed);
        if (result) {
          state.picks = result.picks.slice();
          state.lastPercentile = result.lastPercentile;
          state.lastTotalPlayers = result.lastTotalPlayers;
          state.lastLeaderboard = result.lastLeaderboard || [];
          state.hasSubmittedForSeed = result.hasSubmittedForSeed || false;
        }
        renderGrid();
        updateScorebug();
        showAlreadyPlayedView(seed, result);
        return;
      }
      updateScorebug();
      renderGrid();
      if (!hasShownHowToThisSession) {
        showHowToModal();
        hasShownHowToThisSession = true;
      }
    })
    .catch((err) => {
      if (scorebugValue) scorebugValue.textContent = '—';
      grid.innerHTML = `<p class="load-error">${escapeHtml(err.message)}</p>`;
    });
}

initGame();
