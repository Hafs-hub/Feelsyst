// api/me.js — Récupérer les infos de l'utilisateur connecté
const crypto = require('crypto');
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let tokensStore = global._feelsystTokens || (global._feelsystTokens = {});

function getUserFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const email = tokensStore[token];
  if (!email) return null;
  return usersStore[email] || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });

  const userPublic = { ...user };
  delete userPublic.passwordHash;
  return res.status(200).json({ success: true, user: userPublic });
};
