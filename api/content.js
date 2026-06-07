// WORKFLOW 4 — Nova génère contenu LinkedIn (Mardi + Jeudi 10h)
const BREVO_KEY = process.env.BREVO_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const CONTACT = process.env.CONTACT_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const date = new Date().toLocaleDateString('fr-FR');
    const day = new Date().toLocaleDateString('fr-FR', { weekday: 'long' });

    // Nova génère le post LinkedIn
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        system: 'Tu es Nova, CMO de Feelsyst.com. Tu crees du contenu LinkedIn percutant pour les PME en francais. Style expert et accessible. Signe Nova — CMO Feelsyst.com.',
        messages: [{
          role: 'user',
          content: `Cree un post LinkedIn optimise sur le marketing autonome par IA pour les PME françaises. Date: ${date}. Max 250 mots. Accroche forte. Question d engagement finale. 3 hashtags pertinents. Format pret a copier-coller.`
        }]
      })
    });
    const d = await r.json();
    const post = d.content?.[0]?.text || 'Erreur generation post';

    // Brevo envoie le post au fondateur
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
      body: JSON.stringify({
        sender: { name: 'Nova — CMO Feelsyst.com', email: CONTACT },
        to: [{ email: FONDATEUR }],
        subject: `Post LinkedIn ${day} — A publier maintenant`,
        textContent: `Voici le post LinkedIn genere par Nova pour aujourd hui:\n\n${post}\n\n---\nCopie ce texte et publie-le sur LinkedIn.\nNova — CMO Feelsyst.com`
      })
    });

    return res.status(200).json({ success: true, day });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
