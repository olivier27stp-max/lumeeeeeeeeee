/* ═══════════════════════════════════════════════════════════════
   ÉTIQUETTES — enchaînement et anti-boucle, sur le vrai moteur (staging).

   1. Enchaînement : A « quand ZZ-VIP est posée → poser ZZ-Suivi » ;
      B « quand ZZ-Suivi est posée → créer une tâche ». Poser ZZ-VIP doit
      aboutir à la tâche de B. Avant le 2026-09-28, B ne partait jamais :
      une étiquette posée par une automatisation n'était pas annoncée.
   2. Boucle volontaire : L1 « quand ZZ-Boucle est posée → la retirer » ;
      L2 « quand ZZ-Boucle est retirée → la remettre ». Chaque règle doit
      agir UNE fois, puis la chaîne s'arrête.
   3. Rien n'est ré-annoncé quand l'étiquette est déjà là.

   Actions inoffensives (étiquettes, tâche interne) : rien ne part vers un
   client. Crée ses données (ZZSonde) et les supprime.

   Usage : npx tsx --env-file=.env.local scripts/qa/verifier-etiquettes-chaine.mts
   ═══════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL!;
if (/bbzcuzqfgsdvjsymfwmr/.test(URL)) { console.error('REFUS : jamais sur la production.'); process.exit(1); }
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { initAutomationEngine } = await import('../../server/lib/automationEngine');
initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' } as never);
const { annoncerEtiquette } = await import('../../server/lib/etiquettes');

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const verif = (n: string, c: boolean, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };

const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'qa-pipeline@lume.test' });
const { data: mb } = await admin.from('memberships').select('org_id').eq('user_id', lien!.user!.id).eq('status', 'active').limit(1).single();
const ORG = mb!.org_id as string;
const MARQUE = `[QA-ETIQ] ${Date.now()}`;
const regles: string[] = [];
let clientId: string | null = null;

const regle = async (nom: string, declencheur: string, tag: string, action: Record<string, unknown>) => {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: ORG, name: `${MARQUE} ${nom}`, trigger_event: declencheur, conditions: { tag },
    delay_seconds: 0, is_active: true, is_preset: false, actions: [action],
  }).select('id').single();
  if (error) throw error;
  regles.push(data.id);
  return data.id as string;
};
const etiquettes = async () => new Set(((await admin.from('client_tags').select('tag').eq('client_id', clientId!)).data ?? []).map((r) => r.tag));
const executions = async (ruleId: string) => (await admin.from('automation_execution_logs')
  .select('id', { count: 'exact', head: true }).eq('automation_rule_id', ruleId).eq('result_success', true)).count ?? 0;

try {
  const { data: c, error: eC } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'ZZSonde', last_name: 'Etiquette', status: 'lead', email: 'zzsonde.etiquette@example.invalid', created_by: lien!.user!.id,
  }).select('id').single();
  if (eC) throw eC; clientId = c.id;

  // ── 1. Enchaînement ──
  const A = await regle('A', 'client.tagged', 'ZZ-VIP', { type: 'ajouter_etiquette', config: { etiquette: 'ZZ-Suivi' } });
  const B = await regle('B', 'client.tagged', 'ZZ-Suivi', { type: 'create_task', config: { title: `${MARQUE} tâche B`, priority: 'medium' } });
  await admin.from('client_tags').insert({ client_id: clientId, tag: 'ZZ-VIP' });
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-VIP', sens: 'ajoutee' });
  await pause(5000);
  verif('A pose « ZZ-Suivi » quand « ZZ-VIP » est posée', (await etiquettes()).has('ZZ-Suivi'));
  const { count: tachesB } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', ORG).eq('title', `${MARQUE} tâche B`);
  verif('… et B réagit à l’étiquette posée PAR A (enchaînement)', (tachesB ?? 0) === 1, `${tachesB} tâche(s)`);

  // ── 3. Déjà présente : rien ──
  const avantA = await executions(A);
  await admin.from('automation_rules').update({ actions: [{ type: 'ajouter_etiquette', config: { etiquette: 'ZZ-Suivi' } }] }).eq('id', A);
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-VIP', sens: 'ajoutee' });
  await pause(4000);
  const { count: tachesB2 } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', ORG).eq('title', `${MARQUE} tâche B`);
  verif('ré-poser « ZZ-Suivi » déjà présente ne relance pas B', (tachesB2 ?? 0) === 1 && (await executions(A)) >= avantA);

  // ── 2. Boucle volontaire ──
  const L1 = await regle('L1', 'client.tagged', 'ZZ-Boucle', { type: 'retirer_etiquette', config: { etiquette: 'ZZ-Boucle' } });
  const L2 = await regle('L2', 'client.untagged', 'ZZ-Boucle', { type: 'ajouter_etiquette', config: { etiquette: 'ZZ-Boucle' } });
  await admin.from('client_tags').insert({ client_id: clientId, tag: 'ZZ-Boucle' });
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-Boucle', sens: 'ajoutee' });
  await pause(8000);
  const n1 = await executions(L1), n2 = await executions(L2);
  verif('boucle « retire ↔ remet » : chaque règle agit UNE fois, puis la chaîne s’arrête', n1 === 1 && n2 === 1, `L1=${n1}, L2=${n2}`);
  verif('… et l’étiquette finit posée (dernier geste : L2 la remet)', (await etiquettes()).has('ZZ-Boucle'));

  // ── 4. « Quelle étiquette » et « le client n'a PAS l'étiquette » ──
  const F = await regle('F', 'client.tagged', 'ZZ-Promo', { type: 'create_task', config: { title: `${MARQUE} tâche F`, priority: 'medium' } });
  await admin.from('automation_rules').update({ conditions: { tag: 'ZZ-Promo', client_sans_etiquette: 'ZZ-Stop' } }).eq('id', F);
  const tachesF = async () => (await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', ORG).eq('title', `${MARQUE} tâche F`)).count ?? 0;
  await admin.from('client_tags').insert([{ client_id: clientId, tag: 'ZZ-Stop' }, { client_id: clientId, tag: 'ZZ-Autre' }]);
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-Autre', sens: 'ajoutee' });
  await admin.from('client_tags').insert({ client_id: clientId, tag: 'ZZ-Promo' });
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-Promo', sens: 'ajoutee' });
  await pause(4000);
  verif('« n’a pas ZZ-Stop » : client qui l’a → rien ; autre étiquette → rien', (await tachesF()) === 0);
  await admin.from('client_tags').delete().eq('client_id', clientId).in('tag', ['ZZ-Stop', 'ZZ-Promo']);
  await admin.from('client_tags').insert({ client_id: clientId, tag: 'ZZ-Promo' });
  await annoncerEtiquette(admin, { orgId: ORG, clientId: clientId!, tag: 'ZZ-Promo', sens: 'ajoutee' });
  await pause(4000);
  verif('… sans ZZ-Stop, poser ZZ-Promo déclenche la règle', (await tachesF()) === 1, `${await tachesF()} tâche(s)`);
} catch (e: any) {
  ko++; console.log('💥', e?.message ?? e);
} finally {
  await admin.from('tasks').delete().eq('org_id', ORG).like('title', `${MARQUE}%`);
  for (const id of regles) {
    await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', id);
    await admin.from('automation_execution_logs').delete().eq('automation_rule_id', id);
    await admin.from('automation_rules').delete().eq('id', id);
  }
  if (clientId) {
    await admin.from('domain_events').delete().eq('entity_id', clientId);
    await admin.from('client_tags').delete().eq('client_id', clientId);
    await admin.from('activity_log').delete().eq('related_entity_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
  }
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage fait`);
  process.exit(ko ? 1 : 0);
}
