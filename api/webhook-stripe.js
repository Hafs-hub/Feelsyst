// api/webhook-stripe.js — Feelsyst V2 — Migré Supabase
// Vera envoie automatiquement l'email de facturation après chaque achat

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

// ============================================================
// Numéro de facture basé sur le count Supabase (persistant)
// ============================================================
async function generateInvoiceNumber() {
  const { count } = await supabase
    .from('payments')
    .select('*', { count: 'exact', head: true });
  const num = (count || 0) + 1;
  return `FS-${new Date().getFullYear()}-${String(num).padStart(4, '0')}`;
}

// ============================================================
// Détermine le plan depuis les metadata Stripe ou le montant
// ============================================================
function getPlanFromStripe(session) {
  const metadata = session.metadata || {};
  if (metadata.plan) return metadata.plan;
  const amount = (session.amount_total || 0) / 100;
  if (amount <= 30) return 'starter';
  if (amount <= 80) return 'pro';
  if (amount <= 180) return 'unlimited';
  return 'custom';
}

// ============================================================
// Email facture Vera (inchangé)
// ============================================================
async function sendInvoiceEmail(user, invoice) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) {
    console.warn('BREVO_API_KEY manquante — facture non envoyée');
    return;
  }

  const emailBody = `Bonjour ${user.firstname || user.full_name?.split(' ')[0] || ''},

Je suis Vera, votre agente finance IA chez Feelsyst 📊

Votre paiement a bien été reçu. Voici votre facture :

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTURE ${invoice.number}
Date : ${new Date(invoice.date).toLocaleDateString('fr-FR')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Client : ${user.full_name || ''}
Entreprise : ${user.company_name || ''}
Email : ${user.email}

Service : ${PLAN_NAMES[invoice.plan] || invoice.plan}
Montant HT : ${(invoice.amount / 1.2).toFixed(2)} €
TVA (20%) : ${(invoice.amount - invoice.amount / 1.2).toFixed(2)} €
TOTAL TTC : ${invoice.amount} €

Mode de paiement : Carte bancaire (Stripe)
Statut : ✅ Payée

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Accédez à votre tableau de bord : https://feelsyst.com/dashboard.html
Vos agents IA sont maintenant actifs et prêts à travailler pour vous.

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
      to: [{ email: user.email, name: user.full_name || user.email }],
      subject: `Facture ${invoice.number} — Feelsyst (${invoice.amount}€)`,
      textContent: emailBody,
    }),
  });
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET && sig) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    console.error('Webhook signature error:', err);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  try {
    switch (event.type) {

      // ──────────────────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;
        const plan = getPlanFromStripe(session);
        const amount = (session.amount_total || 0) / 100;
        const stripeCustomerId = session.customer;

        if (!customerEmail) {
          console.warn('Pas d\'email client dans la session Stripe');
          break;
        }

        // 1. Chercher si le client existe déjà
        const { data: existingClient } = await supabase
          .from('clients')
          .select('*')
          .eq('email', customerEmail)
          .single();

        let client;

        if (existingClient) {
          // Mettre à jour le plan
          const { data: updated } = await supabase
            .from('clients')
            .update({
              plan,
              status: 'active',
              stripe_customer_id: stripeCustomerId || existingClient.stripe_customer_id,
              stripe_subscription_id: session.subscription || existingClient.stripe_subscription_id,
              subscription_start: new Date().toISOString(),
              trial_ends_at: null,
            })
            .eq('email', customerEmail)
            .select()
            .single();
          client = updated;
        } else {
          // Créer le client (paiement sans inscription préalable)
          const { data: created } = await supabase
            .from('clients')
            .insert([{
              email: customerEmail,
              full_name: session.customer_details?.name || '',
              plan,
              status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: session.subscription,
              subscription_start: new Date().toISOString(),
            }])
            .select()
            .single();
          client = created;
        }

        // 2. Enregistrer le paiement
        const invoiceNumber = await generateInvoiceNumber();
        const invoiceData = {
          number: invoiceNumber,
          plan,
          amount,
          date: new Date().toISOString(),
        };

        await supabase.from('payments').insert([{
          client_id: client.id,
          stripe_payment_id: session.payment_intent,
          stripe_invoice_id: session.invoice,
          amount,
          currency: session.currency || 'eur',
          status: 'paid',
          plan,
          period_start: new Date().toISOString(),
          period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          invoice_sent: false,
        }]);

        // 3. Vera envoie la facture
        await sendInvoiceEmail(client, invoiceData);

        // 4. Marquer facture envoyée
        await supabase
          .from('payments')
          .update({ invoice_sent: true })
          .eq('stripe_payment_id', session.payment_intent);

        console.log(`✅ Vera: Facture ${invoiceNumber} envoyée à ${customerEmail}`);
        break;
      }

      // ──────────────────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object;

        // Retrouver le client via stripe_customer_id
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (client) {
          await supabase
            .from('clients')
            .update({
              status: sub.status === 'active' ? 'active' : 'past_due',
              stripe_subscription_id: sub.id,
            })
            .eq('id', client.id);
        }
        break;
      }

      // ──────────────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;

        const { data: client } = await supabase
          .from('clients')
          .select('id, email')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (client) {
          await supabase
            .from('clients')
            .update({
              plan: 'trial',
              status: 'cancelled',
              subscription_end: new Date().toISOString(),
            })
            .eq('id', client.id);

          // Créer une alerte admin
          await supabase.from('admin_alerts').insert([{
            type: 'churn',
            severity: 'warning',
            title: 'Abonnement annulé',
            message: `Le client ${client.email} a annulé son abonnement.`,
            client_id: client.id,
          }]);

          console.log(`⚠️ Abonnement annulé pour ${client.email}`);
        }
        break;
      }

      // ──────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const inv = event.data.object;

        const { data: client } = await supabase
          .from('clients')
          .select('id, email')
          .eq('stripe_customer_id', inv.customer)
          .single();

        if (client) {
          await supabase
            .from('clients')
            .update({ status: 'past_due' })
            .eq('id', client.id);

          await supabase.from('admin_alerts').insert([{
            type: 'payment_failed',
            severity: 'critical',
            title: 'Paiement échoué',
            message: `Paiement de ${(inv.amount_due / 100).toFixed(2)}€ échoué pour ${client.email}.`,
            client_id: client.id,
          }]);

          console.log(`❌ Paiement échoué pour ${client.email}`);
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
