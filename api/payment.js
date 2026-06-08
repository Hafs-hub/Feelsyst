// WORKFLOW 2 — Lumi + Vera gèrent les paiements Stripe
const BREVO_KEY = process.env.BREVO_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const LUMI = process.env.LUMI_EMAIL;
const FINANCE = process.env.FINANCE_EMAIL;

async function claude(system, msg) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 800, system, messages: [{ role: 'user', content: msg }] })
  });
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

async function brevo(from, fromName, to, subject, text) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
    body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: to }], subject, textContent: text })
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;
    const event = body?.type || '';
    const obj = body?.data?.object || {};
    const clientEmail = obj.receipt_email || obj.customer_email || '';
    const amount = ((obj.amount || 0) / 100).toFixed(2);
    const date = new Date().toLocaleDateString('fr-FR');

    if (!clientEmail) return res.status(200).json({ received: true });

    if (event === 'payment_intent.succeeded' || event === 'checkout.session.completed') {
      // Déterminer le plan souscrit selon le montant
      let plan = 'Pack souscrit';
      if (parseFloat(amount) <= 50) plan = 'Pack Starter';
      else if (parseFloat(amount) <= 150) plan = 'Pack Pro';
      else if (parseFloat(amount) <= 300) plan = 'Pack Illimité';
      else if (parseFloat(amount) <= 600) plan = 'Agent IA Personnalisé';
      else if (parseFloat(amount) <= 300) plan = 'Audit Marketing IA';

      // Numéro de facture automatique
      const invoiceNum = 'FS-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-4);

      // Lumi envoie email de bienvenue chaleureux
      const welcome = await claude(
        'Tu es Lumi, responsable support de Feelsyst.com. Tu accueilles les nouveaux clients avec chaleur, professionnalisme et enthousiasme. Tu expliques les prochaines étapes. Signe Lumi — Support Feelsyst.com.',
        `Nouveau client vient de souscrire au ${plan} pour ${amount}€. Email: ${clientEmail}. Date: ${date}. Rédige un email de bienvenue chaleureux qui : 1) Les remercie de leur confiance 2) Explique ce qui va se passer maintenant (les agents vont commencer à travailler sous 24h) 3) Présente brièvement les 5 agents IA (Aria, Nova, Rex, Vera, Lumi) 4) Dit que tu es disponible pour toute question. Professionnel et enthousiaste.`
      );

      await brevo(LUMI, 'Lumi — Feelsyst.com', clientEmail,
        `Bienvenue chez Feelsyst.com — Votre ${plan} est activé !`,
        welcome
      );

      // Vera envoie la facture au client
      const invoiceText = await claude(
        'Tu es Vera, CFO de Feelsyst.com. Tu rédiges des emails de facturation professionnels et précis. Signe Vera — CFO Feelsyst.com.',
        `Rédige un email de facture pour : Client=${clientEmail}, Service=${plan}, Montant HT=${(parseFloat(amount)/1.2).toFixed(2)}€, TVA 20%=${(parseFloat(amount)-parseFloat(amount)/1.2).toFixed(2)}€, Montant TTC=${amount}€, Date=${date}, Numéro facture=${invoiceNum}. Inclure les coordonnées : Feelsyst.com, contact@feelsyst.com. Paiement reçu par carte bancaire via Stripe. Merci pour leur confiance.`
      );

      await brevo(FINANCE, 'Vera — Feelsyst.com', clientEmail,
        `Votre facture Feelsyst.com — ${invoiceNum}`,
        invoiceText
      );

      // Vera notifie le fondateur
      await brevo(FINANCE, 'Vera — Feelsyst.com', FONDATEUR,
        `Nouveau paiement ${amount}€ — ${plan} — Feelsyst.com`,
        `Nouveau client payant !\n\nClient: ${clientEmail}\nPlan: ${plan}\nMontant: ${amount}€\nDate: ${date}\nFacture: ${invoiceNum}\n\nEmail de bienvenue et facture envoyés automatiquement.\n\nVera — CFO Feelsyst.com`
      );
    }

    if (event === 'customer.subscription.deleted') {
      await brevo(LUMI, 'Lumi — Feelsyst.com', FONDATEUR,
        `Résiliation abonnement — ${clientEmail}`,
        `Un client a résilié son abonnement.\n\nEmail: ${clientEmail}\nDate: ${date}\n\nVera — Feelsyst.com`
      );
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
