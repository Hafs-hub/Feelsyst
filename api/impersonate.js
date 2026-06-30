// api/admin/impersonate.js — Génère un token de session pour se connecter en tant que client
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'feelsyst_admin_2025';

function generateToken(email) {
  return crypto.createHash('sha256').update(email + Date.now() + Math.random()).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Non autorisé' });

  const { client_id } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'client_id requis' });

  try {
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, email, full_name, company_name, plan, status')
      .eq('id', client_id)
      .single();

    if (error || !client) return res.status(404).json({ error: 'Client introuvable' });

    // Génère une session courte (2h) marquée comme impersonation
    const impersonationToken = generateToken(client.email);

    await supabase.from('sessions').insert([{
      token: impersonationToken,
      client_id: client.id,
      expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // 2h seulement
    }]);

    // Logger l'action — traçabilité obligatoire pour ce type d'action sensible
    await supabase.from('admin_logs').insert([{
      action: 'client.impersonated',
      target_type: 'client',
      target_id: client.id,
      details: { email: client.email },
    }]);

    return res.status(200).json({
      success: true,
      token: impersonationToken,
      client: {
        id: client.id,
        email: client.email,
        full_name: client.full_name,
        company_name: client.company_name,
        plan: client.plan,
      },
      expiresIn: '2 heures',
    });

  } catch (err) {
    console.error('Impersonate error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
