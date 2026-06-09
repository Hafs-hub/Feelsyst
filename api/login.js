// api/login.js — Feelsyst V2
const crypto = require('crypto');

let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let tokensStore = global._feelsystTokens || (global._feelsystTokens = {});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + (process.env.PASSWORD_SALT || 'feelsyst2025')).digest('hex');
}

function generateToken(email) {
  return crypto.createHash('sha256').update(email + Date.now() + Math.random()).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const user = usersStore[email.toLowerCase().trim()];
  if (!user) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  if (user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'Compte désactivé. Contactez le support.' });
  }

  // Vérifier expiration essai gratuit
  if (user.plan === 'free' && user.trialEndsAt) {
    if (new Date() > new Date(user.trialEndsAt)) {
      return res.status(403).json({
        error: 'Votre période d\'essai de 7 jours est terminée. Choisissez un plan pour continuer.',
        trialExpired: true,
      });
    }
  }

  const token = generateToken(email);
  tokensStore[token] = email;

  const userPublic = { ...user };
  delete userPublic.passwordHash;

  return res.status(200).json({
    success: true,
    token,
    user: userPublic,
  });
};
