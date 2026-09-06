// api/account.js — Gestion compte (DELETE = suppression RGPD)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getClientFromToken(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: session } = await supabase
    .from('sessions').select('client_id, expires_at').eq('token', token).single();
  if (!session || new Date() > new Date(session.expires_at)) return null;
  const { data: client } = await supabase
    .from('clients').select('id, email, plan').eq('id', session.client_id).single();
  return client || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Méthode non autorisée' });

  const client = await getClientFromToken(req);
  if (!client) return res.status(401).json({ error: 'Non authentifié' });

  // Supprimer dans l'ordre (CASCADE gère les enfants)
  await supabase.from('sessions').delete().eq('client_id', client.id);
  await supabase.from('conversations').delete().eq('client_id', client.id);
  await supabase.from('shared_memory').delete().eq('client_id', client.id);
  await supabase.from('agent_configs_client').delete().eq('client_id', client.id);
  await supabase.from('usage').delete().eq('client_id', client.id);

  const { error } = await supabase.from('clients').delete().eq('id', client.id);
  if (error) return res.status(500).json({ error: 'Erreur suppression compte' });

  console.log(`🗑 Compte supprimé RGPD: ${client.email}`);
  return res.status(200).json({ success: true, message: 'Compte supprimé définitivement' });
};
