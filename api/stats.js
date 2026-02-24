const { corsHeaders } = require('./lib/cors');
const { getRedis, statsKey } = require('./lib/redis');

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

    if (req.method !== 'GET') {
      send(res, 405, { error: 'Method not allowed' }, origin);
      return;
    }

    const date = req.query?.date || new Date().toISOString().slice(0, 10);
    const sport = req.query?.sport || '';
    const mode = req.query?.mode || '';

    if (!sport || !mode) {
      send(res, 200, { gamesPlayed: 0, averageScore: null }, origin);
      return;
    }

    const redis = await getRedis();
    const key = statsKey(date, sport, mode);
    const data = await redis.get(key);
    const gamesPlayed = data?.gamesPlayed || 0;
    const totalScore = data?.totalScore || 0;
    const averageScore = gamesPlayed > 0 ? Math.round((totalScore / gamesPlayed) * 10) / 10 : null;
    send(res, 200, { date, sport, mode, gamesPlayed, averageScore }, origin);
  } catch (err) {
    console.error('stats error', err);
    send(res, 500, { error: 'Failed to fetch stats' }, origin);
  }
};
