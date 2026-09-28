/**
 * Banc anti-doublon des actions immédiates (F3) — `npm run qa:anti-doublon`.
 *
 * Contre le VRAI moteur et staging :
 *   1. deux émissions du même événement à la même seconde → UNE exécution ;
 *   2. la même émission hors de la fenêtre de 2 min → exécutée de nouveau
 *      (un rendez-vous modifié deux fois prévient deux fois) ;
 * La sortie de fenêtre est simulée en vieillissant la ligne réservée (clé et
 * horodatage reculés de 5 min), sans attendre.
 *
 * Nettoie tout ce qu'il crée et VÉRIFIE chaque suppression.
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_SB || !KEY) { console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local'); process.exit(1); }
if (/bbzcuzqfgsdvjsymfwmr/.test(URL_SB) || (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD))) {
  console.error('REFUS : ce banc crée des règles et des exécutions — jamais sur la production.');
  process.exit(1);
}

const admin = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const MARQUE = '[QA-DOUBLON]';
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const suffixe = Date.now().toString(36);

const { data: m } = await admin.from('memberships').select('org_id, user_id').limit(1).maybeSingle();
if (!m) { console.error('Aucun membre sur cette base.'); process.exit(1); }
const ORG = m.org_id as string;

// Un passage précédent interrompu (ou une mutation) a pu laisser des tâches :
// un décor sale fausse le compte dès le premier cas.
await admin.from('tasks').delete().eq('org_id', ORG).like('title', `${MARQUE}%`);

const { data: client, error: eClient } = await admin.from('clients').insert({
  org_id: ORG, first_name: 'Banc', last_name: `Doublon ${suffixe}`,
  email: `qa-doublon-${suffixe}@example.invalid`, status: 'active', created_by: m.user_id,
}).select('id').single();
if (eClient || !client) { console.error('Décor — client :', eClient?.message); process.exit(1); }
const CLIENT = client.id as string;

const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
  org_id: ORG, name: `${MARQUE} note → tâche`, trigger_event: 'note.added',
  conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
  actions: [{ type: 'create_task', config: { title: `${MARQUE} tâche` } }],
}).select('id').single();
if (eRegle || !regle) { console.error('Décor — règle :', eRegle?.message); process.exit(1); }

const { initAutomationEngine } = await import('../../server/lib/automationEngine');
const { eventBus } = await import('../../server/lib/eventBus');
initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' } as never);

const executions = async () => {
  const { data } = await admin.from('automation_execution_logs')
    .select('id, execution_key, result_success, result_error')
    .eq('org_id', ORG).eq('automation_rule_id', regle.id).eq('entity_id', CLIENT);
  return data ?? [];
};
const taches = async () => {
  const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true })
    .eq('org_id', ORG).eq('title', `${MARQUE} tâche`);
  return count ?? 0;
};
async function sonder(test: () => Promise<boolean>, maxMs = 20_000) {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) { if (await test()) return true; await attendre(500); }
  return false;
}

const resultats: Array<{ cas: string; ok: boolean; detail: string }> = [];
const evt = { orgId: ORG, entityType: 'client', entityId: CLIENT, metadata: {} };

// ── 1. Double émission à la même seconde ───────────────────────────────
await Promise.all([eventBus.emit('note.added', evt), eventBus.emit('note.added', evt)]);
await sonder(async () => (await executions()).some((e) => e.result_error !== 'en cours'));
await attendre(1500);
const e1 = await executions();
resultats.push({
  cas: 'double émission → une seule exécution',
  ok: e1.length === 1 && (await taches()) === 1 && e1[0].result_success === true,
  detail: `exécutions=${e1.length}, tâches=${await taches()}, réussie=${e1[0]?.result_success}`,
});

// ── 2. Hors fenêtre : on vieillit la ligne réservée de 5 minutes ──────
if (e1[0]) {
  const [base, tranche] = String(e1[0].execution_key).split('@');
  const { error } = await admin.from('automation_execution_logs').update({
    execution_key: `${base}@${Number(tranche) - 3}`,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  }).eq('id', e1[0].id);
  if (error) { console.error('Vieillissement impossible :', error.message); process.exit(1); }
}
await eventBus.emit('note.added', evt);
await sonder(async () => (await executions()).length === 2 && (await executions()).every((e) => e.result_error !== 'en cours'));
const e2 = await executions();
resultats.push({
  cas: 'hors fenêtre → exécutée de nouveau',
  ok: e2.length === 2 && (await taches()) === 2,
  detail: `exécutions=${e2.length}, tâches=${await taches()}`,
});

// ── 3. Frontière de tranche : la dernière exécution a eu lieu il y a 30 s,
// mais dans la tranche PRÉCÉDENTE. Un doublon doit quand même être bloqué.
{
  const derniere = (await executions()).sort((a, b) => String(b.execution_key).localeCompare(String(a.execution_key)))[0];
  const [base] = String(derniere.execution_key).split('@');
  const tranche = Math.floor(Date.now() / (2 * 60 * 1000));
  const { error } = await admin.from('automation_execution_logs').update({
    execution_key: `${base}@${tranche - 1}`,
    created_at: new Date(Date.now() - 30 * 1000).toISOString(),
  }).eq('id', derniere.id);
  if (error) { console.error('Décor frontière impossible :', error.message); process.exit(1); }
}
await eventBus.emit('note.added', evt);
await attendre(4000);
resultats.push({
  cas: 'doublon à cheval sur deux tranches → bloqué',
  ok: (await executions()).length === 2 && (await taches()) === 2,
  detail: `exécutions=${(await executions()).length} (attendu 2), tâches=${await taches()}`,
});

// Laisser finir les écouteurs en arrière-plan avant de nettoyer : sinon une
// tâche créée APRÈS le ménage salit le passage suivant.
await attendre(3000);

// ── Ménage vérifié ─────────────────────────────────────────────────────
const restes: string[] = [];
async function nettoyer(quoi: string, f: () => PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await f();
  if (error) restes.push(`${quoi} : ${error.message}`);
}
await nettoyer('tâches', () => admin.from('tasks').delete().eq('org_id', ORG).like('title', `${MARQUE}%`));
await nettoyer('journaux', () => admin.from('automation_execution_logs').delete().eq('org_id', ORG).eq('automation_rule_id', regle.id));
await nettoyer('règle', () => admin.from('automation_rules').delete().eq('id', regle.id));
await nettoyer('outbox', () => admin.from('domain_events').delete().eq('org_id', ORG).eq('entity_id', CLIENT));
await nettoyer('journal d\'activité', () => admin.from('activity_log').delete().eq('org_id', ORG).eq('entity_id', CLIENT));
await nettoyer('client', () => admin.from('clients').delete().eq('id', CLIENT));
if (await taches()) restes.push('tâches restées');
{
  const { count } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('id', regle.id);
  if (count) restes.push('règle restée');
}

for (const r of resultats) console.log(`${r.ok ? '✓' : '✗'} ${r.cas} — ${r.detail}`);
console.log(restes.length ? `\n⚠ Ménage incomplet :\n  ${restes.join('\n  ')}` : '\nMénage : tout supprimé et vérifié.');
const ko = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - ko}/${resultats.length} ${ko ? '— ÉCHEC' : '— OK'}`);
process.exit(ko || restes.length ? 1 : 0);
