const crypto = require('crypto');

const KEY = 'kaaram-menu';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// HTTP Basic Auth against KAARAM_USER / KAARAM_PASS (no defaults: unset means nobody can sign in).
function isAuthed(req) {
  const user = process.env.KAARAM_USER, pass = process.env.KAARAM_PASS;
  if (!user || !pass) return false;
  const h = req.headers.authorization || '';
  if (!/^basic /i.test(h)) return false;
  let u = '', p = '';
  try {
    const t = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = t.indexOf(':');
    u = t.slice(0, i); p = t.slice(i + 1);
  } catch (e) { return false; }
  const a = crypto.timingSafeEqual(sha(u), sha(user));
  const b = crypto.timingSafeEqual(sha(p), sha(pass));
  return a && b;
}

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
function redisConf() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
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

module.exports = { isAuthed, challenge, deny, redis, pipe, clientIp, loadMenu, saveMenu, readBody, redisConf };
