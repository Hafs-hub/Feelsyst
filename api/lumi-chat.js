// api/lumi-chat.js — Lumi agent support — Amélioré Supabase
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

  // Récupérer le client connecté si token fourni (optionnel)
  let clientId = null;
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token) {
    const { data: session } = await supabase
      .from('sessions')
      .select('client_id')
      .eq('token', token)
      .single();
    if (session) clientId = session.client_id;
  }

  // Construction du contexte client
  const clientContext = [
    userContext.company  ? `Entreprise: ${userContext.company}`  : '',
    userContext.sector   ? `Secteur: ${userContext.sector}`      : '',
    userContext.plan     ? `Plan: ${userContext.plan}`           : '',
    userContext.firstname? `Prénom: ${userContext.firstname}`    : '',
  ].filter(Boolean).join(', ');

  try {
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
        system: `Tu es Lumi, l'agente support client IA de Feelsyst. Tu réponds en français, avec bienveillance et efficacité. Tu mémorises le contexte de la conversation pour personnaliser tes réponses. ${clientContext ? 'Contexte client : ' + clientContext : ''} Tu connais parfaitement les agents Feelsyst (Aria, Nova, Rex, Vera, Lumi), les plans (Découverte gratuit 7j, Starter 29€/mois, Pro 79€/mois, Illimité 179€/mois, Agent custom 399€) et le tableau de bord client. Tu guides vers le bon agent selon la demande. Si problème technique grave, tu proposes de contacter contact@feelsyst.com.`,
        messages,
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Désolée, une erreur est survenue. Réessayez.';
    const updatedHistory = [...messages, { role: 'assistant', content: reply }];

    // ── Suivi en arrière-plan (non bloquant) ──
    const tokensIn  = data.usage?.input_tokens  || 0;
    const tokensOut = data.usage?.output_tokens || 0;

    Promise.all([
      // 1. Tracer l'usage
      clientId ? supabase.from('usage').insert([{
        client_id: clientId,
        agent: 'lumi',
        date: new Date().toISOString().split('T')[0],
        messages_count: 1,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        estimated_cost: (tokensIn * 0.000003) + (tokensOut * 0.000015),
      }]) : Promise.resolve(),

      // 2. Créer/mettre à jour un ticket support si c'est le 1er message
      history.length === 0 ? supabase.from('support_tickets').insert([{
        client_id: clientId,
        email: userContext.email || 'inconnu@feelsyst.com',
        subject: message.slice(0, 80), // 80 premiers caractères comme sujet
        body: message,
        channel: 'chat',
        status: 'open',
        assigned_agent: 'lumi',
        lumi_response: reply,
      }]) : Promise.resolve(),
    ]).catch(e => console.error('Supabase background error:', e));

    return res.status(200).json({
      success: true,
      message: reply,
      updatedHistory,
    });

  } catch (error) {
    console.error('Lumi chat error:', error);
    return res.status(500).json({ error: 'Erreur de traitement' });
  }
};
