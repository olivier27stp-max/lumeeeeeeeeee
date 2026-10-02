/**
 * Fait avancer le VRAI moteur d'automatisations pour UN bureau de test.
 *
 *   node node_modules/tsx/dist/cli.mjs e2e/automations/_outils/moteur-cli.mts <orgId>
 *
 * L'API locale des E2E tourne sans tâche de fond (sinon elle dépilerait les
 * files de TOUTES les entreprises de staging). Les événements écrits par la
 * base (visites, jobs, devis, factures), ceux du pipeline et les étapes
 * différées attendent donc dans leur file : ce script les traite, pour le
 * bureau demandé et aucun autre — même code que la production
 * (traiterEvenementsBase, traiterEvenementsPipeline, processScheduledTasks).
 *
 * Mêmes ceintures que la suite d'intégration (harnais/env-integration) :
 * aucun fournisseur réel, client Twilio piège, HTTP sortant refusé. Si un
 * envoi atteint un piège, le script sort en code 3 : un envoi réel aurait
 * été possible.
 *
 * Sortie : une ligne JSON { base, pipeline, pieges }.
 */
import '../../../tests/automations-suite/harnais/env-integration';
import { adminStaging } from '../../../tests/automations-suite/harnais/bureau-test';
import { appelsHttpBloques, appelsTwilio, clientTwilioPiege } from '../../../tests/automations-suite/harnais/moteur';

const orgId = process.argv[2];
if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
  console.error('usage : moteur-cli.mts <orgId>');
  process.exit(2);
}

const admin = adminStaging();

// Le bureau visé est-il bien un bureau de test, en bac à sable ?
const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
const { data: bac } = await admin.from('orgs_envois_simules').select('org_id').eq('org_id', orgId).maybeSingle();
if (!org || !String(org.name).startsWith('[TEST] QA Automatisations') || !bac) {
  console.error(`REFUS : ${orgId} n'est pas un bureau de test en bac à sable.`);
  process.exit(2);
}

const { data: canal } = await admin.from('communication_channels').select('phone_number').eq('org_id', orgId).eq('channel_type', 'sms').maybeSingle();

const { envelopperBacASable, oublierBacASable } = await import('../../../server/lib/bac-a-sable');
oublierBacASable();
const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
initAutomationEngine({
  supabase: admin,
  twilio: { client: envelopperBacASable(clientTwilioPiege)!, phoneNumber: (canal?.phone_number as string | undefined) ?? '+15555550100' },
  baseUrl: process.env.PUBLIC_URL || 'https://staging.lume-qa.test',
} as never);

const { traiterEvenementsBase } = await import('../../../server/lib/evenementsBase');
const { traiterEvenementsPipeline } = await import('../../../server/lib/pipelineEvenements');

// Deux passes : une action peut déposer un nouvel événement (pipeline) ou une tâche due tout de suite.
let base = 0;
let pipeline = 0;
for (let passe = 0; passe < 2; passe++) {
  base += await traiterEvenementsBase(admin, { orgId });
  pipeline += await traiterEvenementsPipeline(admin, { orgId });
  await processScheduledTasks(admin, { orgId });
}
// Le bus rend la main AVANT la fin des actions : c'est la fin du traitement,
// en arrière-plan, qui coche la ligne de l'outbox (`domain_events.processed_at`).
// Sortir plus tôt couperait une action au milieu (journal jamais écrit).
const depuis = new Date(Date.now() - 10 * 60_000).toISOString();
const fin = Date.now() + 90_000;
for (;;) {
  // Une lecture ordinaire (pas un `head` + `count`, qui rendait une erreur sans message sous charge).
  const { data, error } = await admin.from('domain_events')
    .select('id')
    .eq('org_id', orgId).is('processed_at', null).gte('created_at', depuis).limit(50);
  if (error) {
    // Staging saturé : on réessaie jusqu'à l'échéance au lieu d'abandonner au premier refus.
    if (Date.now() > fin) { console.error(`outbox illisible : ${error.message || JSON.stringify(error)}`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  const count = (data ?? []).length;
  if (!count) break;
  if (Date.now() > fin) { console.error(`${count} événement(s) encore en traitement après 90 s.`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 400));
}

const pieges = { twilio: appelsTwilio.length, http: appelsHttpBloques().length };
console.log(JSON.stringify({ base, pipeline, pieges }));
if (pieges.twilio > 0) {
  console.error('ENVOI RÉEL TENTÉ : un texto a atteint le fournisseur piège.');
  process.exit(3);
}
process.exit(0);
