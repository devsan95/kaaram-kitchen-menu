// /admin, /admin/preview and /kitchen (staff only), /rider (staff or rider): the browser's native Basic Auth prompt, then the page opens straight into that screen.
const fs = require('fs');
const path = require('path');
const { roleOf, challenge } = require('./_lib');
module.exports = (req, res) => {
  const rider = new URL(req.url, 'http://x').searchParams.get('view') === 'rider';
  const role = roleOf(req);
  if (!role || (!rider && role !== 'staff')) return challenge(res);
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
};
