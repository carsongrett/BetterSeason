/**
 * Pick the Round — Golf game
 * 4 golfers × 4 cards (events). Tap a card → flip → score locks in. Total = sum of 4 picks.
 * Data: golf_results.csv (player_name, event_name, year, score_to_par, position)
 */

const PAR_4_ROUNDS = 288; // 4 × 72
const GOLFERS_PER_GAME = 4;
const CARDS_PER_GOLFER = 4;
const DATA_URL = 'data/golf_results.csv';

// Year range for this mode (CSV is unchanged; filter in memory so other modes can use full data)
const MIN_YEAR = 2020;
const MAX_YEAR = 2025;

// Only use results where the player made the cut (exclude CUT, WD, DQ, MDF)
const EXCLUDED_POSITIONS = new Set(['cut', 'wd', 'dq', 'mdf']);

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

function loadData() {
  return fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${DATA_URL}: ${r.status}`);
      return r.text();
    })
    .then(parseCSV)
    .then((rows) => {
      return rows
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
    });
}

function buildPuzzle(rows, seed) {
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
  const shuffled = shuffleWithRng(playersWithEnough, rng);
  const selected = shuffled.slice(0, GOLFERS_PER_GAME);
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
const vsPar = document.getElementById('vs-par');
const playAgainBtn = document.getElementById('play-again-btn');
const scorebugEl = document.getElementById('scorebug');
const scorebugValue = document.getElementById('scorebug-value');
const scorebugPlayAgain = document.getElementById('scorebug-play-again');

let state = {
  puzzle: null,
  picks: [], // one score_to_par per row (index = row)
  seed: 0,
};

function getSeed() {
  return Date.now();
}

function formatScore(n) {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
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
  state.puzzle.forEach((golfer, rowIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'grid-row';
    rowEl.setAttribute('role', 'row');
    const nameCell = document.createElement('div');
    nameCell.className = 'golfer-name';
    nameCell.textContent = golfer.player_name;
    rowEl.appendChild(nameCell);
    golfer.cards.forEach((card, colIndex) => {
      const picked = state.picks[rowIndex] !== undefined;
      const isThisPicked = picked && state.picks[rowIndex] === card.score_to_par;
      const cardEl = document.createElement('div');
      cardEl.className = 'card' + (picked ? ' flipped' : '') + (isThisPicked ? ' picked' : '');
      cardEl.setAttribute('role', 'gridcell');
      cardEl.dataset.row = rowIndex;
      cardEl.dataset.col = colIndex;
      const scoreBg = getScoreBackgroundColor(card.score_to_par);
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-front">
            <span class="event-name">${escapeHtml(card.event_name)}</span>
            <span class="event-year">${card.year}</span>
          </div>
          <div class="card-back" style="--score-bg: ${scoreBg}">
            <span class="card-back-event">${escapeHtml(card.event_name)} ${card.year}</span>
            <span class="score">${formatScore(card.score_to_par)}</span>
            <span class="pick-label">Your pick</span>
          </div>
        </div>
      `;
      if (!picked) {
        cardEl.addEventListener('click', () => pickCard(rowIndex, card.score_to_par, cardEl));
      }
      rowEl.appendChild(cardEl);
    });
    if (state.picks[rowIndex] !== undefined) rowEl.classList.add('row-picked');
    grid.appendChild(rowEl);
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function pickCard(rowIndex, scoreToPar, cardEl) {
  if (state.picks[rowIndex] !== undefined) return;
  state.picks[rowIndex] = scoreToPar;
  cardEl.classList.add('picked', 'flipped');
  const row = cardEl.closest('.grid-row');
  row.classList.add('row-picked');
  row.querySelectorAll('.card').forEach((c) => c.classList.add('flipped'));
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

function showResults() {
  const total = state.picks.reduce((a, b) => a + b, 0);
  finalTotal.textContent = formatScore(total);
  vsPar.textContent = `Sum of your 4 picks (vs par 288 for 4 rounds)`;
  if (resultsModal) resultsModal.classList.remove('hidden');
  playAgainBtn.focus();
}

function closeResultsModal() {
  if (resultsModal) resultsModal.classList.add('hidden');
}

if (resultsModalClose) resultsModalClose.addEventListener('click', closeResultsModal);
if (resultsModalBackdrop) resultsModalBackdrop.addEventListener('click', closeResultsModal);

function handlePlayAgain() {
  closeResultsModal();
  initGame();
}

playAgainBtn.addEventListener('click', handlePlayAgain);
if (scorebugPlayAgain) scorebugPlayAgain.addEventListener('click', handlePlayAgain);

function initGame() {
  const seed = getSeed();
  state = { puzzle: null, picks: [], seed };
  loadData()
    .then((rows) => {
      state.puzzle = buildPuzzle(rows, seed);
      updateScorebug();
      renderGrid();
    })
    .catch((err) => {
      if (scorebugValue) scorebugValue.textContent = '—';
      grid.innerHTML = `<p class="load-error">${escapeHtml(err.message)}</p>`;
    });
}

initGame();
