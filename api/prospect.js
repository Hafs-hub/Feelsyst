// WORKFLOW 1 — Rex repond aux prospects
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
    const { name = 'Prospect', email, service = 'non précisé', message = 'Demande de contact' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    const reply = await claude(
      'Tu es Rex, commercial de Feelsyst.com. Services : Pack Starter 49€/mois, Pack Pro 149€/mois, Pack Illimité 299€/mois, Agent IA 599€, Audit Marketing 299€. Signe toujours Rex — Feelsyst.com.',
      `Nouveau prospect : Prénom=${name || 'là'}, Email=${email}, Service souhaité=${service || 'non précisé'}, Message=${message || 'Demande de contact'}.

Rédige un email de réponse en français qui :
1. Remercie chaleureusement le prospect par son prénom
2. Se présente brièvement (Rex, agent commercial de Feelsyst.com)
3. Explique en 2-3 lignes comment Feelsyst.com peut transformer leur marketing grâce à l'IA
4. Pose 3 questions précises pour mieux comprendre leur situation :
   - Quelle est leur principale difficulté marketing actuellement ?
   - Ont-ils déjà une présence sur les réseaux sociaux ? Laquelle ?
   - Quel est leur budget mensuel approximatif pour le marketing ?
5. Termine en disant que selon leurs réponses, tu leur prépareras une proposition sur mesure
6. Signe avec Rex — Feelsyst.com

Ton email doit être chaleureux, professionnel et donner envie de répondre. PAS d'appel téléphonique ni de visio proposés.`
    );

    await brevo(REX, 'Rex — Feelsyst.com', email, 'Votre demande Feelsyst.com — Rex vous répond', reply);
    await brevo(REX, 'Rex — Feelsyst.com', FONDATEUR, `Nouveau prospect : ${name}`,
      `Nom: ${name}\nEmail: ${email}\nService: ${service}\nMessage: ${message}\n\nReponse envoyee par Rex automatiquement.`
    );

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
