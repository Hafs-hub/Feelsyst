// api/login.js — Feelsyst V2 — Migré Supabase
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

  const normalizedEmail = email.toLowerCase().trim();

  // Récupérer le client depuis Supabase
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('email', normalizedEmail)
    .single();

  if (error || !client) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // Vérifier le mot de passe
  if (client.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // Vérifier statut du compte
  if (client.status === 'suspended' || client.status === 'cancelled') {
    return res.status(403).json({ error: 'Compte désactivé. Contactez le support.' });
  }

  // Vérifier expiration trial
  if (client.plan === 'trial' && client.trial_ends_at) {
    if (new Date() > new Date(client.trial_ends_at)) {
      return res.status(403).json({
        error: 'Votre période d\'essai de 7 jours est terminée. Choisissez un plan pour continuer.',
        trialExpired: true,
      });
    }
  }

  // Générer le token et le sauvegarder
  const token = generateToken(normalizedEmail);

  await supabase.from('sessions').insert([{
    token,
    client_id: client.id,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  }]);

  // Mettre à jour last_login
  await supabase
    .from('clients')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', client.id);

  // Extraire firstname/lastname depuis full_name
  const nameParts = (client.full_name || '').split(' ');
  const firstname = nameParts[0] || '';
  const lastname = nameParts.slice(1).join(' ') || '';

  return res.status(200).json({
    success: true,
    token,
    user: {
      id: client.id,
      firstname,
      lastname,
      email: client.email,
      company: client.company_name,
      sector: client.sector,
      plan: client.plan,
      status: client.status,
      trialEndsAt: client.trial_ends_at,
      createdAt: client.created_at,
    },
  });
};
