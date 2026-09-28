/**
 * Banc de l'outbox des événements (`domain_events`) — `npm run qa:outbox`.
 *
 * Prouve, contre le VRAI moteur et une vraie base (staging), les trois
 * promesses de l'outbox :
 *   1. un événement émis est consigné, puis coché quand le moteur a fini ;
 *   2. un orphelin de crash (consigné, jamais coché) est rejoué par le tick
 *      et son action part ;
 *   3. rejouer un événement DÉJÀ traité n'envoie rien une seconde fois
 *      (l'idempotence des actions immédiates tient) ;
 * et qu'un orphelin trop récent n'est pas touché (délai de grâce).
 *
 * Le crash est simulé en insérant la ligne telle qu'un processus mort la
 * laisse : consignée il y a 10 minutes, jamais cochée.
 *
 * Nettoie tout ce qu'il crée et VÉRIFIE chaque suppression.
 *
 *   node --env-file=.env.local --import tsx scripts/qa/eprouver-outbox.mts
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_SB || !KEY) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(1);
}
if (/bbzcuzqfgsdvjsymfwmr/.test(URL_SB) || (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD))) {
  console.error('REFUS : ce banc crée des règles, des tâches et des événements — jamais sur la production.');
  process.exit(1);
}

const admin = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const MARQUE = '[QA-OUTBOX]';
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const suffixe = Date.now().toString(36);

/** Sonde jusqu'à `maxMs` : une attente fixe rend un banc instable. */
async function sonder(test: () => Promise<boolean>, maxMs = 20_000): Promise<boolean> {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    if (await test()) return true;
    await attendre(500);
  }
  return false;
}

// ── Décor ──────────────────────────────────────────────────────────────
const { data: m } = await admin.from('memberships').select('org_id, user_id').limit(1).maybeSingle();
if (!m) { console.error('Aucun membre sur cette base.'); process.exit(1); }
const ORG = m.org_id as string;

async function creerClient(nom: string): Promise<string> {
  const { data, error } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'Banc', last_name: `Outbox ${nom} ${suffixe}`,
    email: `qa-outbox-${nom}-${suffixe}@example.invalid`, status: 'active', created_by: m!.user_id,
  }).select('id').single();
  if (error || !data) { console.error(`Décor — client ${nom} :`, error?.message); process.exit(1); }
  return data.id as string;
}
const CLIENT_DIRECT = await creerClient('direct');
const CLIENT_CRASH = await creerClient('crash');
const CLIENT_RECENT = await creerClient('recent');
const CLIENTS = [CLIENT_DIRECT, CLIENT_CRASH, CLIENT_RECENT];

const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
  org_id: ORG, name: `${MARQUE} note → tâche`, trigger_event: 'note.added',
  conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
  actions: [{ type: 'create_task', config: { title: `${MARQUE} tâche` } }],
}).select('id').single();
if (eRegle || !regle) { console.error('Décor — règle :', eRegle?.message); process.exit(1); }

const { initAutomationEngine } = await import('../../server/lib/automationEngine');
const { eventBus } = await import('../../server/lib/eventBus');
const { rejouerEvenementsOrphelins } = await import('../../server/lib/outbox');
initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' } as never);

const taches = async (client: string) => {
  const { data } = await admin.from('automation_execution_logs')
    .select('id').eq('org_id', ORG).eq('automation_rule_id', regle.id).eq('entity_id', client);
  return data?.length ?? 0;
};
const ligne = async (client: string) => {
  const { data } = await admin.from('domain_events')
    .select('id, processed_at, attempts, last_error').eq('org_id', ORG).eq('entity_id', client)
    .order('id', { ascending: false }).limit(1).maybeSingle();
  return data as { id: number; processed_at: string | null; attempts: number; last_error: string | null } | null;
};
const orphelin = async (client: string, ageMs: number) => {
  const { error } = await admin.from('domain_events').insert({
    org_id: ORG, type: 'note.added', entity_type: 'client', entity_id: client, metadata: {},
    created_at: new Date(Date.now() - ageMs).toISOString(),
  });
  if (error) { console.error('Orphelin non inséré :', error.message); process.exit(1); }
};

const resultats: Array<{ cas: string; ok: boolean; detail: string }> = [];
const verdict = (cas: string, ok: boolean, detail: string) => resultats.push({ cas, ok, detail });

console.log(`org=${ORG}  règle=${regle.id}\n`);

