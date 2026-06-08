// LUMI CHAT — Chatbot temps réel sur feelsyst.com
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const BREVO_KEY = process.env.BREVO_API_KEY;
const FONDATEUR = process.env.FONDATEUR_EMAIL;
const LUMI = process.env.LUMI_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { message, email, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis' });

    // Build conversation history
    const messages = [
      ...history.slice(-6), // Keep last 6 messages for context
      { role: 'user', content: message }
    ];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: `Tu es Lumi, assistante support de Feelsyst.com. Tu réponds aux questions des visiteurs et clients sur le site. Tu es chaleureuse, concise et utile. Services : Pack Starter 49€/mois, Pack Pro 149€/mois, Pack Illimité 299€/mois, Agent IA 599€, Audit Marketing 299€. Si quelqu'un veut souscrire, dirige-les vers les boutons de la page. Si tu ne peux pas répondre, propose d'envoyer un email à contact@feelsyst.com. Réponds toujours en français. Maximum 3-4 phrases par réponse. Signe Lumi.`,
        messages
      })
    });

    const d = await r.json();
    const reply = d.content?.[0]?.text || 'Je suis désolée, je rencontre un problème technique. Contactez-nous à contact@feelsyst.com';

    // Si email fourni, notifier le fondateur
    if (email) {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
        body: JSON.stringify({
          sender: { name: 'Lumi — Feelsyst.com', email: LUMI },
          to: [{ email: FONDATEUR }],
          subject: `Chat Lumi — Nouveau visiteur ${email}`,
          textContent: `Conversation chat sur feelsyst.com\n\nVisiteur: ${email}\nMessage: ${message}\nRéponse Lumi: ${reply}`
        })
      });
    }

    return res.status(200).json({ reply, success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message, reply: 'Une erreur est survenue. Contactez contact@feelsyst.com' });
  }
}
