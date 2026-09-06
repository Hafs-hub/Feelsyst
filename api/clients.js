// api/admin/clients.js — Liste clients admin — Migré Supabase
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'feelsyst_admin_2025';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth admin
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  // ── GET : liste tous les clients ──
  if (req.method === 'GET') {
    const { plan, status, limit = 100 } = req.query;

    let query = supabase
      .from('clients')
      .select(`
        id, email, full_name, company_name, sector, plan, status,
        created_at, last_login_at, trial_ends_at,
        subscription_start, stripe_customer_id, notes
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (plan) query = query.eq('plan', plan);
    if (status) query = query.eq('status', status);

    const { data: clients, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Stats rapides
    const stats = {
      total: clients.length,
      byPlan: clients.reduce((acc, c) => {
        acc[c.plan] = (acc[c.plan] || 0) + 1;
        return acc;
      }, {}),
      active: clients.filter(c => c.status === 'active').length,
      trial: clients.filter(c => c.status === 'trial').length,
      cancelled: clients.filter(c => c.status === 'cancelled').length,
    };

    return res.status(200).json({ success: true, clients, stats, total: clients.length });
  }

  // ── PATCH : modifier un client (plan, statut, notes) ──
  if (req.method === 'PATCH') {
    const { id, plan, status, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id client requis' });

    const updates = {};
    if (plan) updates.plan = plan;
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Logger l'action admin
    await supabase.from('admin_logs').insert([{
      action: 'client.updated',
      target_type: 'client',
      target_id: id,
      details: updates,
    }]);

    return res.status(200).json({ success: true, client: data });
  }

  // ── POST : test d'envoi email Brevo (diagnostic) ──
  if (req.method === 'POST') {
    const { action, email } = req.body || {};

    if (action === 'test_email') {
      const BREVO_KEY = process.env.BREVO_API_KEY;
      const results = {
        brevo_key_present: !!BREVO_KEY,
        brevo_key_length: BREVO_KEY ? BREVO_KEY.length : 0,
        target_email: email || 'contact@feelsyst.com',
        timestamp: new Date().toISOString(),
      };

      if (!BREVO_KEY) {
        return res.status(200).json({ ...results, success: false, error: 'BREVO_API_KEY absente des variables Vercel' });
      }

      try {
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
          body: JSON.stringify({
            sender: { name: 'Feelsyst Test', email: 'contact@feelsyst.com' },
            to: [{ email: email || 'contact@feelsyst.com', name: 'Test Admin' }],
            subject: '✅ Test email Feelsyst — Brevo fonctionne',
            textContent: `Test d'envoi depuis Feelsyst.

Date: ${new Date().toISOString()}
Serveur: Vercel
BREVO_KEY présente: oui

Si vous recevez cet email, la configuration Brevo est correcte.`,
          }),
        });

        const brevoData = await brevoRes.json();
        results.brevo_status = brevoRes.status;
        results.brevo_response = brevoData;
        results.success = brevoRes.ok;

        if (!brevoRes.ok) {
          results.error = `Brevo ${brevoRes.status}: ${JSON.stringify(brevoData)}`;
        }

        return res.status(200).json(results);
      } catch (e) {
        return res.status(200).json({ ...results, success: false, error: e.message, stack: e.stack?.slice(0, 200) });
      }
    }

    return res.status(400).json({ error: 'Action inconnue' });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
