const { roleOf, deny } = require('./_lib');
module.exports = (req, res) => {
  const role = roleOf(req);
  if (!role) return deny(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ role }));
};
