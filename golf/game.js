/**
 * Pick the Round — Golf game
 * 4 golfers × 3 cards (events). Tap a card → flip → score locks in. Total = sum of 4 picks.
 * Data: golf_results.csv (player_name, event_name, year, score_to_par, position)
 */

const PAR_4_ROUNDS = 288; // 4 × 72
const GOLFERS_PER_GAME = 4;
const CARDS_PER_GOLFER = 3;
const DATA_URL = 'data/golf_results.csv';
const GOLF_PLAYER_IDS_URL = 'data/golf-player-ids.json';
const RANKINGS_CSV_URL = 'data/downloaded_rankings.csv';
// Weight by rank: top 20 = 5, 21–50 = 4, 51–100 = 3, 101+ or not on list = 1
const RANK_WEIGHT_TOP_20 = 5;
const RANK_WEIGHT_TOP_50 = 4;
const RANK_WEIGHT_TOP_100 = 3;
const RANK_WEIGHT_DEFAULT = 1;
const GOLF_HEADSHOT_URL = 'https://a.espncdn.com/i/headshots/golf/players/full';
const GOLF_SHARE_URL = 'https://betterseason.live';
const GOLF_SHARE_HANDLE = '@BetterSznGame';
const GOLF_SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GOLF_HEADSHOT_FALLBACK_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" fill="%234a5568"><ellipse cx="50" cy="38" rx="22" ry="26"/><path d="M15 120c0-22 15-40 35-40s35 18 35 40z"/></svg>'
);

// Year range for this mode (CSV is unchanged; filter in memory so other modes can use full data)
const MIN_YEAR = 2020;
const MAX_YEAR = 2025;

// Only use results where the player made the cut (exclude CUT, WD, DQ, MDF)
const EXCLUDED_POSITIONS = new Set(['cut', 'wd', 'dq', 'mdf']);

// Easy mode: only these four majors (exact event_name match in CSV)
const MAJOR_EVENT_NAMES = new Set([
  'Masters Tournament',
  'PGA Championship',
  'U.S. Open',
  'The Open',
]);

// Seeded RNG for repeatable puzzles (use date string later for daily)
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

