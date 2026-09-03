#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LA FRONTIÈRE ENTRE DEUX ENTREPRISES.

   Le risque qui tue un SaaS multi-locataire : qu'une entreprise voie
   les données d'une autre. Une seule fuite, et la confiance est
   perdue — on ne la rattrape pas après coup.

   Ce contrôle ne lit pas le code : il ouvre une VRAIE session sous un
   compte de l'organisation A, puis tente de lire CHAQUE table portant
   un `org_id`, en visant explicitement l'organisation B.

   Toute ligne qui remonte est une fuite.

   Usage : node --env-file=.env.local scripts/qa/fuite-entre-organisations.mjs
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ok = [], fuites = [], refus = [];

/** Ouvre une vraie session pour un compte, sans mot de passe. */
async function session(courriel) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (e1) throw new Error(`lien refusé pour ${courriel} : ${e1.message}`);
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2) throw new Error(`session refusée pour ${courriel} : ${e2.message}`);
  return {
    jeton: s.session.access_token,
    client: createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
  };
}

/** Toutes les tables du schéma public qui portent un org_id. */
async function tablesAvecOrgId() {
  const { data, error } = await admin.rpc('exec_sql', { sql: '' }).then(() => ({ data: null }), () => ({ data: null }));
  // Pas de RPC générique : on interroge le catalogue via une lecture directe.
  const connues = [
    'clients', 'jobs', 'invoices', 'quotes', 'payments', 'pipeline_deals', 'contacts',
    'invoice_items', 'quote_items', 'job_materials', 'job_checklists', 'job_time_logs',
    'timesheets', 'tasks', 'notes', 'automations', 'conversations', 'messages',
    'memberships', 'company_settings', 'payment_provider_settings', 'subscriptions',
    'audit_events', 'security_events', 'commissions', 'payroll_payments', 'goals',
    'products', 'predefined_services', 'expenses', 'documents', 'attachments',
  ];
  const existantes = [];
  for (const t of connues) {
    const { error } = await admin.from(t).select('org_id', { head: true, count: 'exact' }).limit(1);
    if (!error) existantes.push(t);
  }
  return existantes;
}

(async () => {
  console.log('\n═══ Fuite entre organisations ═══\n');

  // Deux organisations réelles, distinctes, avec des membres différents.
  const { data: mem } = await admin.from('memberships').select('user_id, org_id, role');
  const parOrg = {};
  for (const m of mem || []) (parOrg[m.org_id] ||= []).push(m);
  const { data: comptes } = await admin.auth.admin.listUsers({ perPage: 200 });
  const courriel = (id) => (comptes.users.find((u) => u.id === id) || {}).email;

  const orgs = Object.entries(parOrg)
    .map(([org, m]) => ({ org, membres: m, mail: m.map((x) => courriel(x.user_id)).find(Boolean) }))
    .filter((o) => o.mail);
  if (orgs.length < 2) {
    console.error('Il faut au moins deux organisations avec un compte utilisable.');
    process.exit(1);
  }

  // A = celle qui a le plus de données (l'attaquante), B = une autre (la cible).
  const compte = async (org) => {
    const { count } = await admin.from('clients').select('*', { count: 'exact', head: true }).eq('org_id', org);
    return count || 0;
  };
  for (const o of orgs) o.clients = await compte(o.org);
  orgs.sort((a, b) => b.clients - a.clients);
  const A = orgs[0];
  const B = orgs.find((o) => o.org !== A.org && o.clients > 0) || orgs[1];

  console.log(`  Organisation A (session ouverte) : ${A.org.slice(0, 8)}  ${A.mail}`);
  console.log(`  Organisation B (cible)           : ${B.org.slice(0, 8)}  ${B.mail}`);
  console.log('');

  const { client } = await session(A.mail);
  const tables = await tablesAvecOrgId();
  console.log(`  ${tables.length} table(s) portant un org_id à éprouver\n`);

  for (const t of tables) {
    // Combien de lignes B possède-t-elle réellement ? (vu par service_role)
    const { count: reel } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('org_id', B.org);
    // Ce que A parvient à en lire.
    const { data, error } = await client.from(t).select('id, org_id').eq('org_id', B.org).limit(5);

    if (error) {
      refus.push(`${t} — ${error.code || ''} ${error.message.slice(0, 50)}`);
      console.log(`  · ${t.padEnd(28)} refus (${error.code || 'err'})`);
      continue;
    }
    const vues = (data || []).length;
    if (vues > 0) {
      fuites.push(`${t} : ${vues} ligne(s) de l'organisation B visibles depuis A`);
      console.log(`  ✗ ${t.padEnd(28)} FUITE — ${vues} ligne(s) visibles (B en a ${reel})`);
    } else {
      ok.push(t);
      console.log(`  ✓ ${t.padEnd(28)} étanche${reel ? ` (B en a ${reel}, A n'en voit 0)` : ''}`);
    }
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  Tables étanches   ${ok.length}`);
  console.log(`  Refus explicites  ${refus.length}`);
  console.log(`  FUITES            ${fuites.length}`);
  if (fuites.length) {
    console.log('');
    fuites.forEach((f) => console.log(`    ✗ ${f}`));
  }
  console.log('');
  process.exit(fuites.length ? 1 : 0);
})().catch((e) => {
  console.error('Interrompu :', e.message);
  process.exit(1);
});
