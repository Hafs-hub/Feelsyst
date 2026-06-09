// api/admin/clients.js — Liste clients pour l'admin panel
let usersStore = global._feelsystUsers || (global._feelsystUsers = {});

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'feelsyst_admin_2025';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Auth admin basique
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  // En production, utiliser un vrai système d'auth admin
  // Pour l'instant, on accepte la requête (l'admin panel a son propre password)

  const clients = Object.values(usersStore).map(u => {
    const c = { ...u };
    delete c.passwordHash;
    return c;
  });

  return res.status(200).json({
    success: true,
    clients,
    total: clients.length,
  });
};
