const { corsHeaders } = require('./lib/cors');
const { getRedis, statsKey } = require('./lib/redis');

function todayUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function setCors(res, origin) {
  const h = corsHeaders(origin);
  Object.entries(h).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');
}

function send(res, status, body, origin) {
  setCors(res, origin);
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';

  try {
    if (req.method === 'OPTIONS') {
      setCors(res, origin);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed' }, origin);
      return;
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      send(res, 400, { error: 'Invalid JSON' }, origin);
      return;
    }

    const { sport, mode, score } = body;
    if (!sport || !mode || typeof score !== 'number') {
      send(res, 400, { error: 'Missing sport, mode, or score' }, origin);
      return;
    }

    const allowedSports = ['nfl', 'nba', 'mlb'];
    if (!allowedSports.includes(sport)) {
      send(res, 400, { error: 'Invalid sport' }, origin);
      return;
    }

    const date = todayUTC();
    const key = statsKey(date, sport, mode);

    const redis = await getRedis();
    const raw = await redis.get(key);
    const data = raw ? { gamesPlayed: raw.gamesPlayed || 0, totalScore: raw.totalScore || 0 } : { gamesPlayed: 0, totalScore: 0 };
    data.gamesPlayed += 1;
    data.totalScore += score;
    await redis.set(key, data);
    send(res, 200, { ok: true }, origin);
  } catch (err) {
    console.error('play error', err);
    send(res, 500, { error: 'Failed to record play' }, origin);
  }
};
