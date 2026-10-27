// Shared kitchen feed.
//   POST  (public)  place an order            -> { no, at }
//   GET   (public)  ?nos=OD-1,OD-2  status of those orders only
//   GET   (staff)   every open ticket
//   PATCH (staff)   { no, st }  move a ticket (0 new, 1 cooking, 2 ready, 3 served)
const { isAuthed, deny, pipe, clientIp, readBody } = require('./_lib');

const { NO_RE, PREFIX, HASH, SEQ, VER, MAX_OPEN, RATE_PER_MIN, cleanOrder, loadAll } = require('./_order');

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
      if (open > MAX_OPEN && (await loadAll()).length > MAX_OPEN) return fail(503, 'kitchen is full');
      const at = Date.now(), no = (PREFIX.length >= 2 ? PREFIX : 'OD') + '-' + (2416 + seq);
      const t = { no, table: o.table, type: o.type, customer: o.customer, at, eta: o.eta, lines: o.lines, note: o.note, st: 0, ts: [at], kitchen: true, sample: false, total: o.total, pay: { mode: 'cash' } };
      await pipe([['HSET', HASH, no, JSON.stringify(t)], ['INCR', VER]]);
      return res.end(JSON.stringify({ no, at }));
    }

    if (req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.has('nos')) {                       // guest: only the orders they name, status only
        const nos = q.get('nos').split(',').map((x) => x.trim()).filter((x) => NO_RE.test(x)).slice(0, 20);
        if (!nos.length) return res.end('[]');
        const [rows] = await pipe([['HMGET', HASH, ...nos]]);
        return res.end(JSON.stringify(nos.map((no, i) => {
          const t = rows[i] && JSON.parse(rows[i]);
          return t ? { no, st: t.st, ts: t.ts, dl: t.delivered || 0 } : { no, st: 3, ts: [], dl: 1, gone: true };
        })));
      }
      if (!isAuthed(req)) return deny(res);     // staff: the full feed, or just "unchanged" if their version is current
      const [cur] = await pipe([['GET', VER]]);
      const v = String(cur || 0);
      if (q.get('v') === v) return res.end(JSON.stringify({ v, same: true }));
      const tickets = await loadAll();
      tickets.sort((a, b) => a.at - b.at);
      return res.end(JSON.stringify({ v, tickets }));
    }

    if (req.method === 'PATCH') {
      if (!isAuthed(req)) return deny(res);
      let b; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) { return fail(400, 'bad json'); }
      if (!b || !NO_RE.test(b.no || '') || ![0, 1, 2, 3].includes(b.st)) return fail(400, 'invalid');
      const [raw] = await pipe([['HGET', HASH, b.no]]);
      if (!raw) return fail(404, 'no such ticket');
      const t = JSON.parse(raw);
      if (b.st > t.st) t.ts[b.st] = Date.now(); else if (b.st < t.st) t.ts.length = b.st + 1;
      t.st = b.st; t.kitchen = true;
      if (b.st < 3) delete t.delivered;          // moving a ticket back un-delivers it
      await pipe([['HSET', HASH, b.no, JSON.stringify(t)], ['INCR', VER]]);
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