// ── 1. Émission normale ────────────────────────────────────────────────
await eventBus.emit('note.added', { orgId: ORG, entityType: 'client', entityId: CLIENT_DIRECT, metadata: {} });
const coche = await sonder(async () => !!(await ligne(CLIENT_DIRECT))?.processed_at);
const l1 = await ligne(CLIENT_DIRECT);
verdict('émission consignée puis cochée', coche && (await taches(CLIENT_DIRECT)) === 1,
  `ligne ${l1?.id ?? '—'}, cochée=${!!l1?.processed_at}, exécutions=${await taches(CLIENT_DIRECT)}`);

// ── 2. Orphelin de crash ───────────────────────────────────────────────
await orphelin(CLIENT_CRASH, 10 * 60 * 1000);
await orphelin(CLIENT_RECENT, 30 * 1000);
// ── 3. Rejeu d'un événement déjà traité : le moteur avait fini ses règles,
// le processus est mort avant le cochage. On remet la MÊME ligne dans cet
// état — ses `regles_traitees` sont celles que le moteur a réellement notées.
if (l1) {
  const { error } = await admin.from('domain_events')
    .update({ processed_at: null, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    .eq('id', l1.id);
  if (error) { console.error('Décor — décochage :', error.message); process.exit(1); }
}

const n = await rejouerEvenementsOrphelins(admin);
const l2 = await ligne(CLIENT_CRASH);
verdict('orphelin de crash rejoué, action partie', !!l2?.processed_at && l2.attempts === 1 && (await taches(CLIENT_CRASH)) === 1,
  `cochée=${!!l2?.processed_at}, tentatives=${l2?.attempts}, exécutions=${await taches(CLIENT_CRASH)}`);

const l3 = await ligne(CLIENT_DIRECT);
verdict('rejeu d\'un déjà-traité : aucun doublon', !!l3?.processed_at && (await taches(CLIENT_DIRECT)) === 1,
  `cochée=${!!l3?.processed_at}, exécutions=${await taches(CLIENT_DIRECT)} (attendu 1)`);

const l4 = await ligne(CLIENT_RECENT);
verdict('orphelin récent laissé tranquille', !l4?.processed_at && l4?.attempts === 0 && (await taches(CLIENT_RECENT)) === 0,
  `cochée=${!!l4?.processed_at}, tentatives=${l4?.attempts}`);
console.log(`(rejouerEvenementsOrphelins a rejoué ${n} ligne(s) — d'autres orphelins de staging peuvent s'y ajouter)\n`);

// ── Ménage vérifié ─────────────────────────────────────────────────────
const restes: string[] = [];
async function nettoyer(quoi: string, f: () => PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await f();
  if (error) restes.push(`${quoi} : ${error.message}`);
}
await nettoyer('tâches', () => admin.from('tasks').delete().eq('org_id', ORG).like('title', `${MARQUE}%`));
await nettoyer('journaux', () => admin.from('automation_execution_logs').delete().eq('org_id', ORG).eq('automation_rule_id', regle.id));
await nettoyer('règle', () => admin.from('automation_rules').delete().eq('id', regle.id));
await nettoyer('outbox', () => admin.from('domain_events').delete().eq('org_id', ORG).in('entity_id', CLIENTS));
await nettoyer('journal d\'activité', () => admin.from('activity_log').delete().eq('org_id', ORG).in('entity_id', CLIENTS));
await nettoyer('clients', () => admin.from('clients').delete().in('id', CLIENTS));
for (const [table, col, val] of [
  ['tasks', 'title', `${MARQUE}%`], ['automation_rules', 'name', `${MARQUE}%`],
] as const) {
  const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', ORG).like(col, val);
  if (count) restes.push(`${count} ligne(s) restée(s) dans ${table}`);
}
{
  const { count } = await admin.from('domain_events').select('id', { count: 'exact', head: true }).in('entity_id', CLIENTS);
  if (count) restes.push(`${count} ligne(s) restée(s) dans domain_events`);
}

for (const r of resultats) console.log(`${r.ok ? '✓' : '✗'} ${r.cas} — ${r.detail}`);
console.log(restes.length ? `\n⚠ Ménage incomplet :\n  ${restes.join('\n  ')}` : '\nMénage : tout supprimé et vérifié.');
const ko = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - ko}/${resultats.length} ${ko ? '— ÉCHEC' : '— OK'}`);
process.exit(ko || restes.length ? 1 : 0);
