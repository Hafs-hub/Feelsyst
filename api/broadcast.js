// api/admin/broadcast.js — Envoi d'emails groupés depuis l'admin panel
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_TOKEN = process.env.ADMIN_SECRET || 'feelsyst_admin_2025';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Non autorisé' });

  const { segment, plan, status, subject, body } = req.body || {};
  if (!subject || !body) {
    return res.status(400).json({ error: 'subject et body requis' });
  }

  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY manquante' });

  try {
    // Construire la requête selon le segment
    let query = supabase.from('clients').select('id, email, full_name, company_name, plan, status');

    if (plan) query = query.eq('plan', plan);
    if (status) query = query.eq('status', status);

    if (segment === 'trial_expiring') {
      query = supabase
        .from('clients')
        .select('id, email, full_name, company_name, plan, status, trial_ends_at')
        .eq('status', 'trial')
        .lte('trial_ends_at', new Date(Date.now() + 3 * 86400000).toISOString());
    }

    const { data: recipients, error } = await query;
    if (error) throw error;

    if (!recipients?.length) {
      return res.status(200).json({ success: true, sent: 0, message: 'Aucun destinataire pour ce segment' });
    }

    let sent = 0;
    const errors = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (const client of recipients) {
      try {
        const firstname = (client.full_name || '').split(' ')[0] || '';
        const personalizedBody = body
          .replace(/\{\{prenom\}\}/g, firstname)
          .replace(/\{\{entreprise\}\}/g, client.company_name || '')
          .replace(/\{\{plan\}\}/g, client.plan || '');

        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
          body: JSON.stringify({
            sender: { name: 'Feelsyst', email: 'contact@feelsyst.com' },
            to: [{ email: client.email, name: client.full_name || client.email }],
            subject,
            textContent: personalizedBody,
          }),
        });
        sent++;
        await delay(300); // throttle pour éviter rate-limit Brevo
      } catch (e) {
        errors.push({ email: client.email, error: e.message });
      }
    }

    // Logger l'action admin
    await supabase.from('admin_logs').insert([{
      action: 'broadcast.sent',
      target_type: 'broadcast',
      target_id: null,
      details: { segment, plan, status, subject, sent, total: recipients.length },
    }]);

    return res.status(200).json({
      success: true,
      sent,
      total: recipients.length,
      errors,
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};
