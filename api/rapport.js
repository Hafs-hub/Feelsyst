// WORKFLOW 3 — Aria envoie le rapport hebdomadaire (Lundi 8h)
const BREVO_KEY = process.env.BREVO_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const ARIA = process.env.ARIA_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Aria génère le rapport via Claude
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: 'Tu es Aria, CEO de Feelsyst.com. Tu generes des rapports hebdomadaires concis et actionnables en francais. Tu coordonnes Rex (prospection), Nova (contenu), Lumi (support), Vera (finance). Signe Aria — CEO Feelsyst.com.',
        messages: [{
          role: 'user',
          content: `Genere le rapport hebdomadaire de Feelsyst.com pour le ${date}. Inclure: 1) Bilan de la semaine 2) Actions de chaque agent 3) Priorites pour la semaine prochaine 4) Recommandations strategiques. Sois directe et actionnable.`
        }]
      })
    });
    const d = await r.json();
    const rapport = d.content?.[0]?.text || 'Erreur generation rapport';

    // Brevo envoie le rapport
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
      body: JSON.stringify({
        sender: { name: 'Aria — CEO Feelsyst.com', email: ARIA },
        to: [{ email: FONDATEUR }],
        subject: `Rapport hebdomadaire Feelsyst.com — ${date}`,
        textContent: rapport
      })
    });

    return res.status(200).json({ success: true, date });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
