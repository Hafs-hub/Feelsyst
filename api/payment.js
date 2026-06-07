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
      // Lumi envoie email de bienvenue
      const welcome = await claude(
        'Tu es Lumi, support de Feelsyst.com. Tu accueilles les nouveaux clients avec chaleur et professionnalisme. Signe Lumi — Feelsyst.com.',
        `Nouveau client vient de payer ${amount}€. Email: ${clientEmail}. Date: ${date}. Rédige un email de bienvenue chaleureux et professionnel en français.`
      );

      await brevo(LUMI, 'Lumi — Feelsyst.com', clientEmail, 'Bienvenue chez Feelsyst.com', welcome);

      // Vera notifie le fondateur
      await brevo(FINANCE, 'Vera — Feelsyst.com', FONDATEUR,
        `Nouveau paiement ${amount}€ — Feelsyst.com`,
        `Nouveau paiement reçu !\n\nClient: ${clientEmail}\nMontant: ${amount}€\nDate: ${date}\n\nVera — CFO Feelsyst.com`
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
