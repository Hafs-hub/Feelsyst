// api/change-password.js
const crypto = require('crypto');
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let tokensStore = global._feelsystTokens || (global._feelsystTokens = {});

function hashPassword(p) {
  return crypto.createHash('sha256').update(p + (process.env.PASSWORD_SALT || 'feelsyst2025')).digest('hex');
}
function getUserFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  const email = tokensStore[token];
  return email ? usersStore[email] : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });

  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court' });
  }
  user.passwordHash = hashPassword(password);
  return res.status(200).json({ success: true });
};
