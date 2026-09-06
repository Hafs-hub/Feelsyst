// api/register.js — Feelsyst V2 — Supabase + email awaité correctement
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Plans disponibles : Découverte (trial), Starter, Pro
const STRIPE_LINKS = {
  starter: 'https://buy.stripe.com/pay/price_1TgL8mAeed9sYBiokS3BJgG0',
  pro:     'https://buy.stripe.com/pay/price_1TgLALAeed9sYBiouz0mxBsd',
};

function hashPassword(password) {
  return crypto.createHash('sha256')
    .update(password + (process.env.PASSWORD_SALT || 'feelsyst2025'))
    .digest('hex');
}

function generateToken(email) {
  return crypto.createHash('sha256')
    .update(email + Date.now() + Math.random())
    .digest('hex');
}

// ── Email de bienvenue — DOIT être awaité avant la réponse HTTP ──
// Raison : Vercel termine la fonction serverless immédiatement après res.json()
// Un appel fire-and-forget est tué avant d'atteindre Brevo
async function sendWelcomeEmail(userData) {
  const BREVO_KEY = process.env.BREVO_API_KEY;

  if (!BREVO_KEY) {
    console.error('❌ BREVO_API_KEY absente des variables Vercel — email non envoyé');
    throw new Error('BREVO_API_KEY manquante');
  }

  console.log(`📧 Envoi email de bienvenue à ${userData.email}...`);

  // Pricing cohérent avec index.html (3 plans : trial, starter, pro)
  const planNames = {
    trial:   'Découverte — 0€ · 7 jours · 30 messages · 5 agents',
    starter: 'Starter — 29€/mois · 200 messages · 8 agents',
    pro:     'Pro — 59€/mois · 800 messages · 8 agents + personnalisation',
  };
  // Quotas cohérents avec PLAN_PERMS du dashboard
  const planQuotas = {
    trial: 30, starter: 200, pro: 800,
  };
  // Agents disponibles par plan (cohérent avec index.html)
  const planAgents = {
    trial:   ['aria', 'nova', 'rex', 'vera', 'lumi'], // 5 agents
    starter: ['aria', 'nova', 'rex', 'vera', 'lumi', 'lex', 'pulse', 'atlas'], // 8 agents
    pro:     ['aria', 'nova', 'rex', 'vera', 'lumi', 'lex', 'pulse', 'atlas'], // 8 agents
  };

  const quota = planQuotas[userData.plan] > 0 ? planQuotas[userData.plan] + ' messages inclus' : 'Messages illimités';
  const emailBody = `Bonjour ${userData.firstname},

Je suis Rex, votre agent commercial IA chez Feelsyst. 🤝

Votre compte a été créé avec succès !

• Plan : ${planNames[userData.plan] || userData.plan}
• Quota : ${quota}
• Entreprise : ${userData.company}
• Secteur : ${userData.sector}

${userData.plan === 'trial'
  ? 'Vous disposez de 7 jours et 30 messages pour tester nos agents IA. Pas de carte bancaire requise.'
  : 'Votre abonnement est actif. Vos agents IA sont prêts à travailler pour vous.'}

Accédez à votre tableau de bord : https://feelsyst.com/dashboard.html

${userData.plan === 'trial'
    ? `Vos 5 agents IA disponibles pendant l'essai :
🧠 Aria — Stratégie & Veille marché
✨ Nova — Marketing & Création de contenu
💼 Rex — Ventes & Prospection (c'est moi !)
📊 Vera — Finance & Facturation
💬 Lumi — Support client 24h/7j

Passez au plan Starter pour accéder à Lex, Pulse et Atlas.`
    : `Vos 8 agents IA qui vous attendent :
🧠 Aria — Stratégie & Veille marché
✨ Nova — Marketing & Création de contenu
💼 Rex — Ventes & Prospection (c'est moi !)
📊 Vera — Finance & Facturation
💬 Lumi — Support client 24h/7j
⚖️ Lex — Juridique & Conformité RGPD
📈 Pulse — Analytics & Reporting
🎓 Atlas — Onboarding & Formation`}

À très vite,
Rex — Agent Commercial IA Feelsyst`;

  const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'Rex — Feelsyst', email: 'contact@feelsyst.com' },
      to: [{ email: userData.email, name: `${userData.firstname} ${userData.lastname}` }],
      subject: `Bienvenue sur Feelsyst ${userData.firstname} — Vos agents IA sont prêts 🚀`,
      textContent: emailBody,
    }),
  });

  const brevoData = await brevoRes.json();

  if (!brevoRes.ok) {
    console.error('❌ Brevo API erreur:', JSON.stringify(brevoData));
    throw new Error(`Brevo ${brevoRes.status}: ${JSON.stringify(brevoData)}`);
  }

  console.log('✅ Email de bienvenue envoyé avec succès. MessageId:', brevoData.messageId);
  return brevoData;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { firstname, lastname, email, company, sector, password } = req.body;
    // Valider le plan (uniquement trial, starter, pro)
    const rawPlan = req.body.plan || 'trial';
    const plan = ['trial', 'starter', 'pro'].includes(rawPlan) ? rawPlan : 'trial';

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

    // Créer le client
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
        password_hash: hashPassword(password),
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Créer la session
    const token = generateToken(normalizedEmail);
    await supabase.from('sessions').insert([{
      token,
      client_id: newClient.id,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    }]);

    // ── Email AWAITÉ avant la réponse ──
    // Critique : ne pas mettre en fire-and-forget
    // Vercel tue les fonctions immédiatement après res.json()
    let emailSent = false;
    try {
      await sendWelcomeEmail({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        email: normalizedEmail,
        company: company.trim(),
        sector,
        plan,
      });
      emailSent = true;
    } catch (emailErr) {
      // L'email échoue → inscription réussie quand même
      console.error('❌ Erreur envoi email bienvenue:', emailErr.message);
    }

    const paymentUrl = STRIPE_LINKS[plan] || null; // null pour trial

    return res.status(200).json({
      success: true,
      token,
      emailSent,
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
