// Shared kitchen feed.
//   POST  (public)  place an order            -> { no, at }
//   GET   (public)  ?nos=KK-1,KK-2  status of those orders only
//   GET   (staff)   every open ticket
//   PATCH (staff)   { no, st }  move a ticket (0 new, 1 cooking, 2 ready, 3 served)
const { isAuthed, deny, pipe, clientIp, readBody } = require('./_lib');

const HASH = 'kaaram-orders', SEQ = 'kaaram-seq';
const KEEP_SERVED_MS = 3 * 3600e3, MAX_OPEN = 300, RATE_PER_MIN = 12;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };

function cleanOrder(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 40) return null;
  const table = String(b.table || '');
  if (!/^\d{1,2}$/.test(table)) return null;
  const lines = [];
  for (const l of b.lines) {
    if (!l || typeof l !== 'object') return null;
    const name = str(l.name, 80);
    if (!name) return null;
    lines.push({
      id: str(l.id, 40), name, qty: Math.round(num(l.qty, 1, 50)), unit: num(l.unit, 0, 100000),
      opt: str(l.opt, 200), note: str(l.note, 200), v: !!l.v,
    });
  }
  return {
    table: table.padStart(2, '0'), lines, note: str(b.note, 300),
    total: Math.round(num(b.total, 0, 1e7)), eta: Math.round(num(b.eta, 5, 180)),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const fail = (code, msg) => { res.statusCode = code; res.end(JSON.stringify({ error: msg })); };
  try {
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch (e) { return fail(400, 'bad json'); }
      const o = cleanOrder(body);
      if (!o) return fail(400, 'invalid order');
      const minute = Math.floor(Date.now() / 60000);
      const rl = 'kaaram-rl:' + clientIp(req) + ':' + minute;
      const [hits, , open, seq] = await pipe([['INCR', rl], ['EXPIRE', rl, 120], ['HLEN', HASH], ['INCR', SEQ]]);
      if (hits > RATE_PER_MIN) return fail(429, 'slow down');
      if (open > MAX_OPEN) return fail(503, 'kitchen is full');
      const at = Date.now(), no = 'KK-' + (2416 + seq);
      const t = { no, table: o.table, at, eta: o.eta, lines: o.lines, note: o.note, st: 0, ts: [at], kitchen: true, sample: false, total: o.total };
      await pipe([['HSET', HASH, no, JSON.stringify(t)]]);
      return res.end(JSON.stringify({ no, at }));
    }

    if (req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.has('nos')) {                       // guest: only the orders they name, status only
        const nos = q.get('nos').split(',').map((x) => x.trim()).filter((x) => /^KK-\d{1,9}$/.test(x)).slice(0, 20);
        if (!nos.length) return res.end('[]');
        const [rows] = await pipe([['HMGET', HASH, ...nos]]);
        return res.end(JSON.stringify(nos.map((no, i) => {
          const t = rows[i] && JSON.parse(rows[i]);
          return t ? { no, st: t.st, ts: t.ts } : { no, st: 3, ts: [], gone: true };
        })));
      }
      if (!isAuthed(req)) return deny(res);     // staff: the full feed
      const [flat] = await pipe([['HGETALL', HASH]]);
      const now = Date.now(), list = [], stale = [];
      for (let i = 0; i < flat.length; i += 2) {
        let t; try { t = JSON.parse(flat[i + 1]); } catch (e) { stale.push(flat[i]); continue; }
        if (t.st === 3 && now - (t.ts[3] || t.at) > KEEP_SERVED_MS) stale.push(flat[i]); else list.push(t);
      }
      if (stale.length) pipe([['HDEL', HASH, ...stale]]).catch(() => {});
      list.sort((a, b) => a.at - b.at);
      return res.end(JSON.stringify(list));
    }

    if (req.method === 'PATCH') {
      if (!isAuthed(req)) return deny(res);
      let b; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) { return fail(400, 'bad json'); }
      if (!b || !/^KK-\d{1,9}$/.test(b.no || '') || ![0, 1, 2, 3].includes(b.st)) return fail(400, 'invalid');
      const [raw] = await pipe([['HGET', HASH, b.no]]);
      if (!raw) return fail(404, 'no such ticket');
      const t = JSON.parse(raw);
      if (b.st > t.st) t.ts[b.st] = Date.now(); else if (b.st < t.st) t.ts.length = b.st + 1;
      t.st = b.st; t.kitchen = true;
      await pipe([['HSET', HASH, b.no, JSON.stringify(t)]]);
      return res.end(JSON.stringify({ ok: true }));
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return fail(405, 'method');
  } catch (e) {
    if (e.code === 'NO_STORAGE') return fail(503, 'storage not configured');
    if (e.code === 'BIG') return fail(413, 'too large');
    return fail(500, 'server error');
  }
};
