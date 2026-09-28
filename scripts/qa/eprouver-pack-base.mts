/**
 * Banc du pack de base — `npm run qa:pack`.
 *
 * Prouve, contre la vraie base (staging) et le vrai code de planification,
 * ce que le pack promet SANS exécuter les tâches des autres entreprises :
 *   1. rendez-vous dans 10 j → le rappel « 1 semaine avant » est daté à
 *      début − 7 j ;
 *   2. à l'échéance → le rappel suivant (texto) est planifié ;
 *   3. rendez-vous DÉPLACÉ plus tard → l'attente est replanifiée ;
 *   4. rendez-vous pris 3 j avant → le rappel « 1 semaine » est SAUTÉ, on
 *      attend directement la veille ;
 *   5. rendez-vous ANNULÉ → le parcours s'arrête ;
 *   6. devis envoyé par texto → la relance part par texto ; par courriel →
 *      par courriel ; un devis `awaiting_response` compte bien comme « sent ».
 * Nettoie et vérifie son ménage.
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_SB || !KEY) { console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local'); process.exit(1); }
if (/bbzcuzqfgsdvjsymfwmr/.test(URL_SB) || (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD))) {
  console.error('REFUS : ce banc écrit des rendez-vous et des tâches — jamais sur la production.');
  process.exit(1);
}

const admin = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const { planifierEtape, echeanceAvantDate, trouverEtape } = await import('../../server/lib/automationSequences');
const { PACK_PARCOURS } = await import('../../server/lib/automationPack.data');
const { evaluateConditions, statutAvecAlias } = await import('../../server/lib/automationEngine');

const MARQUE = '[QA-PACK]';
const JOUR = 86_400_000;
const { data: m } = await admin.from('memberships').select('org_id, user_id').limit(1).maybeSingle();
if (!m) { console.error('Aucun membre sur cette base.'); process.exit(1); }
const ORG = m.org_id as string;
const USER = m.user_id as string;
// Un passage interrompu a pu laisser sa règle : décor propre avant de commencer.
await admin.from('automation_rules').delete().eq('org_id', ORG).like('name', `${MARQUE}%`);

const rdvPack = PACK_PARCOURS.find((p) => p.preset_key === 'pack_rendez_vous')!;
const { data: regle, error: eR } = await admin.from('automation_rules').insert({
  org_id: ORG, name: `${MARQUE} rendez-vous`, trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0,
  actions: rdvPack.actions, steps: rdvPack.steps, is_active: false, is_preset: false,
}).select('id').single();
if (eR || !regle) { console.error('Décor — règle :', eR?.message); process.exit(1); }

const rdvs: string[] = [];
async function rdv(dansJours: number): Promise<string> {
  const debut = new Date(Date.now() + dansJours * JOUR);
  const { data, error } = await admin.from('schedule_events').insert({
    org_id: ORG, title: `${MARQUE} rdv`, status: 'scheduled', created_by: USER,
    start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
  }).select('id').single();
  if (error || !data) { console.error('Décor — rendez-vous :', error?.message); process.exit(1); }
  rdvs.push(data.id);
  return data.id as string;
}
const ctx = (entityId: string) => ({ supabase: admin, orgId: ORG, ruleId: regle.id as string, entityType: 'schedule_event', entityId, contexte: {}, franchies: 0 });
const tache = async (entityId: string, stepId: string) => {
  const { data } = await admin.from('automation_scheduled_tasks')
    .select('id, org_id, automation_rule_id, entity_type, entity_id, sequence_context, execute_at, status, step_id')
    .eq('automation_rule_id', regle.id).eq('entity_id', entityId).eq('step_id', stepId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data as any;
};
const proche = (a: string | undefined, attendu: number, tolMin = 5) => !!a && Math.abs(Date.parse(a) - attendu) < tolMin * 60_000;

const res: Array<[string, boolean, string]> = [];
const etapes = rdvPack.steps as any[];
const attente7 = etapes.find((e) => e.mode === 'avant_date' && e.secondes_avant === 7 * 86_400);
const attente1 = etapes.find((e) => e.mode === 'avant_date' && e.secondes_avant === 86_400);

// 1. Rendez-vous dans 10 j : l'attente « 1 semaine avant » est datée à début − 7 j.
const r1 = await rdv(10);
await planifierEtape(ctx(r1), etapes, attente7.id);
const t1 = await tache(r1, attente7.id);
const debut1 = Date.now() + 10 * JOUR;
res.push(['rdv dans 10 j → rappel « 1 semaine » daté à début − 7 j', proche(t1?.execute_at, debut1 - 7 * JOUR), `execute_at ${t1?.execute_at}`]);

// 2. À l'échéance → le rappel (texto) est planifié.
const issue2 = await echeanceAvantDate(admin, t1, trouverEtape(etapes, attente7.id) as any, etapes, debut1 - 7 * JOUR + 60_000);
const t2 = await tache(r1, attente7.suivant);
res.push(['échéance atteinte → le rappel suit', issue2 === 'suite' && !!t2, `issue ${issue2}, étape suivante planifiée : ${!!t2}`]);

// 3. Rendez-vous DÉPLACÉ de 2 j plus tard → l'attente est replanifiée.
const r3 = await rdv(10);
await planifierEtape(ctx(r3), etapes, attente7.id);
const t3 = await tache(r3, attente7.id);
await admin.from('schedule_events').update({ start_at: new Date(Date.now() + 12 * JOUR).toISOString(), end_at: new Date(Date.now() + 12 * JOUR + 3600_000).toISOString() }).eq('id', r3);
const issue3 = await echeanceAvantDate(admin, t3, attente7, etapes, Date.now() + 3 * JOUR);
const t3b = await tache(r3, attente7.id);
res.push(['rdv déplacé plus tard → attente replanifiée', issue3 === 'replanifie' && proche(t3b?.execute_at, Date.now() + 5 * JOUR), `issue ${issue3}, nouvelle échéance ${t3b?.execute_at}`]);

// 4. Rendez-vous pris 3 j avant → rappel « 1 semaine » sauté, on attend la veille.
const r4 = await rdv(3);
await planifierEtape(ctx(r4), etapes, attente7.id);
const sautee = await tache(r4, attente7.id);
const veille = await tache(r4, attente1.id);
res.push(['rdv dans 3 j → « 1 semaine » sauté, la veille planifiée', !sautee && proche(veille?.execute_at, Date.now() + 2 * JOUR), `1 semaine : ${sautee ? 'planifié ✗' : 'sauté'}, veille : ${veille?.execute_at}`]);

// 5. Rendez-vous ANNULÉ → le parcours s'arrête.
const r5 = await rdv(10);
await planifierEtape(ctx(r5), etapes, attente7.id);
const t5 = await tache(r5, attente7.id);
await admin.from('schedule_events').update({ status: 'cancelled' }).eq('id', r5);
const issue5 = await echeanceAvantDate(admin, t5, attente7, etapes, Date.now() + 3 * JOUR);
const apres5 = await tache(r5, attente7.suivant);
res.push(['rdv annulé → le parcours s’arrête', issue5 === 'annule' && !apres5, `issue ${issue5}`]);

// 6. Devis : le canal d'envoi choisit la branche ; `awaiting_response` = « sent ».
const devis = PACK_PARCOURS.find((p) => p.preset_key === 'pack_relance_devis')!.steps as any[];
const siCanal = devis.find((e) => e.type === 'si' && e.conditions?.channel);
const branche = (channel: string) => evaluateConditions(siCanal.conditions, { type: 'quote.sent', orgId: ORG, entityType: 'quote', entityId: 'x', metadata: { channel, status: statutAvecAlias('quote', 'awaiting_response') } } as any);
const smsVers = trouverEtape(devis, siCanal.alors) as any;
const courrielVers = trouverEtape(devis, siCanal.sinon) as any;
res.push(['devis par texto → relance par texto ; par courriel → par courriel',
  branche('sms') === true && branche('email') === false && smsVers?.action?.type === 'send_sms' && courrielVers?.action?.type === 'send_email',
  `sms→${branche('sms')} (${smsVers?.action?.type}), email→${branche('email')} (${courrielVers?.action?.type})`]);
const sentOk = evaluateConditions({ status: { eq: 'sent' } } as any, { type: 'x', orgId: ORG, entityType: 'quote', entityId: 'x', metadata: { status: statutAvecAlias('quote', 'awaiting_response') } } as any);
const unpaidOk = evaluateConditions({ status: { eq: 'unpaid' } } as any, { type: 'x', orgId: ORG, entityType: 'invoice', entityId: 'x', metadata: { status: statutAvecAlias('invoice', 'partial') } } as any);
res.push(['« sent » = devis awaiting_response ; « unpaid » = facture partial', sentOk && unpaidOk, `sent ${sentOk}, unpaid ${unpaidOk}`]);

// ── Ménage vérifié ─────
const restes: string[] = [];
const net = async (q: PromiseLike<{ error: { message: string } | null }>, t: string) => { const { error } = await q; if (error) restes.push(`${t}: ${error.message}`); };
await net(admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', regle.id), 'tâches');
await net(admin.from('automation_rules').delete().eq('id', regle.id), 'règle');
await net(admin.from('schedule_events').delete().in('id', rdvs), 'rendez-vous');
const { count } = await admin.from('schedule_events').select('id', { count: 'exact', head: true }).in('id', rdvs);
if (count) restes.push(`${count} rendez-vous restés`);

for (const [cas, ok, detail] of res) console.log(`${ok ? '✓' : '✗'} ${cas} — ${detail}`);
console.log(restes.length ? `\n⚠ Ménage incomplet : ${restes.join(' ; ')}` : '\nMénage : tout supprimé et vérifié.');
const ko = res.filter((r) => !r[1]).length;
console.log(`\n${res.length - ko}/${res.length} ${ko ? '— ÉCHEC' : '— OK'}`);
process.exit(ko || restes.length ? 1 : 0);
