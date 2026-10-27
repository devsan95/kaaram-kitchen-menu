// Online payments with Razorpay. The order only reaches the kitchen after the payment is confirmed.
//   POST { action:'create', ...order }              -> { orderId, keyId, amount, total }   (creates a Razorpay order, holds the order for 1 h)
//   POST { action:'verify', razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { no, at, total }
//   POST ?action=webhook   Razorpay webhook (payment.captured / order.paid): places the order if the guest's page never called verify
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, optional RAZORPAY_WEBHOOK_SECRET.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipe, redis, clientIp, loadMenu, readBody } = require('./_lib');
const { HASH, VER, MAX_OPEN, cleanOrder, loadAll, placeTicket, num } = require('./_order');

const PEND = 'kaaram-pend:', PAID = 'kaaram-paid:';
const keyId = () => process.env.RAZORPAY_KEY_ID || '', keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
const enabled = () => !!(keyId() && keySecret());
const GST = 0.05;

// Prices come from the published menu (or the menu built into the page), never from the guest's phone.
async function menuItems() {
  let m = null;
  try { const v = await loadMenu(); if (v) m = JSON.parse(v); } catch (e) { if (e.code !== 'NO_STORAGE') throw e; }
  if (!m || !Array.isArray(m.items)) {
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    const x = /<script type="application\/json" id="menu-data">([\s\S]*?)<\/script>/.exec(html);
    m = x ? JSON.parse(x[1]) : { items: [] };
  }
  return Object.fromEntries(m.items.map((i) => [i.id, i]));
}
// Option groups per dish type (prices only). KEEP IN SYNC with OPTS in public/index.html. radio = one choice, check = any subset.
const OPT_PRICES = {
  starter: [['radio', [0, 0, 0]]],
  dosa: [['check', [30, 20, 25, 40]]],
  biryani: [['radio', [0, 380]], ['radio', [0, 0, 0]], ['check', [40, 30, 50]]],
  curry: [['radio', [0, 0, 0]], ['check', [90, 60, 50]]],
  drink: [['radio', [0, 0, 0]]],
  lime: [['radio', [0, 0, 0]]],
};
function addOnSums(key) {
  let sums = new Set([0]);
  for (const [type, prices] of OPT_PRICES[key] || []) {
    const next = new Set();
    for (const base of sums) {
      if (type === 'radio') prices.forEach((p) => next.add(base + p));
      else for (let m = 0; m < 1 << prices.length; m++) next.add(base + prices.reduce((t, p, i) => t + (m & (1 << i) ? p : 0), 0));
    }
    sums = next;
  }
  return sums;
}
// Each line must be a real dish that is on sale, priced at its base price plus a possible combination of its options.
function priced(o, byId, tipIn) {
  let sub = 0;
  const lines = [];
  for (const l of o.lines) {
    const it = byId[l.id];
    if (!it || it.off || !(it.p >= 0)) return null;
    if (!addOnSums(it.o).has(l.unit - it.p)) return null;
    lines.push({ ...l, name: String(it.name).slice(0, 80), v: !!it.v });
    sub += l.qty * l.unit;
  }
  const tip = Math.round(num(tipIn, 0, Math.min(1000, sub)));
  return { ...o, lines, total: Math.round(sub * (1 + GST) + tip) };
}
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Turns a paid Razorpay order into a ticket exactly once, however many times verify or the webhook call it.
async function settle(orderId, paymentId) {
  const [claim] = await pipe([['SET', PAID + orderId, 'x', 'NX', 'EX', 86400]]);
  if (claim !== 'OK') {
    for (let i = 0; i < 8; i++) {
      const v = await redis(['GET', PAID + orderId]);
      if (v && v !== 'x') return JSON.parse(v);
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }
  try {
    const raw = await redis(['GET', PEND + orderId]);
    if (!raw) { await redis(['DEL', PAID + orderId]); return null; }
    const o = JSON.parse(raw);
    const r = await placeTicket(o, { pay: { mode: 'online', id: String(paymentId).slice(0, 40), at: Date.now() } });
    const out = { ...r, total: o.total };
    await pipe([['SET', PAID + orderId, JSON.stringify(out), 'EX', 86400], ['DEL', PEND + orderId]]);
    return out;
  } catch (e) { await redis(['DEL', PAID + orderId]).catch(() => {}); throw e; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const fail = (code, msg) => { res.statusCode = code; res.end(JSON.stringify({ error: msg })); };
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'method'); }
    if (!enabled()) return fail(503, 'online payments are not set up');
    const raw = await readBody(req, 64 * 1024);
    const action = new URL(req.url, 'http://x').searchParams.get('action');

    if (action === 'webhook') {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret || !same(req.headers['x-razorpay-signature'] || '', sign(raw, secret))) return fail(400, 'bad signature');
      const ev = JSON.parse(raw);
      const p = ev && ev.payload && ev.payload.payment && ev.payload.payment.entity;
      if (!['payment.captured', 'order.paid'].includes(ev.event) || !p || !p.order_id || p.status !== 'captured') return res.end('{"ok":true}');
      const pend = await redis(['GET', PEND + p.order_id]);
      if (pend && JSON.parse(pend).total * 100 !== p.amount) return fail(400, 'amount mismatch');
      await settle(p.order_id, p.id);
      return res.end('{"ok":true}');
    }

    let b; try { b = JSON.parse(raw); } catch (e) { return fail(400, 'bad json'); }

    if (b.action === 'create') {
      const o0 = cleanOrder(b);
      if (!o0) return fail(400, 'invalid order');
      const o = priced(o0, await menuItems(), b.tip);
      if (!o || o.total < 1) return fail(400, 'invalid order');
      const rl = 'kaaram-rlp:' + clientIp(req) + ':' + Math.floor(Date.now() / 60000);
      const [hits, , open] = await pipe([['INCR', rl], ['EXPIRE', rl, 120], ['HLEN', HASH]]);
      if (hits > 10) return fail(429, 'slow down');
      if (open > MAX_OPEN && (await loadAll()).length > MAX_OPEN) return fail(503, 'kitchen is full');
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(keyId() + ':' + keySecret()).toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: o.total * 100, currency: 'INR', receipt: 'kk-' + Date.now().toString(36), notes: { type: o.type, table: o.table } }),
      });
      if (!r.ok) return fail(502, 'payment provider error');
      const ro = await r.json();
      if (!ro.id) return fail(502, 'payment provider error');
      await pipe([['SET', PEND + ro.id, JSON.stringify(o), 'EX', 3600]]);
      return res.end(JSON.stringify({ orderId: ro.id, keyId: keyId(), amount: o.total * 100, total: o.total }));
    }

    if (b.action === 'verify') {
      const oid = String(b.razorpay_order_id || ''), pid = String(b.razorpay_payment_id || ''), sig = String(b.razorpay_signature || '');
      if (!/^order_\w{6,40}$/.test(oid) || !/^pay_\w{6,40}$/.test(pid) || !same(sig, sign(oid + '|' + pid, keySecret()))) return fail(400, 'payment could not be verified');
      const r = await settle(oid, pid);
      if (!r) return fail(409, 'order expired');
      return res.end(JSON.stringify(r));
    }
    return fail(400, 'bad action');
  } catch (e) {
    if (e.code === 'NO_STORAGE') return fail(503, 'storage not configured');
    if (e.code === 'BIG') return fail(413, 'too large');
    return fail(500, 'server error');
  }
};
