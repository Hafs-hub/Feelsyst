// api/register.js — Feelsyst V2
// Inscription client : création compte + email Rex de bienvenue

const crypto = require('crypto');

// Plans Stripe — Payment Links avec vrais price IDs
const STRIPE_LINKS = {
  starter:   'https://buy.stripe.com/pay/price_1TgL8mAeed9sYBiokS3BJgG0',  // 29€/mois
  pro:       'https://buy.stripe.com/pay/price_1TgLALAeed9sYBiouz0mxBsd',  // 79€/mois
  unlimited: 'https://buy.stripe.com/pay/price_1TgLB0Aeed9sYBioFYaYx8RI',  // 179€/mois
  custom:    'https://buy.stripe.com/pay/price_1TgLBtAeed9sYBio4mRzpovS',  // 399€ unique
};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + (process.env.PASSWORD_SALT || 'feelsyst2025')).digest('hex');
}

function generateToken(email) {
  return crypto.createHash('sha256').update(email + Date.now() + Math.random()).digest('hex');
}

async function sendWelcomeEmail(user) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) {
    console.warn('BREVO_API_KEY manquante — email non envoyé');
    return;
  }

  const planNames = { free: 'Découverte (7 jours gratuits)', starter: 'Starter', pro: 'Pro', unlimited: 'Illimité' };

  const emailBody = `Bonjour ${user.firstname},

Je suis Rex, votre agent commercial IA chez Feelsyst. 🤝

Votre compte a été créé avec succès ! Voici vos informations :

• Plan : ${planNames[user.plan] || user.plan}
• Entreprise : ${user.company}
• Secteur : ${user.sector}

${user.plan === 'free' ? `Vous disposez de 7 jours pour tester nos 5 agents IA en conditions réelles. Pas de carte bancaire requise.` : `Votre abonnement est actif. Vos 5 agents IA sont prêts à travailler pour vous.`}

Accédez à votre tableau de bord : https://feelsyst.com/dashboard.html

Vos agents IA qui vous attendent :
🧠 Aria — Stratégie & Veille marché
✨ Nova — Marketing & Création de contenu
💼 Rex — Ventes & Prospection (c'est moi !)
📊 Vera — Finance & Facturation
💬 Lumi — Support client 24h/7j

N'hésitez pas à me contacter directement si vous avez des questions.

À très vite,
Rex
Agent Commercial IA — Feelsyst
contact@feelsyst.com`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'Rex — Feelsyst', email: 'contact@feelsyst.com' },
      to: [{ email: user.email, name: `${user.firstname} ${user.lastname}` }],
      subject: `Bienvenue sur Feelsyst ${user.firstname} — Vos agents IA sont prêts 🚀`,
      textContent: emailBody,
    }),
  });
}

// Simple in-memory storage (remplacez par DB en production)
// En production : utilisez Vercel KV, PlanetScale, ou Supabase
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let tokensStore = global._feelsystTokens || (global._feelsystTokens = {});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { firstname, lastname, email, company, sector, password, plan = 'free' } = req.body;

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

    // Vérifier si email déjà utilisé
    if (usersStore[email]) {
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    }

    // Créer l'utilisateur
    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email: email.toLowerCase().trim(),
      company: company.trim(),
      sector,
      plan,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      active: true,
      trialEndsAt: plan === 'free' ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() : null,
    };

    usersStore[email] = user;

    // Générer le token
    const token = generateToken(email);
    tokensStore[token] = email;

    // Envoyer email de bienvenue (Rex) — async, non bloquant
    sendWelcomeEmail(user).catch(e => console.error('Email error:', e));

    // Préparer la réponse
    const userPublic = { ...user };
    delete userPublic.passwordHash;

    // Si plan payant, fournir le lien Stripe
    const paymentUrl = plan !== 'free' ? STRIPE_LINKS[plan] : null;

    return res.status(200).json({
      success: true,
      token,
      user: userPublic,
      paymentUrl,
      message: 'Compte créé avec succès',
    });

  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' });
  }
};
