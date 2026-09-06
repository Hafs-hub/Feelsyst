// api/password.js — Gestion mot de passe (PUT = changer, cohérent avec dashboard)
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPassword(pwd) {
  return crypto.createHash('sha256')
    .update(pwd + (process.env.PASSWORD_SALT || 'feelsyst2025'))
    .digest('hex');
}

async function getClientFromToken(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: session } = await supabase
    .from('sessions').select('client_id, expires_at').eq('token', token).single();
  if (!session || new Date() > new Date(session.expires_at)) return null;
  const { data: client } = await supabase
    .from('clients').select('*').eq('id', session.client_id).single();
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

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'Nouveau mot de passe trop court (min. 8 caractères)' });
  if (client.password_hash !== hashPassword(currentPassword))
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

  const { error } = await supabase
    .from('clients')
    .update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() })
    .eq('id', client.id);

  if (error) return res.status(500).json({ error: 'Erreur mise à jour' });
  return res.status(200).json({ success: true, message: 'Mot de passe modifié avec succès' });
};
