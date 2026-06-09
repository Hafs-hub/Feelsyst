// api/prospect.js — Rex prospection automatique
// Génération IA + envoi emails personnalisés

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { sector, zone, size, volume = 20, action = 'generate' } = req.body || {};

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY;

  if (action === 'generate') {
    // Générer prospects via Claude
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
          messages: [{ role: 'user', content: `Génère ${Math.min(volume, 50)} prospects B2B pour: secteur="${sector}", zone="${zone}", taille="${size}"` }],
        }),
      });

      const data = await response.json();
      const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text);

      return res.status(200).json({
        success: true,
        prospects: parsed.prospects,
        count: parsed.prospects.length,
      });
    } catch (e) {
      console.error('Prospect generation error:', e);
      return res.status(500).json({ error: 'Erreur génération prospects' });
    }
  }

  if (action === 'send') {
    // Envoyer emails via Brevo
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

        const personalizedSubject = subject
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
        sent++;
        await delay(1000); // 1s entre chaque email pour éviter le spam
      } catch (e) {
        errors.push({ email: p.email, error: e.message });
      }
    }

    return res.status(200).json({
      success: true,
      sent,
      errors,
      message: `${sent} emails envoyés avec succès`,
    });
  }

  return res.status(400).json({ error: 'Action inconnue' });
};
