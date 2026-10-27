const { isAuthed, challenge } = require('./_lib');
module.exports = (req, res) => {
  if (!isAuthed(req)) return challenge(res);
  res.setHeader('Cache-Control', 'no-store');
  res.end('ok');
};
