// api/forgot-password.js
const crypto = require('crypto');
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let resetTokens = global._feelsystResets || (global._feelsystResets = {});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const user = usersStore[email.toLowerCase().trim()];
  // Toujours répondre OK (sécurité : ne pas révéler si l'email existe)
  if (!user) return res.status(200).json({ success: true });

  const token = crypto.randomBytes(32).toString('hex');
  resetTokens[token] = { email: user.email, expiresAt: Date.now() + 3600000 }; // 1h

  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (BREVO_KEY) {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
      body: JSON.stringify({
        sender: { name: 'Lumi — Feelsyst', email: 'contact@feelsyst.com' },
        to: [{ email: user.email, name: `${user.firstname} ${user.lastname}` }],
        subject: 'Réinitialisation de votre mot de passe — Feelsyst',
        textContent: `Bonjour ${user.firstname},\n\nUne demande de réinitialisation a été effectuée.\n\nCliquez ici : https://feelsyst.com/reset-password.html?token=${token}\n\nCe lien expire dans 1 heure.\n\nSi vous n'avez pas fait cette demande, ignorez cet email.\n\nLumi — Feelsyst`,
      }),
    });
  }

  return res.status(200).json({ success: true });
};
