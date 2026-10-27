const crypto = require('crypto');

const KEY = 'kaaram-menu';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// HTTP Basic Auth. Two roles:
//   staff: KAARAM_USER / KAARAM_PASS             (everything)
//   rider: KAARAM_RIDER_USER / KAARAM_RIDER_PASS (optional; delivery screen only)
// There are no defaults: unset variables mean nobody can sign in with that role.
function roleOf(req) {
  const h = req.headers.authorization || '';
  if (!/^basic /i.test(h)) return null;
  let u = '', p = '';
  try {
    const t = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = t.indexOf(':');
    u = t.slice(0, i); p = t.slice(i + 1);
  } catch (e) { return null; }
  const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
  const check = (uv, pv) => {
    const user = process.env[uv], pass = process.env[pv];
    if (!user || !pass) return false;
    const a = same(u, user), b = same(p, pass);
    return a && b;
  };
  if (check('KAARAM_USER', 'KAARAM_PASS')) return 'staff';
  if (check('KAARAM_RIDER_USER', 'KAARAM_RIDER_PASS')) return 'rider';
  return null;
}
const isAuthed = (req) => roleOf(req) === 'staff';   // staff only (menu, kitchen)
const canDeliver = (req) => !!roleOf(req);           // staff or rider (delivery screen)

function challenge(res) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="Kaaram Kitchen staff", charset="UTF-8"');
  res.setHeader('Cache-Control', 'no-store');
  res.end('Authentication required');
}

// 401 without WWW-Authenticate, so page scripts never trigger the browser's own login dialog.
function deny(res) {
  res.statusCode = 401;
  res.setHeader('Cache-Control', 'no-store');
  res.end('Unauthorized');
}

// Storage: Upstash Redis over REST (Vercel Marketplace "Upstash Redis" / legacy Vercel KV env names both work).
// Finds the Upstash/Vercel KV credentials. Vercel's Marketplace can add a custom prefix (e.g. STORAGE_KV_REST_API_URL),
// so any variable ending in KV_REST_API_URL or UPSTASH_REDIS_REST_URL is accepted, with the matching token.
function redisConf() {
  const env = process.env;
  const pairs = [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u].replace(/\/$/, ''), token: env[t] };
  for (const k of Object.keys(env)) {
    for (const [u, t] of pairs) {
      if (k.endsWith('_' + u) && env[k]) {
        const tk = env[k.slice(0, -u.length) + t];
        if (tk) return { url: env[k].replace(/\/$/, ''), token: tk };
      }
    }
  }
  return null;
}
async function redis(cmd) {
  const c = redisConf();
  if (!c) throw Object.assign(new Error('no storage'), { code: 'NO_STORAGE' });
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}
async function pipe(cmds) {
  const c = redisConf();
  if (!c) throw Object.assign(new Error('no storage'), { code: 'NO_STORAGE' });
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map((x) => x.result);
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const loadMenu = async () => redis(['GET', KEY]);
const saveMenu = async (json) => redis(['SET', KEY, json]);

function readBody(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { code: 'BIG' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { roleOf, canDeliver, isAuthed, challenge, deny, redis, pipe, clientIp, loadMenu, saveMenu, readBody, redisConf };
