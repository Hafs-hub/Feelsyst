// api/proxy-ai.js — Proxy sécurisé vers Anthropic — Optimisé v3
// Réduit de 4 appels Supabase séquentiels à 2 appels parallèles

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

  const ANTHROPIC_KEY = process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Clé API non configurée.' });

  // ── Étape 1 : vérifier le token (1 seul appel au lieu de 2) ──
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });

  const { data: session } = await supabase
    .from('sessions')
    .select('client_id, expires_at, clients(id, plan, status, trial_ends_at, full_name, company_name, sector)')
    .eq('token', token)
    .single();

  if (!session || new Date() > new Date(session.expires_at)) {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }

  const client = session.clients;
  if (!client) return res.status(401).json({ error: 'Client introuvable.' });

  // Vérifications compte
  if (client.status === 'suspended' || client.status === 'cancelled') {
    return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
  }
  if (client.plan === 'trial' && client.trial_ends_at) {
    if (new Date() > new Date(client.trial_ends_at)) {
      return res.status(403).json({
        error: 'Période d\'essai terminée. Choisissez un plan pour continuer.',
        trialExpired: true,
      });
    }
  }

  const { system, messages, max_tokens = 1000, agent = 'aria', userContext = {} } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages[] requis' });
  }

  try {
    // ── Étape 2 : récupérer agent_config en parallèle avec l'appel Anthropic ──
    // On ne fait qu'1 appel Supabase ici (agent_configs) — tout le reste vient de session.clients
    let systemPrompt = system;

    if (!systemPrompt) {
      const { data: config } = await supabase
        .from('agent_configs')
        .select('system_prompt')
        .eq('agent', agent)
        .single();
      systemPrompt = config?.system_prompt || '';
    }

    // Construire le contexte client depuis les données déjà récupérées (0 appel supplémentaire)
    const company   = userContext.company   || client.company_name || '';
    const sector    = userContext.sector    || client.sector       || '';
    const firstname = userContext.firstname || (client.full_name || '').split(' ')[0] || '';
    const plan      = userContext.plan      || client.plan         || '';

    if (company || sector || firstname) {
      const ctx = [
        firstname ? `Prénom : ${firstname}` : '',
        company   ? `Entreprise : ${company}` : '',
        sector    ? `Secteur : ${sector}` : '',
        plan      ? `Plan : ${plan}` : '',
      ].filter(Boolean).join(' | ');

      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\nContexte client : ${ctx}`
        : `Contexte client : ${ctx}`;
    }

    // ── Étape 3 : appel Anthropic ──
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Anthropic' });
    }

    // ── Tracer l'usage en arrière-plan (non bloquant) ──
    const tokensIn  = data.usage?.input_tokens  || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    const cost = (tokensIn * 0.000003) + (tokensOut * 0.000015);

    // Tracer l'usage — fire and forget sans bloquer la réponse
    const usageData = {
      client_id: client.id, agent,
      date: new Date().toISOString().split('T')[0],
      messages_count: 1, tokens_input: tokensIn,
      tokens_output: tokensOut, estimated_cost: cost,
    };
    supabase.from('usage').upsert([usageData], {
      onConflict: 'client_id,agent,date', ignoreDuplicates: false
    }).then(({ error }) => {
      if (error) {
        supabase.from('usage').insert([usageData]).then(() => {}).catch(() => {});
      }
    }).catch(() => {});

    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy AI error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
