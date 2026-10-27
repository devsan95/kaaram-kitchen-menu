const { isAuthed, challenge, loadMenu, saveMenu, readBody } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      let v = null;
      try { v = await loadMenu(); } catch (e) { if (e.code !== 'NO_STORAGE') throw e; }
      res.setHeader('Content-Type', 'application/json');
      return res.end(v || '{}');           // {} = "no published menu yet": page uses its built-in one
    }
    if (req.method === 'PUT') {
      if (!isAuthed(req)) return challenge(res);
      let obj;
      try {
        obj = JSON.parse(await readBody(req));
        if (!obj || !Array.isArray(obj.cats) || !Array.isArray(obj.items)) throw 0;
      } catch (e) {
        res.statusCode = e && e.code === 'BIG' ? 413 : 400;
        return res.end('Invalid menu');
      }
      try { await saveMenu(JSON.stringify(obj)); }
      catch (e) { res.statusCode = e.code === 'NO_STORAGE' ? 503 : 502; return res.end('Storage unavailable'); }
      return res.end('saved');
    }
    res.statusCode = 405; res.setHeader('Allow', 'GET, PUT'); res.end('Method not allowed');
  } catch (e) { res.statusCode = 500; res.end('Server error'); }
};
