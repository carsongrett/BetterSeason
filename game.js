/**
 * Better Season - Stat comparison game (NFL, NBA, MLB)
 * Modes: Unlimited, Daily, Blitz
 */

const SPORTS = {
  NFL: 'nfl',
  NBA: 'nba',
  MLB: 'mlb',
};

const AVAILABLE_SPORTS = ['nfl'];

const SPORT_LABELS = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB' };

const MODES = {
  UNLIMITED: 'unlimited',
  DAILY: 'daily',
  BLITZ: 'blitz',
};

const MODE_LABELS = {
  unlimited: 'Unlimited',
  daily: 'Daily',
  blitz: 'Blitz',
};

const MODE_DESCRIPTIONS = {
  unlimited: 'Daily game with new players each time.',
  daily: 'The classic. Resets at midnight.',
  blitz: '60 seconds. As many rounds as you can.',
};

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
};

function formatStatValue(val, stat) {
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
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

function getStatDisplayName(col, position) {
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

// Lower is better (only Int)
const LOWER_BETTER = new Set(['Int']);

function isBetter(valA, valB, statCol) {
  const a = parseFloat(valA);
  const b = parseFloat(valB);
  if (LOWER_BETTER.has(statCol)) return a < b;
  return a > b;
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const FILES = [
  'qb_2023', 'qb_2024', 'qb_2025',
  'rb_2023', 'rb_2024', 'rb_2025',
  'wr_2023', 'wr_2024', 'wr_2025',
  'te_2023', 'te_2024', 'te_2025',
];

async function loadData() {
  const all = {};
  for (const f of FILES) {
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
      if (!all[key]) all[key] = [];
      all[key].push(...rows);
    } catch (err) {
      console.error(`Failed to load ${f}.csv:`, err);
      throw new Error(`Could not load ${f}.csv: ${err.message}`);
    }
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

function pickStatsForRound(position, rng) {
  if (position === 'QB') return pickQBStats(rng);
  if (position === 'RB') return RB_STATS;
  return WR_TE_STATS;
}

function ydsColumn(position) {
  return 'Yds';
}

function getYdsRatio(playerA, playerB, pos) {
  const col = ydsColumn(pos);
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

function getYdsRatioThreshold(position) {
  return position === 'QB' ? 0.70 : 0.65;
}

function generateMatchup(pool, stats, usedKeys, rng, position, allowReuseWhenEmpty = false) {
  const list = pool.flat();
  const minRatio = getYdsRatioThreshold(position);
  let validPairs = [];

  function collectPairs(keys) {
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (sameTeamSeason(a, b)) continue;
        if (keys.has(playerKey(a)) || keys.has(playerKey(b))) continue;
        if (getYdsRatio(a, b, a.Pos) < minRatio) continue;
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

function getRound3Position(seed, rng, mode) {
  if (mode === MODES.DAILY) {
    return (new Date().getDate()) % 2 === 0 ? 'WR' : 'TE';
  }
  const h = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return h % 2 === 0 ? 'WR' : 'TE';
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
const shareGrid = document.getElementById('share-grid');
const copyBtn = document.getElementById('copy-btn');
const newGameBtn = document.getElementById('new-game-btn');
const resultsModeButtons = document.getElementById('results-mode-buttons');
const resultsSportToolbar = document.getElementById('results-sport-toolbar');
const howToBtn = document.getElementById('how-to-btn');
const howToModal = document.getElementById('how-to-modal');
const modalClose = document.getElementById('modal-close');

let state = {
  sport: 'nfl',
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
  if (mode === MODES.DAILY) return getTodaySeed();
  return Math.random().toString(36).slice(2, 12);
}

function hasPlayedDailyToday() {
  const today = new Date().toDateString();
  return localStorage.getItem('betterseason_lastDate') === today &&
    localStorage.getItem('betterseason_dailyScore') != null;
}

function getStoredDailyScore() {
  return localStorage.getItem('betterseason_dailyScore') || '0';
}

function storeDailyScore(score) {
  localStorage.setItem('betterseason_dailyScore', String(score));
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

  startScreen.classList.remove('active');
  roundScreen.classList.add('active');
  resultsScreen.classList.remove('active');
  blitzTimerEl.classList.remove('visible');

  if (mode === MODES.BLITZ) {
    state.blitzTimeLeft = 60;
    blitzTimerEl.classList.add('visible');
    startBlitzTimer();
    addBlitzRound();
    renderRound();
    return;
  }

  if (mode === MODES.DAILY && hasPlayedDailyToday()) {
    showDailyAlreadyPlayed();
    return;
  }

  const posOrder = ['QB', 'RB', getRound3Position(state.seed, state.rng, mode)];
  const usedKeys = new Set();

  for (let r = 0; r < 3; r++) {
    const pos = posOrder[r];
    const stats = pickStatsForRound(pos, state.rng);
    const pool = state.data[pos];
    const matchup = generateMatchup(pool, stats, usedKeys, state.rng, pos);
    if (!matchup) {
      if (!pool || pool.length < 2) continue;
      const a = pool[0], b = pool[1];
      usedKeys.add(playerKey(a));
      usedKeys.add(playerKey(b));
      const correct = stats.map(s => isBetter(a[s], b[s], s) ? 'A' : 'B');
      state.rounds.push({ position: pos, stats, playerA: a, playerB: b, correct });
    } else {
      const [a, b] = matchup;
      usedKeys.add(playerKey(a));
      usedKeys.add(playerKey(b));
      const correct = stats.map(s => isBetter(a[s], b[s], s) ? 'A' : 'B');
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
  const posOrder = ['QB', 'RB', 'WR', 'TE'];
  const roundIndex = state.rounds.length;
  const pos = posOrder[roundIndex % 4];
  const stats = pickStatsForRound(pos, state.rng);
  const pool = state.data[pos];
  const usedKeys = state.blitzUsedKeys.get(pos) || new Set();
  const matchup = generateMatchup(pool, stats, usedKeys, state.rng, pos, true);
  if (!matchup) return;
  const [a, b] = matchup;
  if (!state.blitzUsedKeys.has(pos)) state.blitzUsedKeys.set(pos, new Set());
  state.blitzUsedKeys.get(pos).add(playerKey(a));
  state.blitzUsedKeys.get(pos).add(playerKey(b));
  const correct = stats.map(s => isBetter(a[s], b[s], s) ? 'A' : 'B');
  state.rounds.push({ position: pos, stats, playerA: a, playerB: b, correct });
}

function endBlitz() {
  showResults();
}

function renderResultsModeButtons(justPlayedMode) {
  resultsModeButtons.innerHTML = '';
  const otherModes = [MODES.UNLIMITED, MODES.DAILY, MODES.BLITZ].filter(m => m !== justPlayedMode);
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
  const score = parseInt(getStoredDailyScore(), 10);
  resultsScore.textContent = `${score}/9`;
  resultsStreak.textContent = `Streak: ${getStreak()} day${getStreak() !== 1 ? 's' : ''}`;
  comeBackTomorrow.classList.add('visible');
  shareGrid.textContent = buildShareGridForMode('daily', score, null);
  renderResultsModeButtons(MODES.DAILY);
  renderResultsSportToolbar();
  copyBtn.onclick = () => {
    window.location.href = 'sms:?body=' + encodeURIComponent(buildShareGridForMode('daily', score, null));
  };
  newGameBtn.style.display = 'none';
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

  state.picks = [];
  statPicks.innerHTML = '';

  const nameA = getLastName(r.playerA);
  const nameB = getLastName(r.playerB);

  for (let i = 0; i < r.stats.length; i++) {
    const stat = r.stats[i];
    const label = getStatDisplayName(stat, r.position);
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

    const label = getStatDisplayName(stat, r.position);
    const valA = formatStatValue(r.playerA[stat], stat);
    const valB = formatStatValue(r.playerB[stat], stat);

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
  state.roundScores.push({ position: r.position, score: roundScore, total: 3 });

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
    if (state.mode === MODES.DAILY) {
      storeDailyScore(state.score);
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
  const key = 'betterseason_streak';
  const dateKey = 'betterseason_lastDate';
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

function getStreak() {
  return parseInt(localStorage.getItem('betterseason_streak') || '0', 10);
}

function buildShareGridForMode(mode, score, roundScores) {
  const modeStr = mode === 'daily' ? 'Daily' : mode === 'blitz' ? 'Blitz' : 'Unlimited';
  if (mode === 'blitz') {
    return `🏈 ${score} pts in blitz — betterseason `;
  }
  let grid = `🏈  ${score}/9pts — ${modeStr}\n\n`;
  if (roundScores && roundScores.length > 0) {
    roundScores.forEach(({ position, score: rs, total }) => {
      const correct = '✅'.repeat(rs);
      const wrong = '❌'.repeat(total - rs);
      grid += `${position}  ${correct}${wrong}  ${rs}/${total}\n`;
    });
  }
  return grid.trimEnd();
}

function buildShareGrid() {
  return buildShareGridForMode(state.mode, state.score, state.roundScores);
}

function showResults() {
  if (state.blitzTimerId) {
    clearInterval(state.blitzTimerId);
    state.blitzTimerId = null;
  }
  blitzTimerEl.classList.remove('visible');

  roundScreen.classList.remove('active');
  resultsScreen.classList.add('active');

  if (state.mode === MODES.BLITZ) {
    resultsScore.textContent = state.score + ' pts';
    resultsStreak.textContent = '';
  } else {
    resultsScore.textContent = `${state.score}/9`;
    resultsStreak.textContent = `Streak: ${getStreak()} day${getStreak() !== 1 ? 's' : ''}`;
  }

  comeBackTomorrow.classList.remove('visible');
  shareGrid.textContent = buildShareGrid();
  renderResultsModeButtons(state.mode);
  renderResultsSportToolbar();

  copyBtn.onclick = () => {
    window.location.href = 'sms:?body=' + encodeURIComponent(buildShareGrid());
  };

  newGameBtn.style.display = state.mode === MODES.DAILY ? 'none' : 'inline-flex';
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
  startScreen.classList.add('active');
  roundScreen.classList.remove('active');
  resultsScreen.classList.remove('active');
  updateStartScreen();
}

function updateStartScreen() {
  document.querySelectorAll('.sport-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.sport === state.sport);
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
      document.querySelectorAll('.sport-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
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
    if (state.mode === MODES.DAILY && hasPlayedDailyToday()) {
      showDailyAlreadyPlayed();
    } else {
      initGame(state.mode);
    }
  });
}

async function main() {
  try {
    setupHowToPlay();
    setupSportTabs();
    setupModeCards();
    setupStartBtn();
    state.data = await loadData();
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
