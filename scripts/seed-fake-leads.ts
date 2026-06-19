/**
 * Crée 3 leads fictifs dans le pipeline (colonne « New »).
 *
 * Réplique la logique de POST /api/leads/create :
 *   - un client avec status='lead', lead_status='new_prospect'
 *   - une carte pipeline_deals au stage 'new' liée à ce client (lead_id = client.id)
 *
 * Usage :
 *   1. Mets ces variables dans .env.local (ou exporte-les) :
 *        VITE_SUPABASE_URL=...
 *        SUPABASE_SERVICE_ROLE_KEY=...        # clé service_role (admin)
 *        # Optionnel : ORG_ID=...             # sinon auto-détecté
 *   2. npx tsx scripts/seed-fake-leads.ts
 *
 * Idempotent par email : relancer ne crée pas de doublons de clients
 * (un deal manquant est tout de même recréé).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const FAKE_LEADS = [
  {
    first_name: 'Marc-André',
    last_name: 'Tremblay',
    email: 'marcandre.tremblay@example.com',
    phone: '514-555-0148',
    company: 'Toitures MAT inc.',
    address: '1240 Rue Saint-Denis, Montréal, QC',
    value: 4800,
    notes: 'Demande de soumission — réfection de toiture (lead fictif).',
  },
  {
    first_name: 'Sophie',
    last_name: 'Gagnon',
    email: 'sophie.gagnon@example.com',
    phone: '418-555-0192',
    company: 'Boutique Gagnon',
    address: '85 Boulevard René-Lévesque, Québec, QC',
    value: 2150,
    notes: 'Intéressée par un contrat d’entretien mensuel (lead fictif).',
  },
  {
    first_name: 'David',
    last_name: 'Bélanger',
    email: 'david.belanger@example.com',
    phone: '450-555-0137',
    company: null,
    address: '470 Rue Principale, Laval, QC',
    value: 3600,
    notes: 'Référé par un client existant — projet résidentiel (lead fictif).',
  },
];

async function run() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      'Variables manquantes. Requis dans .env.local :\n' +
        '  VITE_SUPABASE_URL=...\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=...'
    );
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Résoudre l'org + un created_by valide ──
  let orgId = process.env.ORG_ID || '';
  let createdBy = '';

  const { data: memberships, error: mErr } = await admin
    .from('memberships')
    .select('org_id, user_id, role');
  if (mErr) throw mErr;
  if (!memberships || memberships.length === 0) {
    console.error('Aucune membership trouvée — impossible de déterminer l’org.');
    process.exit(1);
  }

  if (!orgId) {
    // Prend l'org qui a le plus de membres (la plus probable = la principale).
    const counts = new Map<string, number>();
    for (const m of memberships) counts.set(m.org_id, (counts.get(m.org_id) || 0) + 1);
    orgId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const inOrg = memberships.filter((m) => m.org_id === orgId);
  createdBy = (inOrg.find((m) => m.role === 'owner') || inOrg[0]).user_id;

  console.log(`Org cible : ${orgId}`);
  console.log(`created_by : ${createdBy}`);

  for (const lead of FAKE_LEADS) {
    const fullName = `${lead.first_name} ${lead.last_name}`.trim();

    // 1) Client (réutilise un client existant avec le même email).
    let clientId: string | null = null;
    if (lead.email) {
      const { data: existing } = await admin
        .from('clients')
        .select('id')
        .eq('org_id', orgId)
        .ilike('email', lead.email)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (existing?.id) clientId = String(existing.id);
    }

    if (!clientId) {
      const { data: inserted, error: cErr } = await admin
        .from('clients')
        .insert({
          org_id: orgId,
          created_by: createdBy,
          first_name: lead.first_name,
          last_name: lead.last_name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          company: lead.company,
          title: lead.company,
          notes: lead.notes,
          value: lead.value,
          status: 'lead',
          lead_status: 'new_prospect',
        })
        .select('id')
        .single();
      if (cErr) throw cErr;
      clientId = String(inserted!.id);
    } else {
      // Re-stamp les champs lead au cas où c'était déjà un client.
      await admin
        .from('clients')
        .update({
          status: 'lead',
          lead_status: 'new_prospect',
          notes: lead.notes,
          value: lead.value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', clientId);
    }

    // 2) Carte pipeline (idempotent : réutilise un deal existant).
    const { data: existingDeal } = await admin
      .from('pipeline_deals')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', clientId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existingDeal?.id) {
      console.log(`• ${fullName} — deal déjà présent (${existingDeal.id})`);
      continue;
    }

    const { data: deal, error: dErr } = await admin
      .from('pipeline_deals')
      .insert({
        org_id: orgId,
        created_by: createdBy,
        lead_id: clientId,
        stage: 'new',
        title: lead.company || fullName,
        value: lead.value,
        notes: lead.notes,
      })
      .select('id')
      .single();
    if (dErr) throw dErr;

    console.log(`✓ ${fullName} — lead ${clientId} / deal ${deal!.id}`);
  }

  console.log('\nTerminé : 3 leads fictifs au stage « New ».');
}

run().catch((err) => {
  console.error('Échec :', err?.message || err);
  process.exit(1);
});
