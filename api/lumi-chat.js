// api/lumi-chat.js — Lumi agent support avec mémoire client
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API non configurée' });

  const { message, history = [], userContext = {} } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Message requis' });

  // Construction du contexte client
  const clientContext = [
    userContext.company ? `Entreprise: ${userContext.company}` : '',
    userContext.sector ? `Secteur: ${userContext.sector}` : '',
    userContext.plan ? `Plan: ${userContext.plan}` : '',
    userContext.firstname ? `Prénom: ${userContext.firstname}` : '',
  ].filter(Boolean).join(', ');

  try {
    // Garder les 10 derniers messages pour la mémoire
    const messages = [
      ...history.slice(-10),
      { role: 'user', content: message },
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `Tu es Lumi, l'agente support client IA de Feelsyst. Tu réponds en français, avec bienveillance et efficacité. Tu mémorises le contexte de la conversation pour personnaliser tes réponses. ${clientContext ? 'Contexte client : ' + clientContext : ''} Tu connais parfaitement les 5 agents Feelsyst (Aria, Nova, Rex, Vera, Lumi), les plans (Découverte gratuit 7j, Starter 29€/mois, Pro 79€/mois, Illimité 179€/mois, Agent custom 399€) et le tableau de bord client. Tu guilles vers le bon agent selon la demande. Si problème technique grave, tu proposes de contacter contact@feelsyst.com.`,
        messages,
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Désolée, une erreur est survenue. Réessayez.';

    return res.status(200).json({
      success: true,
      message: reply,
      updatedHistory: [...messages, { role: 'assistant', content: reply }],
    });
  } catch (error) {
    console.error('Lumi chat error:', error);
    return res.status(500).json({ error: 'Erreur de traitement' });
  }
};
