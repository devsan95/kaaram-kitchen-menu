const { isAuthed, deny } = require('./_lib');
module.exports = (req, res) => {
  if (!isAuthed(req)) return deny(res);
  res.setHeader('Cache-Control', 'no-store');
  res.end('ok');
};
