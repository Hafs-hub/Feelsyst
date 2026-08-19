// api/proxy-ai.js — Proxy sécurisé vers l'API Anthropic — Amélioré
// La clé CLAUDE_API_KEY reste côté serveur — jamais exposée au client

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Vérifie que le token appartient à un client actif et retourne son id
async function getClientFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const { data: session } = await supabase
    .from('sessions')
    .select('client_id, expires_at')
    .eq('token', token)
    .single();

  if (!session || new Date() > new Date(session.expires_at)) return null;

  const { data: client } = await supabase
    .from('clients')
    .select('id, plan, status, trial_ends_at')
    .eq('id', session.client_id)
    .single();

  return client || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const ANTHROPIC_KEY = process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Clé API non configurée.' });
  }

  // Vérification du client connecté
  const client = await getClientFromToken(req);
  if (!client) {
    return res.status(401).json({ error: 'Non authentifié. Connectez-vous pour utiliser les agents.' });
  }

  // Vérifier que le compte est actif
  if (client.status === 'suspended' || client.status === 'cancelled') {
    return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
  }

  // Vérifier expiration trial
  if (client.plan === 'trial' && client.trial_ends_at) {
    if (new Date() > new Date(client.trial_ends_at)) {
      return res.status(403).json({
        error: 'Période d\'essai terminée. Choisissez un plan pour continuer.',
        trialExpired: true,
      });
    }
  }

  const { system, messages, max_tokens = 1000, agent = 'aria' } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages[] requis' });
  }

  try {
    // Récupérer le system prompt depuis Supabase si non fourni
    let systemPrompt = system;
    if (!systemPrompt) {
      const { data: config } = await supabase
        .from('agent_configs')
        .select('system_prompt')
        .eq('agent', agent)
        .single();
      systemPrompt = config?.system_prompt || '';
    }

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

    // Tracer l'usage en arrière-plan (non bloquant)
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    const cost = (tokensIn * 0.000003) + (tokensOut * 0.000015);

    supabase.from('usage').upsert([{
      client_id: client.id,
      agent,
      date: new Date().toISOString().split('T')[0],
      messages_count: 1,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      estimated_cost: cost,
    }], {
      onConflict: 'client_id,agent,date',
      ignoreDuplicates: false,
    }).then(({ error }) => {
      if (error) {
        // Fallback : insert simple
        supabase.from('usage').insert([{
          client_id: client.id,
          agent,
          date: new Date().toISOString().split('T')[0],
          messages_count: 1,
          tokens_input: tokensIn,
          tokens_output: tokensOut,
          estimated_cost: cost,
        }]).catch(() => {});
      }
    });

    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy AI error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
