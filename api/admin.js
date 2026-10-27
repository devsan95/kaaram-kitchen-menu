// /admin: the browser's native Basic Auth prompt, then the same page opens straight into the staff editor.
const fs = require('fs');
const path = require('path');
const { isAuthed, challenge } = require('./_lib');
module.exports = (req, res) => {
  if (!isAuthed(req)) return challenge(res);
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
};
