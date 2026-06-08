// LUMI REPLY — Réponse automatique aux emails clients
const BREVO_KEY = process.env.BREVO_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const LUMI = process.env.LUMI_EMAIL;

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
    const senderEmail = body.from?.email || body.sender || '';
    const senderName = body.from?.name || senderEmail.split('@')[0] || 'Client';
    const emailContent = body.text || body.html || body.content || '';
    const subject = body.subject || 'Re: Support Feelsyst.com';

    if (!senderEmail || senderEmail.includes('feelsyst.com')) {
      return res.status(200).json({ ok: true });
    }

    // Lumi génère une réponse empathique et professionnelle
    const reply = await claude(
      `Tu es Lumi, responsable support de Feelsyst.com. Tu réponds aux clients existants avec empathie, chaleur et professionnalisme. Tu résous les problèmes efficacement. Tu ne promets jamais de remboursement sans validation. Si la demande nécessite une action technique, tu dis que tu transmets à l'équipe et que cela sera traité sous 24h. Signe toujours Lumi — Support Feelsyst.com.`,
      `Le client ${senderName} (${senderEmail}) a envoyé ce message :\n\n"${emailContent}"\n\nRédige une réponse professionnelle et empathique qui : 1) Accuse réception de leur message 2) Répond précisément à leur question ou problème 3) Propose une solution concrète 4) Rassure le client 5) Invite à recontacter si besoin.`
    );

    // Lumi répond au client
    await brevo(LUMI, 'Lumi — Feelsyst.com', senderEmail, `Re: ${subject}`, reply);

    // Notifier le fondateur
    await brevo(LUMI, 'Lumi — Feelsyst.com', FONDATEUR,
      `Lumi a répondu à ${senderName}`,
      `Message de ${senderName} (${senderEmail}) :\n"${emailContent}"\n\nRéponse de Lumi :\n${reply}\n\n---\nFeelsyst.com`
    );

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
