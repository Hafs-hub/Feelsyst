// RÉPONSE AUTOMATIQUE REX — quand un prospect répond à rex@feelsyst.com
const BREVO_KEY = process.env.BREVO_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const REX = process.env.REX_EMAIL;

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
    const senderName = body.from?.name || senderEmail.split('@')[0] || 'Prospect';
    const emailContent = body.text || body.html || body.content || '';
    const subject = body.subject || 'Re: Feelsyst.com';

    if (!senderEmail || senderEmail.includes('feelsyst.com')) {
      return res.status(200).json({ ok: true });
    }

    // Rex génère réponse intelligente
    const reply = await claude(
      `Tu es Rex, agent commercial senior de Feelsyst.com. Tu réponds aux emails prospects de façon naturelle et engageante. Tu analyses leur message et tu réponds de façon personnalisée pour avancer vers une collaboration. Jamais d'appel téléphonique ni de visio proposés. Tout par email. Signe Rex — Feelsyst.com.`,
      `Le prospect ${senderName} (${senderEmail}) a répondu avec :\n\n"${emailContent}"\n\nRédige une réponse naturelle et professionnelle qui répond précisément à leur message, montre de l'intérêt pour leur situation et avance vers une proposition commerciale adaptée.`
    );

    // Rex répond au prospect
    await brevo(REX, 'Rex — Feelsyst.com', senderEmail, `Re: ${subject}`, reply);

    // Notifier le fondateur
    await brevo(REX, 'Rex — Feelsyst.com', FONDATEUR,
      `Rex a répondu à ${senderName} — ${senderEmail}`,
      `Message reçu de ${senderName}:\n"${emailContent}"\n\nRéponse de Rex:\n${reply}\n\n---\nFeelsyst.com`
    );

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
