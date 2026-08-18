// api/register.js — Feelsyst V2 — Inscription client (Supabase)
// Compatible avec login.js : même hash, même table "clients", même table "sessions"
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

  const { firstname, lastname, email, company, sector, password, plan } = req.body || {};

  // ── Validations ──
  if (!firstname || !email || !password) {
    return res.status(400).json({ error: 'Prénom, email et mot de passe requis' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // ── Vérifier si le compte existe déjà ──
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'Un compte existe déjà avec cet email. Connectez-vous.' });
  }

  // ── Créer le client (essai gratuit 7 jours) ──
  const chosenPlan = ['trial', 'starter', 'pro', 'unlimited'].includes(plan) ? plan : 'trial';
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const { data: client, error } = await supabase
    .from('clients')
    .insert([{
      email: normalizedEmail,
      password_hash: hashPassword(password),
      full_name: `${firstname} ${lastname || ''}`.trim(),
      company_name: company || null,
      sector: sector || null,
      plan: 'trial',
      status: 'trial',
      trial_ends_at: trialEndsAt,
      created_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Erreur lors de la création du compte: ' + error.message });
  }

  // ── Créer la session (token 30 jours) ──
  const token = generateToken(normalizedEmail);
  await supabase.from('sessions').insert([{
    token,
    client_id: client.id,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  }]);

  // ── Plan payant → session Stripe (optionnel, seulement si configuré) ──
  let paymentUrl = null;
  if (chosenPlan !== 'trial' && process.env.STRIPE_SECRET_KEY) {
    try {
      const priceIds = {
        starter: process.env.STRIPE_PRICE_STARTER,
        pro: process.env.STRIPE_PRICE_PRO,
        unlimited: process.env.STRIPE_PRICE_UNLIMITED,
      };
      const priceId = priceIds[chosenPlan];
      if (priceId) {
        const params = new URLSearchParams({
          mode: 'subscription',
          'line_items[0][price]': priceId,
          'line_items[0][quantity]': '1',
          customer_email: normalizedEmail,
          success_url: 'https://www.feelsyst.com/dashboard.html?paiement=ok',
          cancel_url: 'https://www.feelsyst.com/auth.html?paiement=annule',
          'metadata[client_id]': String(client.id),
          'metadata[plan]': chosenPlan,
        });
        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const stripeData = await stripeRes.json();
        if (stripeData.url) paymentUrl = stripeData.url;
      }
    } catch (e) {
      // Stripe non configuré ou erreur : le compte reste créé, pas de blocage
    }
  }

  // ── Email de bienvenue via Brevo (optionnel) ──
  if (process.env.BREVO_API_KEY) {
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Feelsyst', email: 'contact@feelsyst.com' },
          to: [{ email: normalizedEmail, name: firstname }],
          subject: 'Bienvenue sur Feelsyst — Votre essai de 7 jours commence',
          textContent: `Bonjour ${firstname},\n\nVotre compte Feelsyst est créé. Vous avez 7 jours d'essai gratuit avec accès à tous les agents IA.\n\nConnectez-vous : https://www.feelsyst.com/auth.html\n\nÀ très vite,\nL'équipe Feelsyst`,
        }),
      });
    } catch (e) { /* email non bloquant */ }
  }

  return res.status(200).json({ success: true, token, paymentUrl });
};
