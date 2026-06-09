// api/profile.js — Mise à jour profil utilisateur
const crypto = require('crypto');
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let tokensStore = global._feelsystTokens || (global._feelsystTokens = {});

function getUserFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  const email = tokensStore[token];
  return email ? usersStore[email] : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Méthode non autorisée' });

  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });

  const { firstname, lastname, company, sector } = req.body || {};
  if (firstname) user.firstname = firstname.trim();
  if (lastname) user.lastname = lastname.trim();
  if (company) user.company = company.trim();
  if (sector) user.sector = sector;
  user.updatedAt = new Date().toISOString();

  const userPublic = { ...user };
  delete userPublic.passwordHash;
  return res.status(200).json({ success: true, user: userPublic });
};
