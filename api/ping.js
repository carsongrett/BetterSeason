const { corsHeaders } = require('./lib/cors');

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const h = corsHeaders(origin);
  Object.entries(h).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, message: 'pong' }));
};
