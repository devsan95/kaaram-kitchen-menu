// Shared order helpers: validation of incoming orders and creation of tickets (used by orders.js and pay.js).
const { pipe } = require('./_lib');

const HASH = 'kaaram-orders', SEQ = 'kaaram-seq', VER = 'kaaram-ver';  // VER changes on every write, so tablets can ask "anything new?" cheaply
const KEEP_SERVED_MS = 3 * 3600e3, KEEP_ANY_MS = 12 * 3600e3, MAX_OPEN = 500, RATE_PER_MIN = 12;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n) : '');
const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };

function cleanPhone(v) {
  const d = str(v, 30).replace(/[\s\-().]/g, '');
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(d);
  if (m) return '+91' + m[1];
  return /^\+\d{8,15}$/.test(d) ? d : '';
}
// Only Google Maps links (or plain lat,lng) are accepted, always rebuilt as https URLs.
function cleanMap(v) {
  v = str(v, 500).trim();
  const c = /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(v);
  if (c) return Math.abs(+c[1]) <= 90 && Math.abs(+c[2]) <= 180 ? 'https://www.google.com/maps?q=' + +c[1] + ',' + +c[2] : '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return '';
    const h = u.hostname.toLowerCase();
    if (/^(www\.)?google\.(com|co\.in)$/.test(h) && u.pathname.startsWith('/maps')) return u.href;
    if (h === 'maps.google.com' || h === 'maps.app.goo.gl' || (h === 'goo.gl' && u.pathname.startsWith('/maps'))) return u.href;
  } catch (e) { /* not a URL */ }
  return '';
}
// Takeaway (collect in person) needs a name and phone; delivery also needs an address and a Google Maps location.
function cleanPickup(c) {
  if (!c || typeof c !== 'object') return null;
  const name = str(c.name, 60).trim(), phone = cleanPhone(c.phone);
  return name.length >= 2 && phone ? { name, phone } : null;
}
function cleanCustomer(c) {
  if (!c || typeof c !== 'object') return null;
  const name = str(c.name, 60).trim(), address = str(c.address, 300).trim(), phone = cleanPhone(c.phone), map = cleanMap(c.map);
  return name.length >= 2 && address.length >= 10 && phone && map ? { name, phone, address, map } : null;
}

function cleanOrder(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 40) return null;
  const type = b.type === 'takeaway' || b.type === 'delivery' ? b.type : 'dinein';
  const off = type !== 'dinein';
  const customer = type === 'delivery' ? cleanCustomer(b.customer) : type === 'takeaway' ? cleanPickup(b.customer) : null;
  if (off && !customer) return null;
  const table = type === 'takeaway' ? 'TA' : type === 'delivery' ? 'DL' : String(b.table || '');
  if (!off && !/^\d{1,2}$/.test(table)) return null;
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
    table: off ? table : table.padStart(2, '0'), type, customer, lines, note: str(b.note, 300),
    total: Math.round(num(b.total, 0, 1e7)), eta: Math.round(num(b.eta, 5, 180)),
  };
}

// Drops served tickets after 3 h and anything (even if never bumped) after 12 h, so forgotten tickets can't fill the board.
async function loadAll() {
  const [flat] = await pipe([['HGETALL', HASH]]);
  const now = Date.now(), list = [], stale = [];
  for (let i = 0; i < flat.length; i += 2) {
    let t; try { t = JSON.parse(flat[i + 1]); } catch (e) { stale.push(flat[i]); continue; }
    if ((t.st === 3 && now - (t.ts[3] || t.at) > KEEP_SERVED_MS) || now - t.at > KEEP_ANY_MS) stale.push(flat[i]); else list.push(t);
  }
  if (stale.length) await pipe([['HDEL', HASH, ...stale], ['INCR', VER]]);
  return list;
}

// Creates the ticket and bumps the version so kitchen tablets notice. extra: { pay } and anything else to store.
async function placeTicket(o, extra = {}) {
  const [seq] = await pipe([['INCR', SEQ]]);
  const at = Date.now(), no = 'KK-' + (2416 + seq);
  const t = { no, table: o.table, type: o.type, customer: o.customer, at, eta: o.eta, lines: o.lines, note: o.note, st: 0, ts: [at], kitchen: true, sample: false, total: o.total, ...extra };
  await pipe([['HSET', HASH, no, JSON.stringify(t)], ['INCR', VER]]);
  return { no, at };
}

module.exports = { HASH, SEQ, VER, KEEP_SERVED_MS, KEEP_ANY_MS, MAX_OPEN, RATE_PER_MIN, str, num, cleanOrder, loadAll, placeTicket };
