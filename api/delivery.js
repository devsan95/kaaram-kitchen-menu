// Delivery screen API (staff or rider login). Takeaway tickets only.
//   GET   ?v=<version>  tickets that are packed, on the road, or delivered in the last 30 min
//   PATCH { no, action: 'pickup' | 'delivered' | 'undo' }
const { canDeliver, deny, pipe, readBody } = require('./_lib');
const { NO_RE } = require('./_order');

const HASH = 'kaaram-orders', VER = 'kaaram-ver', KEEP_DELIVERED_MS = 30 * 60e3;

// Orders saved before takeaway and delivery were split carry an address under type 'takeaway'.
const isDel = t => t.type === 'delivery' || (t.type === 'takeaway' && t.customer && t.customer.address);
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const fail = (code, msg) => { res.statusCode = code; res.end(JSON.stringify({ error: msg })); };
  try {
    if (!canDeliver(req)) return deny(res);

    if (req.method === 'GET') {
      const [cur] = await pipe([['GET', VER]]);
      const v = String(cur || 0);
      if (new URL(req.url, 'http://x').searchParams.get('v') === v) return res.end(JSON.stringify({ v, same: true }));
      const [flat] = await pipe([['HGETALL', HASH]]);
      const now = Date.now(), tickets = [];
      for (let i = 0; i < flat.length; i += 2) {
        let t; try { t = JSON.parse(flat[i + 1]); } catch (e) { continue; }
        if (!isDel(t) || t.st < 2) continue;
        if (t.delivered && now - t.delivered > KEEP_DELIVERED_MS) continue;
        tickets.push({ no: t.no, at: t.at, eta: t.eta, lines: t.lines, note: t.note, total: t.total, pay: t.pay || null, customer: t.customer, st: t.st, ts: t.ts, delivered: t.delivered || 0, type: 'delivery', table: 'DL' });
      }
      tickets.sort((a, b) => a.at - b.at);
      return res.end(JSON.stringify({ v, tickets }));
    }

    if (req.method === 'PATCH') {
      let b; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) { return fail(400, 'bad json'); }
      if (!b || !NO_RE.test(b.no || '') || !['pickup', 'delivered', 'undo'].includes(b.action)) return fail(400, 'invalid');
      const [raw] = await pipe([['HGET', HASH, b.no]]);
      if (!raw) return fail(404, 'no such ticket');
      const t = JSON.parse(raw);
      if (!isDel(t)) return fail(400, 'not a delivery order');
      const now = Date.now();
      if (b.action === 'pickup') {
        if (t.st < 2) return fail(409, 'not packed yet');
        if (t.st === 2) { t.st = 3; t.ts[3] = now; }
      } else if (b.action === 'delivered') {
        if (t.st < 2) return fail(409, 'not packed yet');
        if (t.st === 2) { t.st = 3; t.ts[3] = now; }
        if (!t.delivered) { t.delivered = now; t.ts[4] = now; }
      } else if (t.delivered) { delete t.delivered; t.ts.length = 4; }
      else if (t.st === 3) { t.st = 2; t.ts.length = 3; }
      t.kitchen = true;
      await pipe([['HSET', HASH, b.no, JSON.stringify(t)], ['INCR', VER]]);
      return res.end(JSON.stringify({ ok: true }));
    }

    res.setHeader('Allow', 'GET, PATCH');
    return fail(405, 'method');
  } catch (e) {
    if (e.code === 'NO_STORAGE') return fail(503, 'storage not configured');
    if (e.code === 'BIG') return fail(413, 'too large');
    return fail(500, 'server error');
  }
};