function buildPuzzle(rows, seed, rankMap) {
  const rng = mulberry32(seed);
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_name)) byPlayer.set(r.player_name, []);
    byPlayer.get(r.player_name).push(r);
  }
  const playersWithEnough = [...byPlayer.entries()].filter(
    ([, events]) => events.length >= CARDS_PER_GOLFER
  );
  if (playersWithEnough.length < GOLFERS_PER_GAME) {
    throw new Error(
      `Need at least ${GOLFERS_PER_GAME} golfers with ${CARDS_PER_GOLFER}+ events. Found ${playersWithEnough.length}.`
    );
  }
  const getWeight = (playerName) => {
    if (!rankMap || !rankMap.size) return RANK_WEIGHT_DEFAULT;
    const rank = rankMap.get(normalizeForMatch(playerName));
    if (rank == null) return RANK_WEIGHT_DEFAULT;
    if (rank <= 20) return RANK_WEIGHT_TOP_20;
    if (rank <= 50) return RANK_WEIGHT_TOP_50;
    if (rank <= 100) return RANK_WEIGHT_TOP_100;
    return RANK_WEIGHT_DEFAULT;
  };
  const selected = [];
  let pool = playersWithEnough.map((entry) => ({ entry, weight: getWeight(entry[0]) }));
  for (let k = 0; k < GOLFERS_PER_GAME && pool.length > 0; k++) {
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
  const puzzle = selected.map(([player, events]) => {
    const picked = shuffleWithRng(events, rng).slice(0, CARDS_PER_GOLFER);
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
const playAgainBtn = document.getElementById('play-again-btn');
const scorebugEl = document.getElementById('scorebug');
const scorebugValue = document.getElementById('scorebug-value');
const scorebugPlayAgain = document.getElementById('scorebug-play-again');
const howToModal = document.getElementById('how-to-modal');
const howToModalBackdrop = document.getElementById('how-to-modal-backdrop');
const howToModalClose = document.getElementById('how-to-modal-close');
const howToModalBtn = document.getElementById('how-to-modal-btn');
const golfShareGrid = document.getElementById('golf-share-grid');
const golfShareNativeBtn = document.getElementById('golf-share-native-btn');
const golfShareSmsBtn = document.getElementById('golf-share-sms-btn');
const golfShareXBtn = document.getElementById('golf-share-x-btn');
const modeToggle = document.getElementById('mode-toggle');
const modeToggleLabel = document.getElementById('mode-toggle-label');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const howToDetailModal = document.getElementById('how-to-detail-modal');
const howToDetailModalBackdrop = document.getElementById('how-to-detail-modal-backdrop');
const howToDetailModalClose = document.getElementById('how-to-detail-modal-close');

let state = {
  puzzle: null,
  picks: [], // one score_to_par per row (index = row)
  seed: 0,
  golfPlayerIds: {}, // name -> ESPN id for headshots
  easyMode: false, // false = normal (all events), true = majors only
};
let hasShownHowToThisSession = false;

function normalizeNameForLookup(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
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

function getSeed() {
  return Date.now();
}

function formatScore(n) {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

/** Normalize event name for display: strip year prefix, strip "World Golf Championships-", fix capitalization. */
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

/** Card background: 3 shades of green, 3 of yellow, 3 of red. Discrete bands only. */
function getScoreBackgroundColor(scoreToPar) {
  const greenShades = ['hsl(152, 42%, 52%)', 'hsl(152, 38%, 58%)', 'hsl(152, 35%, 64%)'];
  const yellowShades = ['hsl(48, 52%, 62%)', 'hsl(48, 48%, 68%)', 'hsl(48, 44%, 74%)'];
  const redShades = ['hsl(0, 48%, 58%)', 'hsl(0, 52%, 54%)', 'hsl(0, 55%, 50%)'];

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
    showResults();
  }
}

function updateScorebug() {
  if (!scorebugEl || !scorebugValue) return;
  const defined = state.picks.filter((p) => p !== undefined);
  scorebugEl.classList.remove('scorebug--under', 'scorebug--over', 'scorebug--even');
  if (scorebugPlayAgain) {
    scorebugPlayAgain.classList.toggle('hidden', defined.length !== 4);
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
  const d = new Date();
  return `${GOLF_SHARE_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function buildGolfShareText(total, forSms) {
  const dateStr = getGolfShareDateStr();
  const scoreStr = formatScore(total);
  const top = `Best Ball (${dateStr}):\n${scoreStr} ⛳`;
  const urlPart = GOLF_SHARE_URL ? `\n\n${GOLF_SHARE_URL}` : '';
  if (forSms) return top + urlPart;
  const handlePart = GOLF_SHARE_HANDLE ? `\n\n${GOLF_SHARE_HANDLE}\n${GOLF_SHARE_URL}` : urlPart;
  return top + handlePart;
}

function setupGolfShareButtons(shareTextX, shareTextSms) {
  const hasWebShare = typeof navigator !== 'undefined' && navigator.share;
  if (golfShareNativeBtn) {
    if (hasWebShare) {
      golfShareNativeBtn.classList.remove('hidden');
      golfShareNativeBtn.onclick = async () => {
        try {
          await navigator.share({
            text: shareTextX,
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
  if (golfShareXBtn) {
    golfShareXBtn.classList.toggle('hidden', !!hasWebShare);
    golfShareXBtn.onclick = () => { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareTextX)); };
  }
}

function showResults() {
  const total = state.picks.reduce((a, b) => a + b, 0);
  finalTotal.textContent = formatScore(total);
  const shareTextX = buildGolfShareText(total, false);
  const shareTextSms = buildGolfShareText(total, true);
  if (golfShareGrid) golfShareGrid.textContent = shareTextX;
  setupGolfShareButtons(shareTextX, shareTextSms);
  if (resultsModal) resultsModal.classList.remove('hidden');
  playAgainBtn.focus();
}

function closeResultsModal() {
  if (resultsModal) resultsModal.classList.add('hidden');
}

if (resultsModalClose) resultsModalClose.addEventListener('click', closeResultsModal);
if (resultsModalBackdrop) resultsModalBackdrop.addEventListener('click', closeResultsModal);

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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && howToDetailModal && !howToDetailModal.classList.contains('hidden')) {
    closeHowToDetailModal();
  }
});

function handlePlayAgain() {
  closeResultsModal();
  initGame();
}

playAgainBtn.addEventListener('click', handlePlayAgain);
if (scorebugPlayAgain) scorebugPlayAgain.addEventListener('click', handlePlayAgain);

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

function updateModeToggleUI() {
  if (modeToggle) {
    modeToggle.classList.toggle('mode-toggle--majors', state.easyMode);
    modeToggle.setAttribute('aria-checked', state.easyMode ? 'true' : 'false');
  }
  if (modeToggleLabel) {
    modeToggleLabel.textContent = state.easyMode ? 'Majors' : 'Normal';
  }
}

function initGame() {
  const seed = getSeed();
  state = {
    puzzle: null,
    picks: [],
    seed,
    golfPlayerIds: state.golfPlayerIds || {},
    easyMode: state.easyMode,
  };
  updateModeToggleUI();
  Promise.all([loadGolfPlayerIds(), loadData(state.easyMode), loadRankings()])
    .then(([, rows, rankMap]) => {
      state.puzzle = buildPuzzle(rows, seed, rankMap);
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

if (modeToggle) {
  modeToggle.addEventListener('click', () => {
    state.easyMode = !state.easyMode;
    initGame();
  });
}

initGame();
