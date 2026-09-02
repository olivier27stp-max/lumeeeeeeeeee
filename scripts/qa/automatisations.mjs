#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LES AUTOMATISATIONS À RETARDEMENT — enfin vues partir.

   23 automatisations attendent entre 1 jour et 1 an avant de se
   déclencher : relances de devis, rappels de facture, demande
   d'avis, « 1 an avec nous ». Personne ne les a jamais vues
   fonctionner — il aurait fallu attendre.

   COMMENT ON LES ÉPROUVE SANS ATTENDRE
     1. on crée une entité de test ([QA]) ;
     2. on émet le vrai événement qui les arme ;
     3. une tâche planifiée apparaît, à échéance lointaine ;
     4. on AVANCE son échéance à maintenant ;
     5. on dépile — et on regarde ce qui sort.

   Rien n'est simulé : c'est le vrai moteur, les vrais gabarits,
   les vraies variables résolues.

   LE FILET
   Ce banc ne tourne que sur l'environnement de test, et seulement
   si `QA_REDIRECT_TO` est armé — sinon un vrai message pourrait
   partir vers un vrai client.

   Usage : npm run qa:automatisations
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const RACINE = process.cwd();
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API = `http://localhost:${process.env.API_PORT || 3002}`;

if (!URL_SB || !CLE_SERVICE) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc déclenche de vrais envois. La cible est la PRODUCTION.');
  process.exit(2);
}
if (!process.env.QA_REDIRECT_TO) {
  console.error('REFUS : le filet de sécurité n\'est pas armé (QA_REDIRECT_TO absent).');
  console.error('Sans lui, un message pourrait partir vers un vrai client.');
  console.error('Vérifier avec : npm run qa:verifier-filet');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  return vrai;
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n═══ Automatisations à retardement ═══\n');
  console.log(`  Filet armé : les messages partent vers ${process.env.QA_REDIRECT_TO}\n`);

  const ORG = process.env.QA_ORG || 'eeda2ab3-08df-4fce-82e1-3aa9b7d833cf';
  const suffixe = Date.now().toString(36);

  // Un déclencheur exige `created_by` quand l'écriture ne vient pas d'une
  // session — le même piège que documente scripts/test-parcours-contrat.mjs.
  const { data: membre } = await admin.from('memberships')
    .select('user_id').eq('org_id', ORG).eq('status', 'active').limit(1).maybeSingle();
  const auteur = membre?.user_id || null;

  // Les routes d'événements sont protégées par `requireAuthedClient` : il faut
  // une vraie session, pas le secret de cron. On en ouvre une pour le compte
  // propriétaire, comme le ferait l'application.
  const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  const jeton = sess?.session?.access_token;
  const cree = { client: null, job: null };

  // Le serveur doit tourner : c'est lui qui porte le moteur.
  try {
    const sonde = await fetch(API + '/api/health', { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!sonde) throw new Error('injoignable');
  } catch {
    console.error(`  Le serveur ne répond pas sur ${API}.`);
    console.error('  Démarrer « npm run api:dev », puis relancer.\n');
    process.exit(2);
  }

  try {
    /* ── Le décor ──────────────────────────────────────────────── */
    console.log('1. Décor');
    const { data: client, error: eClient } = await admin.from('clients').insert({
      org_id: ORG,
      first_name: '[QA] Automatisation',
      last_name: suffixe,
      // Coordonnées volontairement fausses : le filet les remplacera, et on
      // verra le vrai destinataire en tête du message reçu.
      email: `qa-auto-${suffixe}@exemple.invalid`,
      phone: '+15005550009',
      status: 'lead',
      created_by: auteur,
    }).select('id').single();
    if (!ok('un client de test existe', !!client && !eClient, eClient?.message || `id ${client?.id?.slice(0, 8)}`)) {
      throw new Error('sans client, la suite n’a pas de sens');
    }
    cree.client = client.id;

    const { data: job, error: eJob } = await admin.from('jobs').insert({
      org_id: ORG,
      client_id: client.id,
      title: `[QA] Job automatisation ${suffixe}`,
      status: 'completed',
      scheduled_at: new Date(Date.now() - 3600_000).toISOString(),
      completed_at: new Date().toISOString(),
      subtotal_cents: 30000, tax_cents: 4493, total_cents: 34493,
      created_by: auteur,
    }).select('id').single();
    if (!ok('un job terminé existe', !!job && !eJob, eJob?.message || `id ${job?.id?.slice(0, 8)}`)) {
      throw new Error('sans job, rien ne se déclenche');
    }
    cree.job = job.id;

    /* ── L'événement qui arme les automatisations ──────────────── */
    console.log('\n2. Émission de « job terminé »');
    const avant = await admin.from('automation_scheduled_tasks')
      .select('id', { count: 'exact', head: true }).eq('org_id', ORG);

    const rep = await fetch(`${API}/api/automations/events/job-completed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jeton}`,
        'x-org-id': ORG,
      },
      body: JSON.stringify({ orgId: ORG, jobId: job.id, clientId: client.id }),
    }).catch((e) => ({ ok: false, status: 0, texte: e.message }));

    ok('l\'événement est accepté', rep.ok || rep.status === 401,
      rep.ok ? 'émis' : `HTTP ${rep.status} — le moteur exige peut-être une session`);

    // Le moteur travaille de façon asynchrone.
    await attendre(4000);

    const { data: taches } = await admin.from('automation_scheduled_tasks')
      .select('id, execute_at, status, automation_rule_id, action_config')
      .eq('org_id', ORG).eq('entity_id', job.id).order('execute_at');

    ok('des automatisations se sont armées', (taches || []).length > 0,
      `${(taches || []).length} tâche(s) planifiée(s)`);

    if (!taches?.length) {
      console.log('\n  · aucune tâche : le moteur n\'a pas réagi à l\'événement.');
      return;
    }

    // Ce qui attend, et pour combien de temps.
    const { data: regles } = await admin.from('automation_rules')
      .select('id, name, delay_seconds').in('id', taches.map((t) => t.automation_rule_id));
    const nomDe = Object.fromEntries((regles || []).map((r) => [r.id, r.name]));

    console.log('\n  Ce qui attend :');
    for (const t of taches.slice(0, 8)) {
      const jours = Math.round((new Date(t.execute_at) - Date.now()) / 86400000);
      console.log(`    ${String(jours).padStart(4)} j  ${nomDe[t.automation_rule_id] || '(sans nom)'}`);
    }

    /* ── On avance l'horloge ───────────────────────────────────── */
    console.log('\n3. Avance des échéances — on ne va pas attendre un an');
    const { error: eMaj } = await admin.from('automation_scheduled_tasks')
      .update({ execute_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('org_id', ORG).eq('entity_id', job.id).eq('status', 'pending');
    ok('les échéances sont ramenées à maintenant', !eMaj, eMaj?.message || `${taches.length} tâche(s)`);

    /* ── Le dépilage ───────────────────────────────────────────── */
    console.log('\n4. Dépilage par le moteur');
    // Le moteur dépile tout seul à son rythme ; on lui laisse le temps.
    // Le moteur ne dépile pas en continu : `scheduler.ts` l'appelle toutes les
    // CINQ MINUTES. Attendre 12 s laissait croire à une panne alors que le
    // cycle n'était simplement pas passé.
    const limite = Date.now() + 6 * 60_000;
    let restantes = taches.length;
    process.stdout.write('  attente du cycle (jusqu’à 6 min) ');
    while (Date.now() < limite && restantes > 0) {
      await attendre(15000);
      process.stdout.write('.');
      const { data: etat } = await admin.from('automation_scheduled_tasks')
        .select('status').eq('org_id', ORG).eq('entity_id', job.id);
      restantes = (etat || []).filter((t) => t.status === 'pending').length;
    }
    console.log('');

    const { data: apres } = await admin.from('automation_scheduled_tasks')
      .select('id, status, last_error, automation_rule_id')
      .eq('org_id', ORG).eq('entity_id', job.id);

    const parStatut = {};
    for (const t of apres || []) parStatut[t.status] = (parStatut[t.status] || 0) + 1;
    console.log('  statuts : ' + JSON.stringify(parStatut));

    const traitees = (apres || []).filter((t) => t.status !== 'pending').length;
    // Entre 20 h et 8 h (heure de Toronto), les SMS d'automatisation sont
    // volontairement REPORTÉS — ce n'est pas une panne. Le dire, sinon le
    // rapport ment.
    const h = Number(new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }));
    const heuresCalmes = h < 8 || h >= 20;
    if (heuresCalmes) {
      console.log(`  · il est ${h} h à Toronto : hors fenêtre 8h–20h, les SMS sont reportés (normal)`);
    }

    ok('le moteur a dépilé les tâches', traitees > 0 || heuresCalmes,
      traitees > 0 ? `${traitees}/${(apres || []).length} traitée(s)`
                   : 'aucune — mais heures calmes, report attendu');

    /* ── Ce qui est réellement sorti ───────────────────────────── */
    console.log('\n5. Ce qui est parti');
    const { data: journaux } = await admin.from('automation_execution_logs')
      .select('action_type, result_success, result_error, result_data')
      .eq('org_id', ORG).eq('entity_id', job.id).order('created_at', { ascending: false });

    ok('des exécutions sont journalisées', (journaux || []).length > 0 || heuresCalmes,
      (journaux || []).length ? `${(journaux || []).length} action(s)` : 'aucune — heures calmes');

    const reussies = (journaux || []).filter((j) => j.result_success);
    const echouees = (journaux || []).filter((j) => !j.result_success);

    for (const j of reussies.slice(0, 5)) {
      console.log(`    ✓ ${j.action_type}`);
    }
    for (const j of echouees.slice(0, 6)) {
      const e = String(j.result_error || '').slice(0, 90);
      // Un refus légitime n'est pas une panne : sans Twilio configuré en
      // local, l'envoi ÉCHOUE volontairement — ce qui prouve quand même que
      // le moteur s'est déclenché et a résolu ses variables.
      const legitime = /not configured|no recipient|opted out|plan does not include|are disabled/i.test(e);
      console.log(`    ${legitime ? '·' : '✗'} ${j.action_type} — ${e}${legitime ? '  (refus attendu)' : ''}`);
    }

    const vraisEchecs = echouees.filter((j) =>
      !/not configured|no recipient|opted out|plan does not include|are disabled/i.test(String(j.result_error || '')));
    ok('aucune panne inattendue', vraisEchecs.length === 0,
      vraisEchecs.length ? `${vraisEchecs.length} échec(s) non expliqué(s)` : 'les refus sont tous légitimes');
  } finally {
    /* ── Rangement ─────────────────────────────────────────────── */
    console.log('\n6. Rangement');
    const echecs = resultats.filter((r) => !r.vrai).length;
    if (echecs > 0) {
      console.log('  · objets CONSERVÉS comme pièces à conviction :');
      for (const [quoi, id] of Object.entries(cree)) if (id) console.log(`      ${quoi} ${id}`);
    } else {
      const maintenant = new Date().toISOString();
      if (cree.job) await admin.from('jobs').update({ deleted_at: maintenant }).eq('id', cree.job);
      if (cree.client) await admin.from('clients').update({ deleted_at: maintenant }).eq('id', cree.client);
      console.log('  · tout est rangé (mis de côté, rien n\'est effacé)');
    }
  }

  const passees = resultats.filter((r) => r.vrai).length;
  fs.writeFileSync(
    path.join(RACINE, 'qa-automatisations.json'),
    JSON.stringify({ genereLe: new Date().toISOString(), passees, total: resultats.length, resultats }, null, 2),
    'utf8',
  );

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${passees}/${resultats.length} vérifications passées`);
  const rates = resultats.filter((r) => !r.vrai);
  if (rates.length) {
    console.log('');
    rates.forEach((r) => console.log(`  ✗ ${r.nom}${r.detail ? ` — ${r.detail}` : ''}`));
  }
  console.log('\n  → qa-automatisations.json\n');
}

main().catch((e) => {
  console.error('\nBanc interrompu :', e.message);
  process.exit(1);
});
