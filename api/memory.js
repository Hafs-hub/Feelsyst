// api/memory.js — Mémoire partagée entre agents (concept Kimi K3 adapté)
// GET  → liste les mémoires du client
// POST → ajoute une mémoire
// DELETE → supprime une mémoire

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getClientFromToken(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: session } = await supabase
    .from('sessions')
    .select('client_id, expires_at')
    .eq('token', token)
    .single();
  if (!session || new Date() > new Date(session.expires_at)) return null;
  return session.client_id;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = await getClientFromToken(req);
  if (!clientId) return res.status(401).json({ error: 'Non authentifié' });

  // ── GET : liste des mémoires ──
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('shared_memory')
      .select('id, category, content, importance, created_at')
      .eq('client_id', clientId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, memories: data });
  }

  // ── POST : ajouter une mémoire ──
  if (req.method === 'POST') {
    const { category = 'autre', content, importance = 3, source_agent } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ error: 'content requis' });

    const { data, error } = await supabase
      .from('shared_memory')
      .insert([{ client_id: clientId, category, content: content.trim(), importance, source_agent }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, memory: data });
  }

  // ── DELETE : supprimer une mémoire ──
  if (req.method === 'DELETE') {
    const id = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'id requis' });

    const { error } = await supabase
      .from('shared_memory')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId); // sécurité : le client ne peut supprimer que ses propres mémoires

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
