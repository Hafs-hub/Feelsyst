// api/profile.js — Mise à jour profil utilisateur — Migré Supabase
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getClientFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const { data: session } = await supabase
    .from('sessions')
    .select('client_id, expires_at')
    .eq('token', token)
    .single();

  if (!session) return null;
  if (new Date() > new Date(session.expires_at)) return null;

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', session.client_id)
    .single();

  return client || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Méthode non autorisée' });

  const client = await getClientFromToken(req);
  if (!client) return res.status(401).json({ error: 'Non authentifié' });

  const { firstname, lastname, company, sector } = req.body || {};

  // Construire les champs à mettre à jour
  const updates = {};
  if (firstname || lastname) {
    const currentParts = (client.full_name || '').split(' ');
    const newFirst = firstname?.trim() || currentParts[0] || '';
    const newLast = lastname?.trim() || currentParts.slice(1).join(' ') || '';
    updates.full_name = `${newFirst} ${newLast}`.trim();
  }
  if (company) updates.company_name = company.trim();
  if (sector) updates.sector = sector;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
  }

  const { data: updated, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', client.id)
    .select()
    .single();

  if (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Erreur mise à jour profil' });
  }

  const nameParts = (updated.full_name || '').split(' ');

  return res.status(200).json({
    success: true,
    user: {
      id: updated.id,
      firstname: nameParts[0] || '',
      lastname: nameParts.slice(1).join(' ') || '',
      email: updated.email,
      company: updated.company_name,
      sector: updated.sector,
      plan: updated.plan,
      status: updated.status,
    },
  });
};
