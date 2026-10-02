/**
 * Ménage du jeu « roles » — à lancer UNE FOIS quand staging est rétabli, avant de relancer les specs.
 * (Écrit le 2026-10-01 pendant la panne : JAMAIS exécuté.)
 *
 * Les sondes et les passes Playwright interrompues ont laissé, dans les DEUX bureaux de test du lot seulement :
 *   · des règles « [E2E … » (et leurs tâches / journaux), des dossiers et des adresses d'appel « [E2E … » ;
 *   · dans le bureau B, deux règles nées de « Utiliser ce modèle » (« Me notifier quand un client ouvre sa soumission ») ;
 *   · des tâches planifiées « pending » nées des événements émis (rappels de la visite et relance du devis du décor) ;
 *   · des notifications « Job ready for invoicing » / « New lead ».
 * Rien n'est touché hors des deux bureaux « [TEST] QA Automatisations A/B (roles) ».
 *
 *   cd D:/lume-uiaudit/wt && node --env-file=.env.local ../outils/roles/menage.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL ?? '';
if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('REFUS : staging seulement.');
const a = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

const A = '766cd6ac-9524-43bc-bfcc-f015a08a3ab4';
const B = '5a9c075f-e0ce-4bc9-9e69-cf5362e5b69b';
const { data: orgs, error } = await a.from('orgs').select('id, name').in('id', [A, B]);
if (error) throw new Error(`staging ne répond pas : ${error.message}`);
if ((orgs ?? []).length !== 2 || !(orgs ?? []).every((o) => /^\[TEST\] QA Automatisations [AB] \(roles\)/.test(o.name))) throw new Error('REFUS : les deux bureaux du jeu « roles » ne sont pas retrouvés.');

const dire = (quoi, r) => console.log(`${quoi} : ${r.error ? `ERREUR ${r.error.message}` : `${(r.data ?? []).length} ligne(s)`}`);

for (const org of [A, B]) {
  const { data: regles } = await a.from('automation_rules').select('id').eq('org_id', org).ilike('name', '%[E2E %');
  const ids = (regles ?? []).map((r) => r.id);
  if (ids.length) {
    dire(`tâches des règles [E2E] (${org.slice(0, 8)})`, await a.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids).select('id'));
    dire(`journaux des règles [E2E] (${org.slice(0, 8)})`, await a.from('automation_execution_logs').delete().in('automation_rule_id', ids).select('id'));
    dire(`règles [E2E] (${org.slice(0, 8)})`, await a.from('automation_rules').delete().in('id', ids).select('id'));
  }
  dire(`dossiers [E2E] (${org.slice(0, 8)})`, await a.from('automation_folders').delete().eq('org_id', org).ilike('name', '%[E2E %').select('id'));
  const { data: w } = await a.from('automation_webhooks').select('id').eq('org_id', org).ilike('name', '%[E2E %');
  const idsW = (w ?? []).map((x) => x.id);
  if (idsW.length) {
    dire(`reçus des adresses [E2E] (${org.slice(0, 8)})`, await a.from('automation_webhook_receipts').delete().in('webhook_id', idsW).select('id'));
    dire(`adresses d’appel [E2E] (${org.slice(0, 8)})`, await a.from('automation_webhooks').delete().in('id', idsW).select('id'));
  }
  dire(`tâches (table tasks) [E2E] (${org.slice(0, 8)})`, await a.from('tasks').delete().eq('org_id', org).ilike('title', '%[E2E %').select('id'));
  dire(`pause et langue remises (${org.slice(0, 8)})`, await a.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null, default_language: 'fr' }).eq('org_id', org).select('org_id'));
}
// Bureau B : aucune règle « à soi » n'y est légitime — celles qui restent viennent de « Utiliser ce modèle » (sonde).
dire('règles nées d’un modèle dans le bureau B', await a.from('automation_rules').delete().eq('org_id', B).eq('is_preset', false).select('id'));
// File du bureau A : ce que les événements de la sonde ont planifié sur le décor.
dire('tâches planifiées en attente du bureau A annulées', await a.from('automation_scheduled_tasks').update({ status: 'cancelled', completed_at: new Date().toISOString(), last_error: 'Ménage du jeu de test « roles »' }).eq('org_id', A).eq('status', 'pending').select('id'));
dire('notifications de test du bureau A', await a.from('notifications').delete().eq('org_id', A).in('type', ['job_ready_for_invoicing', 'automation', 'automation_failed']).select('id'));
// Le forfait du bureau B doit être celui d'origine (55-forfait.spec.ts le change puis le remet).
const { data: sub } = await a.from('subscriptions').select('status, plans:plan_id(slug)').eq('org_id', B).in('status', ['active', 'trialing']).maybeSingle();
console.log(`forfait du bureau B : ${sub?.plans?.slug ?? 'INTROUVABLE'} (attendu : autopilot)`);
const { data: gel } = await a.from('org_features').select('enabled').eq('org_id', B).eq('feature', 'communications_gelees').maybeSingle();
console.log(`gel des communications du bureau B : ${gel?.enabled === true ? 'ACTIF — à retirer (20-points-entree, EXT-024)' : 'absent'}`);
