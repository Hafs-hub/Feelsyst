// api/proxy-ai.js — Proxy Anthropic — v4
// Intègre : shared_memory (Kimi K3), matrice capacités agents, CommonJS

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Matrice des capacités agents (concept Kimi K3 adapté) ──
const AGENT_CAPS = {
  aria:  { readImg: false, memory: true,  history: true  },
  nova:  { readImg: true,  memory: true,  history: true  },
  rex:   { readImg: false, memory: true,  history: true  },
  vera:  { readImg: true,  memory: true,  history: true  }, // peut lire des factures/tableaux
  lumi:  { readImg: true,  memory: true,  history: true  },
  lex:   { readImg: true,  memory: true,  history: true  }, // peut lire des contrats
  pulse: { readImg: true,  memory: true,  history: true  }, // peut analyser des graphiques
  atlas: { readImg: false, memory: true,  history: true  },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const ANTHROPIC_KEY = process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Clé API non configurée.' });

  // ── Auth : 1 seul appel Supabase (sessions + clients en JOIN) ──
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
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

  if (client.status === 'suspended' || client.status === 'cancelled') {
    return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
  }
  if (client.plan === 'trial' && client.trial_ends_at) {
    if (new Date() > new Date(client.trial_ends_at)) {
      return res.status(403).json({ error: 'Période d\'essai terminée.', trialExpired: true });
    }
  }

  const { system, messages, max_tokens = 1000, agent = 'aria', userContext = {} } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages[] requis' });
  }

  const caps = AGENT_CAPS[agent] || { readImg: false, memory: true, history: true };

  // Vérifier que le contenu image n'est envoyé qu'à un agent capable
  const hasImage = messages.some(m =>
    Array.isArray(m.content) && m.content.some(c => c.type === 'image')
  );
  if (hasImage && !caps.readImg) {
    return res.status(400).json({
      error: `L'agent ${agent} ne peut pas analyser d'images. Utilisez Nova, Vera, Lex ou Pulse.`
    });
  }

  try {
    // ── System prompt + contexte entreprise + shared_memory ──
    let systemPrompt = system;

    if (!systemPrompt) {
      const { data: config } = await supabase
        .from('agent_configs')
        .select('system_prompt')
        .eq('agent', agent)
        .eq('is_active', true)
        .single();
      systemPrompt = config?.system_prompt || '';
    }

    // Contexte client de base
    const company   = userContext.company   || client.company_name || '';
    const sector    = userContext.sector    || client.sector       || '';
    const firstname = userContext.firstname || (client.full_name || '').split(' ')[0] || '';
    const plan      = userContext.plan      || client.plan         || '';

    let contextLines = [];
    if (firstname) contextLines.push(`Prénom dirigeant : ${firstname}`);
    if (company)   contextLines.push(`Entreprise : ${company}`);
    if (sector)    contextLines.push(`Secteur : ${sector}`);
    if (plan)      contextLines.push(`Plan : ${plan}`);

    // ── Shared memory (concept Kimi K3) ──
    if (caps.memory) {
      const { data: memories } = await supabase
        .from('shared_memory')
        .select('content, category, importance')
        .eq('client_id', client.id)
        .order('importance', { ascending: false })
        .limit(10);

      if (memories && memories.length > 0) {
        const memStr = memories
          .map(m => `[${m.category}] ${m.content}`)
          .join('\n');
        contextLines.push(`\nMémoire entreprise :\n${memStr}`);
      }
    }

    // Injecter le contexte dans le system prompt
    if (contextLines.length > 0 && systemPrompt) {
      systemPrompt = `${systemPrompt}\n\nContexte client :\n${contextLines.join('\n')}`;
    } else if (contextLines.length > 0) {
      systemPrompt = `Contexte client :\n${contextLines.join('\n')}`;
    }

    // ── Appel Anthropic ──
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
      console.error('Anthropic error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Anthropic' });
    }

    // ── Sauvegarder dans conversations (async, non bloquant) ──
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const replyText   = data.content?.[0]?.text || '';

    if (lastUserMsg && replyText) {
      const userContent  = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '[Media]';
      const sessionId    = token.slice(0, 16);

      supabase.from('conversations').insert([
        { client_id: client.id, agent_id: agent, role: 'user',      content: userContent, session_id: sessionId },
        { client_id: client.id, agent_id: agent, role: 'assistant', content: replyText,   session_id: sessionId },
      ]).then(() => {}).catch(() => {});
    }

    // ── Tracer l'usage (async) ──
    const tokensIn  = data.usage?.input_tokens  || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    const cost = (tokensIn * 0.000003) + (tokensOut * 0.000015);

    const usageData = {
      client_id: client.id, agent,
      date: new Date().toISOString().split('T')[0],
      messages_count: 1, tokens_input: tokensIn,
      tokens_output: tokensOut, estimated_cost: cost,
    };
    supabase.from('usage').upsert([usageData], {
      onConflict: 'client_id,agent,date', ignoreDuplicates: false
    }).then(() => {}).catch(() => {});

    return res.status(200).json({
      ...data,
      agent_caps: caps, // retourner les capacités au frontend
    });

  } catch (error) {
    console.error('Proxy AI error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
