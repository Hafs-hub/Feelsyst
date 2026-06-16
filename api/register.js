// api/register.js — Feelsyst V2 — Migré Supabase
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const STRIPE_LINKS = {
  starter:   'https://buy.stripe.com/pay/price_1TgL8mAeed9sYBiokS3BJgG0',
  pro:       'https://buy.stripe.com/pay/price_1TgLALAeed9sYBiouz0mxBsd',
  unlimited: 'https://buy.stripe.com/pay/price_1TgLB0Aeed9sYBioFYaYx8RI',
  custom:    'https://buy.stripe.com/pay/price_1TgLBtAeed9sYBio4mRzpovS',
};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + (process.env.PASSWORD_SALT || 'feelsyst2025')).digest('hex');
}

function generateToken(email) {
  return crypto.createHash('sha256').update(email + Date.now() + Math.random()).digest('hex');
}

async function sendWelcomeEmail(user) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) return;

  const planNames = { trial: 'Découverte (7 jours gratuits)', starter: 'Starter', pro: 'Pro', unlimited: 'Illimité' };

  const emailBody = `Bonjour ${user.firstname},

Je suis Rex, votre agent commercial IA chez Feelsyst. 🤝

Votre compte a été créé avec succès ! Voici vos informations :

• Plan : ${planNames[user.plan] || user.plan}
• Entreprise : ${user.company}
• Secteur : ${user.sector}

${user.plan === 'trial'
  ? 'Vous disposez de 7 jours pour tester nos agents IA en conditions réelles. Pas de carte bancaire requise.'
  : 'Votre abonnement est actif. Vos agents IA sont prêts à travailler pour vous.'}

Accédez à votre tableau de bord : https://feelsyst.com/dashboard.html

Vos agents IA qui vous attendent :
🧠 Aria — Stratégie & Veille marché
✨ Nova — Marketing & Création de contenu
💼 Rex — Ventes & Prospection (c'est moi !)
📊 Vera — Finance & Facturation
💬 Lumi — Support client 24h/7j

À très vite,
Rex — Agent Commercial IA Feelsyst`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
    body: JSON.stringify({
      sender: { name: 'Rex — Feelsyst', email: 'contact@feelsyst.com' },
      to: [{ email: user.email, name: `${user.firstname} ${user.lastname}` }],
      subject: `Bienvenue sur Feelsyst ${user.firstname} — Vos agents IA sont prêts 🚀`,
      textContent: emailBody,
    }),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { firstname, lastname, email, company, sector, password, plan = 'trial' } = req.body;

    // Validation
    if (!firstname || !lastname || !email || !company || !sector || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Vérifier si email déjà utilisé
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    }

    // Créer le client dans Supabase
    const trialEndsAt = plan === 'trial'
      ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      : null;

    const { data: newClient, error: insertError } = await supabase
      .from('clients')
      .insert([{
        email: normalizedEmail,
        full_name: `${firstname.trim()} ${lastname.trim()}`,
        company_name: company.trim(),
        sector,
        plan,
        status: plan === 'trial' ? 'trial' : 'active',
        trial_ends_at: trialEndsAt,
        password_hash: hashPassword(password), // ← ajouter colonne password_hash à la table clients (voir note)
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Générer le token et le stocker dans Supabase
    const token = generateToken(normalizedEmail);

    await supabase.from('sessions').insert([{
      token,
      client_id: newClient.id,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // 30 jours
    }]);

    // Email de bienvenue Rex
    sendWelcomeEmail({
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email: normalizedEmail,
      company: company.trim(),
      sector,
      plan,
    }).catch(e => console.error('Email error:', e));

    const paymentUrl = plan !== 'trial' ? STRIPE_LINKS[plan] : null;

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: newClient.id,
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        email: normalizedEmail,
        company: company.trim(),
        sector,
        plan,
        trialEndsAt,
        createdAt: newClient.created_at,
      },
      paymentUrl,
      message: 'Compte créé avec succès',
    });

  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' });
  }
};
