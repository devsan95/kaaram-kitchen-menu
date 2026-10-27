// /admin (staff) and /delivery (staff or rider): the browser's native Basic Auth prompt, then the page opens straight into that screen.
const fs = require('fs');
const path = require('path');
const { roleOf, challenge } = require('./_lib');
module.exports = (req, res) => {
  const delivery = new URL(req.url, 'http://x').searchParams.get('view') === 'delivery';
  const role = roleOf(req);
  if (!role || (!delivery && role !== 'staff')) return challenge(res);
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
};
