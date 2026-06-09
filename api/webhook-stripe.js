// api/webhook-stripe.js — Feelsyst V2
// Vera envoie automatiquement l'email de facturation après chaque achat

const crypto = require('crypto');

const PLAN_PRICES = {
  starter: 29,
  pro: 79,
  unlimited: 179,
  custom: 399,
};

const PLAN_NAMES = {
  starter: 'Pack Starter',
  pro: 'Pack Pro',
  unlimited: 'Pack Illimité',
  custom: 'Agent IA Personnalisé',
};

let usersStore = global._feelsystUsers || (global._feelsystUsers = {});
let invoicesStore = global._feelsystInvoices || (global._feelsystInvoices = []);

function generateInvoiceNumber() {
  const count = invoicesStore.length + 1;
  return `FS-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;
}

async function sendInvoiceEmail(user, invoice) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) {
    console.warn('BREVO_API_KEY manquante — facture non envoyée');
    return;
  }

  const emailBody = `Bonjour ${user.firstname},

Je suis Vera, votre agente finance IA chez Feelsyst 📊

Votre paiement a bien été reçu. Voici votre facture :

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTURE ${invoice.number}
Date : ${new Date(invoice.date).toLocaleDateString('fr-FR')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Client : ${user.firstname} ${user.lastname}
Entreprise : ${user.company}
Email : ${user.email}

Service : ${PLAN_NAMES[invoice.plan] || invoice.plan}
Montant HT : ${(invoice.amount / 1.2).toFixed(2)} €
TVA (20%) : ${(invoice.amount - invoice.amount / 1.2).toFixed(2)} €
TOTAL TTC : ${invoice.amount} €

Mode de paiement : Carte bancaire (Stripe)
Statut : ✅ Payée

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Accédez à votre tableau de bord : https://feelsyst.com/dashboard.html
Vos 5 agents IA sont maintenant actifs et prêts à travailler pour vous.

Pour toute question concernant votre facture :
contact@feelsyst.com

Merci pour votre confiance,
Vera
Agente Finance & Administration — Feelsyst
SIRET : [À compléter après immatriculation]`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'Vera — Feelsyst', email: 'contact@feelsyst.com' },
      to: [{ email: user.email, name: `${user.firstname} ${user.lastname}` }],
      subject: `Facture ${invoice.number} — Feelsyst (${invoice.amount}€)`,
      textContent: emailBody,
    }),
  });
}

// Détermine le plan depuis les metadata Stripe ou le price_id
function getPlanFromStripe(session) {
  const metadata = session.metadata || {};
  if (metadata.plan) return metadata.plan;
  // Fallback basé sur le montant
  const amount = (session.amount_total || 0) / 100;
  if (amount <= 30) return 'starter';
  if (amount <= 80) return 'pro';
  if (amount <= 180) return 'unlimited';
  return 'custom';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // Vérification signature Stripe (si webhook secret configuré)
    if (STRIPE_WEBHOOK_SECRET && sig) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // Mode dev : parse directement
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    console.error('Webhook signature error:', err);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;
        const plan = getPlanFromStripe(session);
        const amount = (session.amount_total || 0) / 100;

        // Mettre à jour le plan utilisateur
        if (customerEmail && usersStore[customerEmail]) {
          usersStore[customerEmail].plan = plan;
          usersStore[customerEmail].planActivatedAt = new Date().toISOString();
          usersStore[customerEmail].stripeSessionId = session.id;
        }

        // Créer la facture
        const invoice = {
          number: generateInvoiceNumber(),
          plan,
          amount,
          date: new Date().toISOString(),
          sessionId: session.id,
          customerEmail,
        };
        invoicesStore.push(invoice);

        // Vera envoie l'email de facturation
        const user = usersStore[customerEmail];
        if (user) {
          await sendInvoiceEmail(user, invoice);
          console.log(`✅ Vera: Facture ${invoice.number} envoyée à ${customerEmail}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const email = sub.customer_email;
        if (email && usersStore[email]) {
          usersStore[email].subscriptionStatus = sub.status;
          usersStore[email].active = sub.status === 'active';
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const email = sub.customer_email;
        if (email && usersStore[email]) {
          usersStore[email].plan = 'free';
          usersStore[email].subscriptionStatus = 'cancelled';
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Erreur traitement webhook' });
  }
};
