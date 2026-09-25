/**
 * UN VRAI WORKFLOW, EXÉCUTÉ POUR DE VRAI.
 *
 * La question à laquelle ce script répond : « si je construis un workflow,
 * est-ce que ça va chier ? »
 *
 * Les tests unitaires prouvent qu'une action écrit dans la bonne table avec
 * un faux client. Ce script fait autre chose : il crée un VRAI client dans
 * la base, construit un parcours de 6 étapes qui enchaîne les nouvelles
 * actions, appelle le VRAI exécuteur du moteur, puis relit la base pour
 * vérifier que chaque écriture a bien eu lieu.
 *
 * Tout est nettoyé à la fin, même en cas d'échec.
 *
 *   npx tsx --env-file=.env.local scripts/qa/verifier-workflow-bout-en-bout.mjs
 */

import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !CLE_SERVICE) {
  console.error('Variables manquantes : VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

const ok = [];
const ko = [];
const dire = (bon, quoi, detail = '') => {
  (bon ? ok : ko).push(quoi + (detail ? ` — ${detail}` : ''));
  console.log(`  ${bon ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  console.log('\n═══ Un vrai workflow, exécuté pour de vrai ═══\n');

  const { executeAction, resolveEntityVariables } = await import('../../server/lib/actions/index.ts');
  const { ACTIONS, DECLENCHEURS, actionCompatible, ENTITE_PAR_DECLENCHEUR } =
    await import('../../src/lib/automationCatalogue.ts');

  // ── Le terrain de jeu : une org réelle, un client jetable ──
  const { data: org } = await admin
    .from('memberships').select('org_id, user_id').eq('status', 'active').limit(1).maybeSingle();
  if (!org) throw new Error('aucune organisation active en base');

  const { data: client, error: eClient } = await admin.from('clients').insert({
    org_id: org.org_id,
    first_name: 'QA', last_name: 'BoutEnBout',
    email: 'qa-bout-en-bout@exemple.test',
    phone: '+15555550199',
    status: 'lead',
    // Un trigger exige `created_by` quand l'écriture vient du service_role
    // (pas de contexte auth) : sans lui, l'insertion est refusée.
    created_by: org.user_id,
  }).select('id').single();
  if (eClient) throw new Error(`création du client : ${eClient.message}`);

  const { data: job, error: eJob } = await admin.from('jobs').insert({
    org_id: org.org_id,
    job_number: `QA-${Date.now()}`,
    title: 'Job de vérification',
    client_id: client.id,
    status: 'draft',
    created_by: org.user_id,
  }).select('id').single();
  if (eJob) throw new Error(`création du job : ${eJob.message}`);

  console.log(`  Org ${org.org_id}\n  Client ${client.id}\n  Job ${job.id}\n`);

  const ctx = {
    supabase: admin,
    orgId: org.org_id,
    entityType: 'job',
    entityId: job.id,
    twilio: null,
    baseUrl: 'https://exemple.test',
    ruleId: null,
  };

  try {
    // ── 0. Les variables se résolvent depuis une vraie entité ──
    const vars = await resolveEntityVariables(admin, org.org_id, 'job', job.id);
    dire(vars.client_name === 'QA BoutEnBout', 'les variables remontent au client', vars.client_name);
    dire(Boolean(vars.company_name), 'le nom de l’entreprise est résolu', vars.company_name);

    // ── 1. Le parcours : chaque action d'écriture, à la suite ──
    // C'est exactement ce qu'un utilisateur bâtirait dans le canevas.
    const parcours = [
      ['ajouter_etiquette', { etiquette: 'Client VIP' }],
      ['ajouter_etiquette', { etiquette: 'À rappeler' }],
      ['modifier_client', { statut: 'active', source: 'Automatisation QA', valeur: '2500' }],
      ['ajouter_note', { body: 'Suivi automatique pour [client_name].' }],
      ['assigner_responsable', { membre_id: org.user_id }],
      ['create_task', { title: 'Rappeler [client_name]', body: 'Vérifier la satisfaction', priorite: 'high', echeance_jours: '3', membre_id: org.user_id }],
      ['create_notification', { title: 'Nouveau VIP', body: '[client_name] est passé actif.' }],
    ];

    for (const [type, config] of parcours) {
      const r = await executeAction(type, config, vars, ctx);
      dire(r.success === true, `l’action « ${type} » s’exécute`, r.error ?? '');
    }

    // ── 2. La PREUVE : relire la base ──
    const { data: tags } = await admin.from('client_tags').select('tag').eq('client_id', client.id);
    const noms = (tags ?? []).map((t) => t.tag).sort();
    dire(noms.includes('Client VIP') && noms.includes('À rappeler'),
      'les deux étiquettes sont EN BASE', noms.join(', '));

    const { data: fiche } = await admin
      .from('clients').select('status, source, value, assigned_to').eq('id', client.id).single();
    dire(fiche.status === 'active', 'le statut est passé à « actif »', fiche.status);
    dire(fiche.source === 'Automatisation QA', 'la source est écrite', fiche.source);
    dire(Number(fiche.value) === 2500, 'la valeur estimée est écrite', String(fiche.value));
    dire(fiche.assigned_to === org.user_id, 'le responsable est assigné');

    const { data: notes } = await admin
      .from('notes').select('content, entity_type').eq('org_id', org.org_id)
      .eq('entity_id', job.id).order('created_at', { ascending: false }).limit(1);
    dire(notes?.[0]?.content === 'Suivi automatique pour QA BoutEnBout.',
      'la note porte la variable RÉSOLUE, pas [client_name]', notes?.[0]?.content ?? 'aucune');

    const { data: taches } = await admin
      .from('tasks').select('title, priority, due_date, assignee_user_id')
      .eq('org_id', org.org_id).eq('linked_entity_id', job.id)
      .order('created_at', { ascending: false }).limit(1);
    const t = taches?.[0];
    dire(t?.title === 'Rappeler QA BoutEnBout', 'la tâche est créée, variable résolue', t?.title ?? 'aucune');
    dire(t?.priority === 'high', 'la priorité est appliquée', t?.priority ?? '');
    dire(Boolean(t?.due_date), 'l’échéance relative est calculée', t?.due_date ?? '');
    dire(t?.assignee_user_id === org.user_id, 'la tâche est assignée');

    // ── 3. Retirer une étiquette, puis toutes ──
    const r1 = await executeAction('retirer_etiquette', { etiquette: 'À rappeler' }, vars, ctx);
    dire(r1.success, 'retirer UNE étiquette s’exécute', r1.error ?? '');
    const { data: apres1 } = await admin.from('client_tags').select('tag').eq('client_id', client.id);
    dire((apres1 ?? []).length === 1 && apres1[0].tag === 'Client VIP',
      'seule la bonne étiquette a été retirée', (apres1 ?? []).map((x) => x.tag).join(','));

    const r2 = await executeAction('retirer_etiquette', { toutes: 'true' }, vars, ctx);
    dire(r2.success, 'retirer TOUTES les étiquettes s’exécute', r2.error ?? '');
    const { data: apres2 } = await admin.from('client_tags').select('tag').eq('client_id', client.id);
    dire((apres2 ?? []).length === 0, 'il ne reste plus aucune étiquette');

    // ── 4. Les refus ATTENDUS : une action hors de son entité ──
    // Un job n'est pas un deal : ces trois-là doivent refuser proprement,
    // avec un message lisible, pas planter.
    for (const type of ['modifier_deal', 'assigner_deal', 'move_deal_stage']) {
      const r = await executeAction(type, { source: 'x', membre_id: org.user_id, stage_id: 'x' }, vars, ctx);
      dire(r.success === false && typeof r.error === 'string' && r.error.length > 0,
        `« ${type} » sur un job refuse proprement`, r.error ?? '');
    }
    const rRdv = await executeAction('modifier_statut_rendezvous', { statut: 'completed' }, vars, ctx);
    dire(rRdv.success === false, '« statut de rendez-vous » sur un job refuse proprement', rRdv.error ?? '');

    // ── 5. Et l'interface ne les propose PAS sur ce déclencheur ──
    // C'est la garde qui évite tout ça : le menu ne montre que le possible.
    const pourJob = ACTIONS.filter((a) => actionCompatible(a, 'job.completed')).map((a) => a.cle);
    for (const type of ['modifier_deal', 'assigner_deal', 'move_deal_stage', 'modifier_statut_rendezvous', 'envoyer_facture', 'envoyer_soumission']) {
      dire(!pourJob.includes(type), `« ${type} » n’est PAS offerte sur « job terminé »`);
    }
    dire(pourJob.includes('send_email') && pourJob.includes('ajouter_etiquette'),
      'les actions utiles restent offertes sur « job terminé »', `${pourJob.length} actions`);

    // ── 6. La matrice complète, déclencheur par déclencheur ──
    let creux = 0;
    for (const d of DECLENCHEURS) {
      const n = ACTIONS.filter((a) => actionCompatible(a, d.cle)).length;
      if (n < 12) creux++;
      const entite = ENTITE_PAR_DECLENCHEUR[d.cle];
      if (!entite) { dire(false, `« ${d.fr} » n’a pas d’entité connue`); continue; }
    }
    dire(creux === 0, 'aucun déclencheur ne se retrouve avec trop peu d’actions');

    // ── 7. Le webhook refuse une adresse interne, même à l'exécution ──
    const rw = await executeAction('webhook', { url: 'http://169.254.169.254/' }, vars, ctx);
    dire(rw.success === false, 'le webhook refuse une adresse interne à l’EXÉCUTION', rw.error ?? '');

  } finally {
    // ── Nettoyage, quoi qu'il arrive ──
    await admin.from('tasks').delete().eq('linked_entity_id', job.id);
    await admin.from('notes').delete().eq('entity_id', job.id);
    await admin.from('client_tags').delete().eq('client_id', client.id);
    await admin.from('notifications').delete().eq('org_id', org.org_id).eq('reference_id', job.id);
    await admin.from('jobs').delete().eq('id', job.id);
    await admin.from('clients').delete().eq('id', client.id);
    console.log('\n  Données de test supprimées.');
  }

  console.log(`\n═══ ${ok.length} réussi(s), ${ko.length} échec(s) ═══\n`);
  if (ko.length) {
    for (const k of ko) console.log(`  ✗ ${k}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('\nÉCHEC :', e.message); process.exit(1); });
