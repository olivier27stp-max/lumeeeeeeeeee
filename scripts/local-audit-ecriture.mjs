/**
 * Vérification post-durcissement — écritures réelles via PostgREST.
 *
 * Complète local-audit-e2e.mjs : celui-ci prouve que les PAGES chargent,
 * celui-là que les ÉCRITURES passent. Utilise le client Supabase avec un
 * vrai JWT utilisateur, donc exactement le même chemin que le navigateur —
 * RLS et grants par colonne inclus.
 *
 * Vérifie aussi que les protections ajoutées REFUSENT ce qu'elles doivent :
 * un test qui ne fait que confirmer les succès ne prouve rien.
 *
 * Run: node scripts/local-audit-ecriture.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = 'playwright-test@lume.local';
const PASS = 'PlaywrightTest123!';

if (!URL || !ANON) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants dans .env.local');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sb = createClient(URL, ANON, { auth: { persistSession: false } });

async function main() {
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: EMAIL, password: PASS,
  });
  if (authErr) { console.error('Connexion echouee:', authErr.message); process.exit(2); }

  const orgId = (await sb.from('memberships').select('org_id')
    .eq('user_id', auth.user.id).limit(1).maybeSingle()).data?.org_id;
  if (!orgId) { console.error('Aucune organisation pour le compte de test'); process.exit(2); }
  console.log(`Compte de test OK — org ${orgId.slice(0, 8)}\n`);

  const stamp = Date.now().toString().slice(-6);
  const cleanup = [];

  // ── 1. Créer un client (écriture la plus courante de l'app) ──
  // `clients` n'a pas de colonne version : le verrou optimiste ne couvre que
  // jobs/quotes/invoices, où l'édition simultanée est réellement fréquente.
  const { data: client, error: cErr } = await sb.from('clients')
    .insert({ org_id: orgId, first_name: `Audit${stamp}`, last_name: 'E2E' })
    .select('id').single();
  check('Creation client', !cErr, cErr?.message);
  if (client) cleanup.push(['clients', client.id]);

  // ── 2. Modifier ce client ──
  if (client) {
    const { error } = await sb.from('clients')
      .update({ last_name: 'E2E-modifie' }).eq('id', client.id);
    check('Modification client', !error, error?.message);
  }

  // ── 3. Créer une job (table avec verrou optimiste) ──
  const { data: job, error: jErr } = await sb.from('jobs')
    .insert({ org_id: orgId, title: `Audit job ${stamp}`, status: 'draft' })
    .select('id, version').single();
  check('Creation job', !jErr, jErr?.message);
  if (job) cleanup.push(['jobs', job.id]);

  // ── 4. Verrou optimiste : la bonne version passe ──
  if (job) {
    const { data: upd, error } = await sb.from('jobs')
      .update({ title: `Audit job ${stamp} v2` })
      .eq('id', job.id).eq('version', job.version)
      .select('version').single();
    check('Verrou optimiste — bonne version acceptee', !error && upd?.version === job.version + 1,
      error?.message || `version ${job.version} -> ${upd?.version}`);

    // ── 5. Verrou optimiste : une version périmée est REFUSÉE ──
    // C'est le cœur du mécanisme : sans ce refus, le second répartiteur
    // écrase le travail du premier en silence.
    const { data: stale } = await sb.from('jobs')
      .update({ title: 'ecrasement silencieux' })
      .eq('id', job.id).eq('version', job.version)  // version périmée
      .select('id');
    check('Verrou optimiste — version perimee refusee',
      Array.isArray(stale) && stale.length === 0,
      `${stale?.length ?? '?'} ligne(s) touchee(s), attendu 0`);

    // ── 6. La colonne version n'est pas écrivable par un client ──
    const { error: vErr } = await sb.from('jobs')
      .update({ version: 999 }).eq('id', job.id);
    check('Colonne version protegee', !!vErr, vErr ? 'refus correct' : 'ECRITURE ACCEPTEE');
  }

  // ── 7. Control plane : un client ne se donne pas un forfait ──
  const { error: planErr } = await sb.from('subscriptions')
    .update({ plan_id: '00000000-0000-0000-0000-000000000000' })
    .eq('user_id', auth.user.id);
  check('Vol de plan bloque', !!planErr, planErr ? 'refus correct' : 'ECRITURE ACCEPTEE');

  // ── 8. Jetons OAuth illisibles ──
  const { error: tokErr } = await sb.from('app_connections')
    .select('encrypted_access_token').limit(1);
  check('Jetons OAuth illisibles', !!tokErr, tokErr ? 'refus correct' : 'LECTURE ACCEPTEE');

  // ── 9. Le statut des intégrations reste lisible (marketplace) ──
  const { error: stErr } = await sb.from('app_connections')
    .select('app_id, status, connected_account_name').limit(5);
  check('Statut integrations lisible', !stErr, stErr?.message);

  // ── 10. Traces d'audit non réécrivables ──
  const { error: logErr } = await sb.from('activity_log')
    .update({ created_at: new Date().toISOString() }).eq('org_id', orgId);
  check('Traces d audit non reecrivables', !!logErr, logErr ? 'refus correct' : 'ECRITURE ACCEPTEE');

  // ── Nettoyage ──
  for (const [table, id] of cleanup.reverse()) {
    await sb.from(table).delete().eq('id', id);
  }
  console.log(`\n${cleanup.length} enregistrement(s) de test supprime(s).`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verifications OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('Erreur:', e.message); process.exit(2); });
