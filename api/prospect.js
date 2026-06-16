// api/prospect.js — Rex prospection automatique — Migré Supabase
// Génération IA + envoi emails + sauvegarde persistante

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { sector, zone, size, volume = 20, action = 'generate' } = req.body || {};

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY;

  // ============================================================
  // ACTION : generate — Générer des prospects via Claude + sauvegarder
  // ============================================================
  if (action === 'generate') {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY manquante' });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: `Tu es Rex, agent commercial expert en prospection B2B. Génère une liste de ${Math.min(volume, 50)} entreprises fictives mais réalistes pour la prospection commerciale dans le secteur demandé en France. Réponds UNIQUEMENT en JSON valide avec ce format exact sans aucun texte avant/après: {"prospects":[{"company":"Nom Entreprise","contact":"Prénom Nom","email":"prenom.nom@domaine.fr","sector":"secteur précis","title":"Titre du contact","city":"Ville","size":"TPE/PME/ETI"}]}`,
          messages: [{
            role: 'user',
            content: `Génère ${Math.min(volume, 50)} prospects B2B pour: secteur="${sector}", zone="${zone}", taille="${size}"`,
          }],
        }),
      });

      const data = await response.json();
      const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text);

      // ── Sauvegarder dans Supabase ──
      const prospectsToInsert = parsed.prospects.map(p => ({
        company_name: p.company,
        contact_name: p.contact,
        email: p.email,
        sector: p.sector || sector,
        location: p.city || zone,
        status: 'new',
        source: 'rex_auto',
        notes: `Taille: ${p.size || size} | Titre: ${p.title || ''}`,
      }));

      // Upsert par email pour éviter les doublons
      const { data: saved, error: saveError } = await supabase
        .from('prospects')
        .upsert(prospectsToInsert, { onConflict: 'email', ignoreDuplicates: true })
        .select();

      if (saveError) {
        console.warn('Erreur sauvegarde prospects:', saveError.message);
        // On continue quand même — on retourne les prospects générés
      }

      return res.status(200).json({
        success: true,
        prospects: parsed.prospects,
        count: parsed.prospects.length,
        saved: saved?.length || 0,
      });

    } catch (e) {
      console.error('Prospect generation error:', e);
      return res.status(500).json({ error: 'Erreur génération prospects' });
    }
  }

  // ============================================================
  // ACTION : send — Envoyer emails via Brevo + mettre à jour statut
  // ============================================================
  if (action === 'send') {
    const { prospects, subject, template } = req.body;
    if (!BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY manquante' });
    if (!prospects?.length) return res.status(400).json({ error: 'Aucun prospect fourni' });

    let sent = 0;
    const errors = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (const p of prospects) {
      try {
        const personalizedBody = (template || '')
          .replace(/\{\{prenom\}\}/g, p.contact?.split(' ')[0] || 'Bonjour')
          .replace(/\{\{company\}\}/g, p.company || '')
          .replace(/\{\{secteur\}\}/g, p.sector || sector || '');

        const personalizedSubject = (subject || '')
          .replace(/\{\{company\}\}/g, p.company || '');

        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
          body: JSON.stringify({
            sender: { name: 'Rex — Feelsyst', email: 'contact@feelsyst.com' },
            to: [{ email: p.email, name: p.contact }],
            subject: personalizedSubject,
            textContent: personalizedBody,
          }),
        });

        // ── Mettre à jour le statut dans Supabase ──
        await supabase
          .from('prospects')
          .update({
            status: 'contacted',
            outreach_email_sent: true,
            outreach_sent_at: new Date().toISOString(),
          })
          .eq('email', p.email);

        sent++;
        await delay(1000);

      } catch (e) {
        errors.push({ email: p.email, error: e.message });

        // Logger l'erreur dans Supabase
        await supabase
          .from('prospects')
          .update({ notes: `Erreur envoi: ${e.message}` })
          .eq('email', p.email);
      }
    }

    return res.status(200).json({
      success: true,
      sent,
      errors,
      message: `${sent} emails envoyés avec succès`,
    });
  }

  // ============================================================
  // ACTION : list — Récupérer tous les prospects depuis Supabase
  // ============================================================
  if (action === 'list') {
    const { status, limit = 100 } = req.body;

    let query = supabase
      .from('prospects')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true, prospects: data, count: data.length });
  }

  // ============================================================
  // ACTION : update_status — Changer le statut d'un prospect
  // ============================================================
  if (action === 'update_status') {
    const { prospect_id, status, notes } = req.body;
    if (!prospect_id || !status) {
      return res.status(400).json({ error: 'prospect_id et status requis' });
    }

    const updates = { status };
    if (notes) updates.notes = notes;
    if (status === 'converted') updates.converted_to_client_id = req.body.client_id || null;

    const { data, error } = await supabase
      .from('prospects')
      .update(updates)
      .eq('id', prospect_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, prospect: data });
  }

  return res.status(400).json({ error: 'Action inconnue. Actions disponibles: generate, send, list, update_status' });
};
