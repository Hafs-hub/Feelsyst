// api/me.js — Récupérer les infos de l'utilisateur connecté — Migré Supabase
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getClientFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  // Récupérer la session depuis Supabase
  const { data: session } = await supabase
    .from('sessions')
    .select('client_id, expires_at')
    .eq('token', token)
    .single();

  if (!session) return null;

  // Vérifier expiration du token
  if (new Date() > new Date(session.expires_at)) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }

  // Récupérer le client
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', session.client_id)
    .single();

  return client || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const client = await getClientFromToken(req);
  if (!client) return res.status(401).json({ error: 'Non authentifié' });

  const nameParts = (client.full_name || '').split(' ');
  const firstname = nameParts[0] || '';
  const lastname = nameParts.slice(1).join(' ') || '';

  return res.status(200).json({
    success: true,
    user: {
      id: client.id,
      firstname,
      lastname,
      email: client.email,
      company: client.company_name,
      sector: client.sector,
      plan: client.plan,
      status: client.status,
      trialEndsAt: client.trial_ends_at,
      createdAt: client.created_at,
      lastLogin: client.last_login_at,
    },
  });
};
