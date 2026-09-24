/**
 * Prouve que le pipeline de ventes déclenche vraiment des actions.
 *
 * Avant ce chantier, les triggers écrivaient dans `pipeline_events` et
 * personne ne lisait cette table : un deal pouvait traverser tout le pipeline
 * sans que rien ne parte. Une requête SQL n'aurait rien signalé — la file
 * était parfaitement remplie, simplement jamais consommée.
 *
 * Ce script fait donc tourner le VRAI consommateur, sur de VRAIES règles :
 *
 *   1. une règle « à l'entrée dans l'étape » crée une tâche ;
 *   2. un événement déjà traité ne se rejoue pas (idempotence) ;
 *   3. l'action « déplacer vers une étape » bouge réellement le deal ;
 *   4. elle refuse une étape d'un AUTRE pipeline (garde-fou) ;
 *   5. la détection de stagnation repère un deal qui dort.
 *
 * Tout est nettoyé à la fin, même en cas d'échec.
 *
 * Usage : node --env-file=.env.local scripts/qa/verifier-moteur-pipeline.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_SB || !CLE_SERVICE) {
  console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.local).');
  process.exit(2);
}
if (URL_SB.includes('bbzcuzqfgsdvjsymfwmr')) {
  console.error('Refus : ce script écrit des données de test, jamais sur la PROD.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const menage = { deals: [], clients: [], regles: [], taches: [], pipelines: [] };
let reussis = 0, echoues = 0;

function verifier(nom, ok, detail = '') {
  if (ok) { reussis++; console.log(`  ✓ ${nom}`); }
  else { echoues++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const { traiterEvenementsPipeline, detecterStagnation } = await import('../../server/lib/pipelineEvenements.ts');
  const { executeMoveDealStage } = await import('../../server/lib/actions/index.ts');
  const { initAutomationEngine } = await import('../../server/lib/automationEngine.ts');

  const { data: pipeline } = await admin.from('pipelines_ventes')
    .select('id, org_id').eq('is_default', true).limit(1).maybeSingle();
  const orgId = pipeline.org_id;
  const { data: membre } = await admin.from('memberships')
    .select('user_id').eq('org_id', orgId).limit(1).maybeSingle();

  const { data: etapes } = await admin.from('pipeline_stages')
    .select('id, name_fr, kind, position')
    .eq('pipeline_id', pipeline.id).is('archived_at', null).order('position');
  const ouvertes = etapes.filter((e) => e.kind === 'open');
  const [depart, arrivee] = ouvertes;

  // Le moteur doit être initialisé : c'est lui qui écoute le bus.
  initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' });

  // ── Règle : à l'entrée dans « arrivee », créer une tâche ──────────
  const marque = Date.now();
  const { data: regle } = await admin.from('automation_rules').insert({
    org_id: orgId,
    name: `QA moteur ${marque}`,
    trigger_event: 'deal.stage_entered',
    pipeline_id: pipeline.id,
    stage_id: arrivee.id,
    conditions: {},
    delay_seconds: 0,
    actions: [{ type: 'create_task', config: { title: `QA tâche ${marque}` } }],
    is_active: true,
  }).select('id').single();
  menage.regles.push(regle.id);

  const { data: client } = await admin.from('clients').insert({
    org_id: orgId, created_by: membre.user_id,
    first_name: 'QA', last_name: `Moteur ${marque}`,
    phone: `514555${String(marque).slice(-4)}`, status: 'lead',
  }).select('id').single();
  menage.clients.push(client.id);

  const { data: deal } = await admin.from('deals').insert({
    org_id: orgId, pipeline_id: pipeline.id, stage_id: depart.id,
    client_id: client.id, source: 'manual', created_by: membre.user_id,
  }).select('id').single();
  menage.deals.push(deal.id);

  // On purge les événements de création : seul le mouvement nous intéresse.
  await admin.from('pipeline_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('deal_id', deal.id).is('processed_at', null);

  // ── 1. L'entrée dans l'étape déclenche la règle ───────────────────
  console.log(`\n1. Entrée dans « ${arrivee.name_fr} » → la règle se déclenche`);
  await admin.from('deals').update({ stage_id: arrivee.id }).eq('id', deal.id);

  const { count: enAttente } = await admin.from('pipeline_events')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', deal.id).is('processed_at', null);
  verifier(`la file contient l'événement (${enAttente})`, (enAttente ?? 0) > 0);

  await traiterEvenementsPipeline(admin);
  await new Promise((r) => setTimeout(r, 1200)); // le bus est asynchrone

  const { data: taches } = await admin.from('tasks')
    .select('id, title').eq('org_id', orgId).ilike('title', `QA tâche ${marque}%`);
  (taches ?? []).forEach((t) => menage.taches.push(t.id));
  verifier('une tâche a été créée par la règle', (taches ?? []).length === 1,
    `${(taches ?? []).length} tâche(s)`);

  // ── 2. Idempotence ────────────────────────────────────────────────
  console.log('\n2. Un événement déjà traité ne se rejoue pas');
  await traiterEvenementsPipeline(admin);
  await new Promise((r) => setTimeout(r, 800));
  const { data: taches2 } = await admin.from('tasks')
    .select('id').eq('org_id', orgId).ilike('title', `QA tâche ${marque}%`);
  verifier('toujours une seule tâche', (taches2 ?? []).length === 1,
    `${(taches2 ?? []).length} tâche(s)`);

  // ── 3. L'action « déplacer » bouge le deal ────────────────────────
  console.log('\n3. Action « déplacer vers une étape »');
  const ctx = {
    supabase: admin, orgId, entityType: 'deal', entityId: deal.id,
    twilio: null, baseUrl: 'http://localhost:3002',
  };
  const res = await executeMoveDealStage({ stage_id: depart.id }, {}, ctx);
  verifier('le déplacement réussit', res.success === true, res.error ?? '');
  const { data: apres } = await admin.from('deals')
    .select('stage_id').eq('id', deal.id).maybeSingle();
  verifier('le deal est bien dans la nouvelle étape', apres?.stage_id === depart.id);

  const reJoue = await executeMoveDealStage({ stage_id: depart.id }, {}, ctx);
  verifier('déplacer vers la même étape ne casse rien',
    reJoue.success === true && reJoue.data?.deja_dans_l_etape === true);

  // ── 4. Le garde-fou inter-pipelines ───────────────────────────────
  console.log('\n4. Une étape d’un AUTRE pipeline est refusée');
  const { data: autre } = await admin.from('pipelines_ventes')
    .insert({ org_id: orgId, name: `QA autre ${marque}` }).select('id').single();
  menage.pipelines.push(autre.id);
  const { data: etapeAutre } = await admin.from('pipeline_stages').insert({
    org_id: orgId, pipeline_id: autre.id,
    name_fr: 'Ailleurs', name_en: 'Elsewhere', position: 1, kind: 'open',
  }).select('id').single();

  const refus = await executeMoveDealStage({ stage_id: etapeAutre.id }, {}, ctx);
  verifier('le déplacement inter-pipelines est refusé', refus.success === false, refus.error ?? '');
  const { data: intact } = await admin.from('deals')
    .select('stage_id').eq('id', deal.id).maybeSingle();
  verifier("le deal n'a pas bougé", intact?.stage_id === depart.id);

  // ── 5. La détection de stagnation ─────────────────────────────────
  console.log('\n5. Détection des deals qui dorment');
  const { data: regleIdle } = await admin.from('automation_rules').insert({
    org_id: orgId, name: `QA idle ${marque}`,
    trigger_event: 'deal.stage_idle',
    pipeline_id: pipeline.id, stage_id: depart.id,
    conditions: { idle_days: 3 }, delay_seconds: 0,
    actions: [{ type: 'log_activity', config: { message: 'dort' } }],
    is_active: true,
  }).select('id').single();
  menage.regles.push(regleIdle.id);

  // Le deal n'a pas bougé depuis longtemps.
  await admin.from('deals')
    .update({ last_activity_at: new Date(Date.now() - 10 * 86400000).toISOString() })
    .eq('id', deal.id);

  const n = await detecterStagnation(admin);
  verifier('au moins un deal signalé comme dormant', n >= 1, `${n} signalé(s)`);
  const { count: idles } = await admin.from('pipeline_events')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', deal.id).eq('type', 'deal.stage_idle');
  verifier("l'événement « sans activité » est dans la file", (idles ?? 0) >= 1);

  const n2 = await detecterStagnation(admin);
  verifier('une seconde détection ne double pas l’alerte', n2 === 0, `${n2} signalé(s)`);

  console.log(`\n${reussis} réussis, ${echoues} échoués.`);
  return echoues === 0 ? 0 : 1;
}

async function nettoyer() {
  for (const id of menage.taches) await admin.from('tasks').delete().eq('id', id);
  for (const id of menage.deals) {
    await admin.from('pipeline_events').delete().eq('deal_id', id);
    await admin.from('deals').delete().eq('id', id);
  }
  for (const id of menage.regles) await admin.from('automation_rules').delete().eq('id', id);
  for (const id of menage.pipelines) await admin.from('pipelines_ventes').delete().eq('id', id);
  for (const id of menage.clients) await admin.from('clients').delete().eq('id', id);
  console.log('Nettoyage fait.');
}

let code = 1;
try { code = await main(); }
catch (e) { console.error('Échec :', e?.stack ?? e); code = 1; }
finally { await nettoyer().catch((e) => console.error('Nettoyage incomplet :', e?.message)); }
process.exit(code);
