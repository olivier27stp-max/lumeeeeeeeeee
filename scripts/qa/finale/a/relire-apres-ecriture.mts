/**
 * BALAYAGE « SUCCÈS SANS ÉCRITURE » des outils d'écriture de Lumi (mission, point 1).
 * ────────────────────────────────────────────────────────────────────────────────
 * `scripts/qa/executer-outils-staging.mts` (session a1) exécute chaque outil mais ne RELIT PAS
 * la base. Ici, chaque outil d'écriture est enveloppé : on prend l'EMPREINTE de toute la base
 * du bureau de test avant et après l'appel (compte + hachage de chaque table, par bureau), et
 * on compare ce que l'outil a RÉPONDU à ce qui a réellement CHANGÉ.
 *
 * Trois parties :
 *   1. Les outils d'automatisation, un cas à la fois, avec relecture EXACTE (steps, actions,
 *      is_active…) — y compris les cas piégés : « déjà fait », plusieurs messages, variable
 *      inventée, règle à la corbeille.
 *   2. Les outils qui ENVOIENT (texto, courriel, relances) : le bureau est en bac à sable, on
 *      relit `envois_simules`.
 *   3. Tout le reste du CRM : le scénario de la session a1 est rejoué TEL QUEL (import du
 *      script, non modifié) à travers les mêmes enveloppes.
 *
 * Verdict par appel :
 *   · « sans écriture »  : l'outil répond sans erreur, et AUCUNE table métier n'a changé ;
 *   · « écart »          : un cas de la partie 1 dont la relecture contredit la réponse ;
 *   · « réponse sans l'état relu » : l'outil a écrit, mais sa réponse ne porte pas l'état relu
 *     (le modèle ne peut citer que ce qu'il a lui-même proposé).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/relire-apres-ecriture.mts [--auto-seulement] [--sans-modele]
 *
 * Pile LOCALE seulement, API locale requise (port de QA_A_API, défaut 3492). Sortie :
 * D:/lume-final/sorties/a/relire-apres-ecriture.json (+ .md).
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { admin, API, appelApi, bureauA, COMPTES, lireRegle, session, sessionApi, SORTIES, URL_SUPABASE } from './outils.mts';
import { semer } from './semer.mts';

const AUTO_SEULEMENT = process.argv.includes('--auto-seulement');
const SANS_MODELE = process.argv.includes('--sans-modele');
/** Complément : seulement le scénario du CRM (partie 3), ajouté aux mesures de la passe précédente. */
const CRM_SEULEMENT = process.argv.includes('--crm-seulement');
const CUMUL = process.argv.includes('--cumul');
process.env.PORT = new URL(API).port;

const dbUrl = process.env.SUPABASE_DB_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(dbUrl)) throw new Error('REFUS : SUPABASE_DB_URL doit viser la pile locale.');
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
// Fonction TEMPORAIRE (pg_temp) : elle n'existe que dans cette session, le schéma n'est pas touché.
await db.query(`
create or replace function pg_temp.empreinte(p_org uuid) returns table(nom text, n bigint, h text) language plpgsql as $f$
declare r record; q text;
begin
  for r in
    select t.table_name, exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'org_id') as a_org
    from information_schema.tables t where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  loop
    q := format('select count(*), coalesce(md5(string_agg(md5(x::text), '''' order by md5(x::text))), '''') from public.%I x %s',
                r.table_name, case when r.a_org then 'where org_id = $1' else '' end);
    begin
      if r.a_org then execute q into n, h using p_org; else execute q into n, h; end if;
    exception when others then n := -1; h := sqlerrm;
    end;
    nom := r.table_name; return next;
  end loop;
end $f$;`);

const b = await bureauA();
await semer();
// Ardoise propre : les empreintes « déjà fait » (10 min) d'une passe précédente fausseraient celle-ci.
// Le piège « déjà fait » lui-même est éprouvé exprès plus bas (cas 1.2, 1.8, 1.13).
await admin.from('agent_actions').delete().eq('org_id', b.orgA);
// Le scénario de la session a1 cherche un technicien « Antoine » : le nôtre porte ce prénom le temps de la passe.
await admin.from('memberships').update({ full_name: 'Antoine QA Technicien A' }).eq('org_id', b.orgA).eq('user_id', b.users.techA);
// get_team lit `team_members` (prénom, nom) : la fiche d'équipe du technicien de test porte ce prénom.
await admin.from('team_members').update({ first_name: 'Antoine', last_name: 'QA Technicien A' }).eq('org_id', b.orgA).eq('user_id', b.users.techA);

type Empreinte = Map<string, { n: number; h: string }>;
async function empreinte(): Promise<Empreinte> {
  const { rows } = await db.query('select * from pg_temp.empreinte($1)', [b.orgA]);
  return new Map(rows.map((r: any) => [r.nom as string, { n: Number(r.n), h: String(r.h) }]));
}
/** Tables qui ne sont PAS l'effet demandé : journaux, traces, compteurs, files techniques. */
const JOURNAL = new Set([
  'agent_actions', 'security_events', 'ai_usage', 'ai_usage_monthly', 'ai_reservations', 'lumi_traces', 'audit_events', 'activity_log',
  'domain_events', 'pipeline_events', 'login_history', 'rate_limits', 'cron_locks', 'webhook_events', 'webhook_receipts', 'dead_letters',
  'failed_login_attempts', 'integration_audit_logs', 'security_canary_runs', 'lumi_credits_avis', 'mfa_sms_challenges', 'provisioning_events',
]);
function ecart(a: Empreinte, z: Empreinte): Array<{ table: string; lignes: number }> {
  const out: Array<{ table: string; lignes: number }> = [];
  for (const [nom, apres] of z) {
    const avant = a.get(nom);
    if (!avant || avant.h !== apres.h || avant.n !== apres.n) out.push({ table: nom, lignes: apres.n - (avant?.n ?? 0) });
  }
  return out;
}

const s0 = await session(COMPTES.proprioA.email);
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const client = createClient(URL_SUPABASE, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${s0.access_token}` } } });
const ctx = { client, orgId: b.orgA, userId: b.users.proprioA, accessToken: s0.access_token };
const { AGENT_TOOLS } = await import('../../../../server/lib/agent/tools');

interface Mesure {
  n: number; outil: string; partie: string; args: Record<string, any>; reponse: any; erreur: string | null;
  metier: Array<{ table: string; lignes: number }>; journal: string[]; deja_fait: boolean;
  verdict: 'écrit' | 'sans écriture' | 'sans écriture (annoncé)' | 'erreur' | 'refus' | 'déjà fait';
}
/** L'outil DIT lui-même que rien n'a changé (« déjà en brouillon », « rien à changer ») : ce n'est pas un faux succès. */
function annonceSansEffet(reponse: any): boolean {
  if (!reponse || typeof reponse !== 'object') return false;
  if (reponse.updated === false || reponse.changed === false || reponse.sent === 0) return true;
  if (Object.keys(reponse).some((k) => /^already_|^deja_|^unchanged$/.test(k) && reponse[k] === true)) return true;
  return /rien à changer|rien n.a été (changé|modifié)|déjà en |aucun (rappel|changement)|nothing to/i.test(String(reponse.note ?? ''));
}
const mesures: Mesure[] = [];
let partie = '1-automatisations';
const ECRITURE = AGENT_TOOLS.filter((t) => t.kind === 'write');
for (const t of ECRITURE) {
  if (!t.handler) continue;
  const origine = t.handler;
  t.handler = (async (args: Record<string, any>, c: any) => {
    const avant = await empreinte();
    let reponse: any = null; let erreur: string | null = null; let levee: unknown = null;
    try { reponse = await origine(args, c); } catch (e: any) { levee = e; erreur = String(e?.message ?? e).slice(0, 300); }
    // Les effets en arrière-plan (événements, journaux) ont 250 ms pour se poser.
    await new Promise((r) => setTimeout(r, 250));
    const apres = await empreinte();
    const change = ecart(avant, apres);
    const metier = change.filter((x) => !JOURNAL.has(x.table));
    const refus = !!(reponse && typeof reponse === 'object' && 'error' in reponse);
    const dejaFait = !!reponse?.deja_fait;
    mesures.push({
      n: mesures.length + 1, outil: t.declaration.name, partie, args, reponse, erreur,
      metier, journal: change.filter((x) => JOURNAL.has(x.table)).map((x) => x.table), deja_fait: dejaFait,
      verdict: erreur ? 'erreur' : refus ? 'refus' : dejaFait ? 'déjà fait' : metier.length ? 'écrit' : annonceSansEffet(reponse) ? 'sans écriture (annoncé)' : 'sans écriture',
    });
    if (levee) throw levee;
    return reponse;
  }) as typeof t.handler;
}
const outil = (n: string) => { const t = AGENT_TOOLS.find((x) => x.declaration.name === n); if (!t?.handler) throw new Error(`outil absent : ${n}`); return t; };
const appeler = async (n: string, a: Record<string, any>): Promise<any> => { try { return await outil(n).handler!(a, ctx as any); } catch (e: any) { return { error: String(e?.message ?? e) }; } };

// ── Les constats de la partie 1 : relecture exacte ───────────────────────────────────────────
interface Cas { cas: string; outil: string; defaut: string | null; reponse: unknown; relu: unknown }
const cas: Cas[] = [];
const juger = (c: string, o: string, reponse: unknown, relu: unknown, defaut: string | null) => {
  cas.push({ cas: c, outil: o, defaut, reponse, relu });
  console.log(`${defaut ? 'DÉFAUT' : 'ok    '}  [${o}] ${c}${defaut ? ` — ${defaut}` : ''}`);
};
const R = Date.now().toString(36).slice(-5);
const crees: string[] = [];
async function regle(nom: string, ligne: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: b.orgA, name: `[QA-A relire ${R}] ${nom}`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false,
    actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], ...ligne,
  }).select('id').single();
  if (error) throw new Error(`montage ${nom} : ${error.message}`);
  crees.push(data.id as string);
  return data.id as string;
}
const sms = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
const textes = async (id: string) => {
  const r = await lireRegle(id);
  return {
    steps: (r.steps ?? []).filter((e) => e.type === 'action').map((e) => String(e.action?.config?.body ?? '')),
    actions: (r.actions ?? []).map((a) => String(a.config?.body ?? '')),
    is_active: r.is_active, name: r.name, deleted_at: r.deleted_at,
  };
};
const sApi = await sessionApi('fr');

try {
  if (CRM_SEULEMENT) throw new Error('__crm_seulement__');
  // 1.1 update_automation_message — un seul texto dans le parcours.
  {
    const id = await regle('un texto', { steps: [sms('e1', 'Bonjour [client_name], c’est [company_name]. Merci !')] });
    const nouveau = `Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link] (${R})`;
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: nouveau });
    const relu = await textes(id);
    juger('un seul texto : `steps` porte le nouveau texte', 'update_automation_message', rep, relu, relu.steps[0] === nouveau ? null : 'le parcours (`steps`) ne porte pas le nouveau texte');
    juger('un seul texto : la réponse cite le texte ENREGISTRÉ (relu en base)', 'update_automation_message', rep, relu,
      JSON.stringify(rep).includes(nouveau) ? null : 'la réponse donne `updated: true` et l’ANCIEN texte, jamais le texte relu en base : Lumi ne peut confirmer que ce qu’il a lui-même proposé');

    // 1.2 « déjà fait » : même demande après une modification faite à l'écran.
    const autre = 'Texte remis par le propriétaire dans l’éditeur.';
    const patch = await appelApi(sApi, 'PATCH', `/api/automations/rules/${id}`, { steps: [sms('e1', autre)] });
    const rep2 = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: nouveau });
    const relu2 = await textes(id);
    juger('redemander le MÊME texte dans les 10 min, après une modification à l’écran', 'update_automation_message', { patch: patch.statut, rep2 }, relu2,
      relu2.steps[0] === nouveau ? null : `l’outil répond ${rep2?.deja_fait ? '« déjà fait »' : JSON.stringify(rep2).slice(0, 80)} avec updated=${rep2?.updated} ; la base garde « ${relu2.steps[0]} » — succès sans écriture`);
  }
  // 1.3 Deux textos : le reflet `actions` après la réécriture du 2e.
  {
    const id = await regle('deux textos', {
      actions: [{ type: 'send_sms', config: { body: 'Premier' } }, { type: 'send_sms', config: { body: 'Deuxième' } }],
      steps: [sms('e1', 'Premier', 'e2'), { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' }, sms('e3', 'Deuxième')],
    });
    const sans = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: 'Nouveau deuxième' });
    juger('deux textos, sans préciser lequel : l’outil demande lequel', 'update_automation_message', sans, await textes(id), sans?.error ? null : 'aucune question : un des deux a été réécrit au hasard');
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: `Nouveau deuxième ${R}`, message_number: 2 });
    const relu = await textes(id);
    juger('deux textos, message_number = 2 : `steps` suit', 'update_automation_message', rep, relu, relu.steps[1] === `Nouveau deuxième ${R}` && relu.steps[0] === 'Premier' ? null : 'le mauvais message a été réécrit');
    juger('deux textos : `actions` (la 2e copie du message) suit `steps`', 'update_automation_message', rep, relu,
      JSON.stringify(relu.actions) === JSON.stringify(relu.steps) ? null : `\`steps\` = ${JSON.stringify(relu.steps)} mais \`actions\` = ${JSON.stringify(relu.actions)} : deux textes différents pour le même message dans la même ligne`);
  }
  // 1.4 Variable inventée.
  {
    const id = await regle('variable inventée', { steps: [sms('e1', 'Bonjour [client_first_name].')] });
    const troue = 'Bonjour {{client_prenom}}, votre facture {{facture_numero}} est en retard : {{lien_paiement}}';
    const rep = await appeler('update_automation_sms_body', { rule_id: id, body: troue });
    const relu = await textes(id);
    juger('texte avec des variables qui n’existent pas ({{client_prenom}}, {{lien_paiement}})', 'update_automation_sms_body', rep, relu,
      rep?.error ? null : 'accepté et enregistré tel quel : le client recevrait « Bonjour , votre facture  est en retard :  »');
  }
  // 1.5 Règle à la corbeille.
  {
    const id = await regle('corbeille', { steps: [sms('e1', 'Avant')], deleted_at: new Date().toISOString() });
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: `Écrit dans la corbeille ${R}` });
    const relu = await textes(id);
    juger('réécrire le message d’une automatisation À LA CORBEILLE', 'update_automation_message', rep, relu,
      rep?.error ? null : `l’outil répond updated=${rep?.updated} sur une règle supprimée (la route de l’éditeur refuse ce cas en 409)`);
  }
  // 1.6 Format d'origine (pas de parcours) : `actions` est ce que le moteur exécute.
  {
    const id = await regle('format origine', { actions: [{ type: 'send_sms', config: { body: 'Texte d’origine' } }], steps: null });
    const rep = await appeler('update_automation_sms_body', { rule_id: id, body: `Texte d’origine modifié ${R}` });
    const relu = await textes(id);
    juger('règle au format d’origine : `actions` porte le nouveau texte', 'update_automation_sms_body', rep, relu, relu.actions[0] === `Texte d’origine modifié ${R}` ? null : '`actions` n’a pas été réécrit');
  }
  // 1.7 Courriel : objet et corps.
  {
    const id = await regle('courriel', {
      actions: [{ type: 'send_email', config: { subject: 'Ancien objet', body: '<p>Ancien corps</p>' } }],
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Ancien objet', body: '<p>Ancien corps</p>' } }, suivant: null }],
    });
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_email', subject: `Votre facture ${R}`, body: 'Bonjour [client_first_name],\n\nVotre facture est en retard.\n\nMerci !' });
    const r = await lireRegle(id);
    const cfg = (r.steps ?? [])[0]?.action?.config ?? {};
    juger('courriel : objet et corps écrits dans `steps`', 'update_automation_message', rep, cfg, cfg.subject === `Votre facture ${R}` && String(cfg.body).includes('Votre facture est en retard') ? null : 'objet ou corps non écrit');
    juger('courriel : le corps est enregistré au format de l’éditeur (HTML, paragraphes)', 'update_automation_message', rep, cfg,
      /<p|<br/i.test(String(cfg.body)) ? null : 'le corps est enregistré en texte brut avec des sauts de ligne : l’éditeur de courriel écrit du HTML (<p>…) — à vérifier au rendu');
  }
  // 1.8 toggle_automation_rule : activer, puis « déjà fait » après un retour en brouillon à l'écran.
  {
    const id = await regle('bascule', { steps: [sms('e1', 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]')], actions: [] });
    const rep = await appeler('toggle_automation_rule', { rule_id: id, is_active: true });
    const relu = await textes(id);
    juger('activer : is_active relu = true', 'toggle_automation_rule', rep, relu, relu.is_active === true ? null : `réponse ${JSON.stringify(rep).slice(0, 120)} ; is_active en base = ${relu.is_active}`);
    const depub = await appelApi(sApi, 'POST', `/api/automations/rules/${id}/publication`, { actif: false });
    const rep2 = await appeler('toggle_automation_rule', { rule_id: id, is_active: true });
    const relu2 = await textes(id);
    juger('réactiver par Lumi dans les 10 min, après un retour en brouillon à l’écran', 'toggle_automation_rule', { depublication: depub.statut, rep2 }, relu2,
      relu2.is_active === true ? null : `l’outil répond is_active=${rep2?.is_active}${rep2?.deja_fait ? ' (« déjà fait »)' : ''} ; en base l’automatisation est toujours en BROUILLON — Lumi annonce une automatisation active qui ne part pas`);
    await admin.from('automation_rules').update({ is_active: false }).eq('id', id);
  }
  // 1.9 rename / duplicate / delete (lot entreprise).
  {
    const id = await regle('à renommer', { steps: [sms('e1', 'Bonjour.')] });
    const nom = `[QA-A relire ${R}] renommée par Lumi`;
    const rep = await appeler('rename_automation_rule', { rule_id: id, name: nom });
    const relu = await textes(id);
    juger('renommer : nom relu', 'rename_automation_rule', rep, relu, relu.name === nom && rep?.name === nom ? null : `nom en base « ${relu.name} », réponse « ${rep?.name} »`);
    const dup = await appeler('duplicate_automation_rule', { rule_id: id });
    const copie = dup?.rule_id ? await textes(dup.rule_id) : null;
    if (dup?.rule_id) crees.push(dup.rule_id);
    juger('dupliquer : la copie existe, en brouillon, même parcours', 'duplicate_automation_rule', dup, copie,
      copie && copie.is_active === false && JSON.stringify(copie.steps) === JSON.stringify(relu.steps) ? null : 'copie absente, active ou différente');
    const sup = await appeler('delete_automation_rule', { rule_id: id });
    const relu3 = await textes(id);
    juger('supprimer : à la corbeille, inactive', 'delete_automation_rule', sup, relu3, relu3.deleted_at && relu3.is_active === false ? null : 'la règle n’est pas à la corbeille');
  }
  // 1.10 pause_all_automations.
  {
    const lirePause = async () => (await admin.from('company_settings').select('automations_paused').eq('org_id', b.orgA).single()).data?.automations_paused;
    const rep = await appeler('pause_all_automations', { paused: true });
    const relu = await lirePause();
    juger('tout arrêter : company_settings.automations_paused relu', 'pause_all_automations', rep, relu, relu === true && rep?.paused === true ? null : `base ${relu}, réponse ${rep?.paused}`);
    const rep2 = await appeler('pause_all_automations', { paused: false });
    const relu2 = await lirePause();
    juger('reprendre : relu', 'pause_all_automations', rep2, relu2, relu2 === false && rep2?.paused === false ? null : `base ${relu2}, réponse ${rep2?.paused}`);
  }
  // 1.11 create_automation_from_template.
  {
    const modeles = await outil('list_automation_templates').handler!({ language: 'fr', category: undefined }, ctx as any) as any;
    const cle = modeles?.templates?.[0]?.template_key;
    const rep = await appeler('create_automation_from_template', { template_key: cle });
    if (rep?.rule_id) crees.push(rep.rule_id);
    const relu = rep?.rule_id ? await lireRegle(rep.rule_id) : null;
    juger('partir d’un modèle : la règle existe, en brouillon', 'create_automation_from_template', rep, relu ? { name: relu.name, is_active: relu.is_active, nb_steps: relu.steps?.length ?? 0, nb_actions: relu.actions?.length ?? 0 } : null,
      relu && relu.is_active === false ? null : 'règle absente ou active');
    if (relu) {
      const nbEtapesReelles = (relu.steps ?? []).length;
      juger('partir d’un modèle : `etapes` annoncé = étapes en base', 'create_automation_from_template', rep?.etapes, nbEtapesReelles,
        Number(rep?.etapes) === nbEtapesReelles ? null : `la réponse annonce ${rep?.etapes} étape(s) (valeur du catalogue), la base en porte ${nbEtapesReelles}`);
    }
  }
  // 1.12 create_automation_from_text (vrai modèle, ≈ 0,3 ¢).
  if (!SANS_MODELE) {
    const rep = await appeler('create_automation_from_text', { description: `Quand une facture est en retard, envoie un texto de rappel poli avec le lien de paiement (passe ${R}).` });
    if (rep?.rule_id) crees.push(rep.rule_id);
    const relu = rep?.rule_id ? await lireRegle(rep.rule_id) : null;
    juger('créer par une phrase : la règle existe, en brouillon, avec un parcours', 'create_automation_from_text', rep, relu ? { name: relu.name, is_active: relu.is_active, steps: relu.steps, actions: relu.actions } : null,
      relu && relu.is_active === false && (relu.steps ?? []).length > 0 ? null : 'règle absente, active ou sans parcours');
    if (relu) {
      juger('créer par une phrase : la réponse porte le TEXTE des messages enregistrés', 'create_automation_from_text', rep, relu.steps,
        (relu.steps ?? []).filter((e) => e.type === 'action').every((e) => JSON.stringify(rep).includes(String(e.action?.config?.body ?? '').slice(0, 30))) ? null
          : 'la réponse donne un résumé (`resume`) mais pas le texte exact des messages : Lumi ne peut pas le citer sans le réinventer');
    }
  }
  // 1.13 set_automation_language.
  {
    const lire = async () => (await admin.from('company_settings').select('default_language').eq('org_id', b.orgA).single()).data?.default_language;
    const rep = await appeler('set_automation_language', { language: 'en' });
    const relu = await lire();
    juger('langue des messages automatiques : relue', 'set_automation_language', rep, relu, relu === 'en' ? null : `base « ${relu} »`);
    await appeler('set_automation_language', { language: 'fr' });
    const rep3 = await appeler('set_automation_language', { language: 'en' });
    juger('langue : « en » redemandé après un retour à « fr » dans les 10 min', 'set_automation_language', rep3, await lire(), (await lire()) === 'en' ? null : `réponse ${JSON.stringify(rep3).slice(0, 100)} ; base « ${await lire()} »`);
    await admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
  }

  // ── 2. Outils qui ENVOIENT (bac à sable) ────────────────────────────────────────────────
  partie = '2-envois';
  if (!AUTO_SEULEMENT && !CRM_SEULEMENT) {
    const { data: cl } = await admin.from('clients').select('id, first_name').eq('org_id', b.orgA).eq('last_name', 'Tremblay-QA-A').single();
    const depuis = new Date(Date.now() - 2000).toISOString();
    const envois = async () => (await admin.from('envois_simules').select('canal, destinataire, corps, sujet').eq('org_id', b.orgA).gte('created_at', depuis)).data ?? [];
    // Sans fournisseur local, l'outil refuse AVANT le bac à sable : « non exécutable ici », pas un défaut.
    const local = (r: any) => (r?.error && /n.est pas configur|not configured/i.test(String(r.error)) ? null : r?.error ? `refus : ${r.error}` : undefined);
    const t1 = await appeler('send_sms', { client_id: cl!.id, body: `Test relire ${R}` });
    const e1 = (await envois()).filter((e) => String(e.corps).includes(`Test relire ${R}`));
    juger(`texto à un client : un envoi simulé existe${t1?.error ? ' (NON EXÉCUTABLE ICI : ' + t1.error + ')' : ''}`, 'send_sms', t1, e1, local(t1) !== undefined ? local(t1)! : e1.length === 1 ? null : `${e1.length} envoi(s) simulé(s) pour un « envoyé »`);
    const t2 = await appeler('send_email', { to: 'maryse.tremblay@lume-qa.test', subject: `Sujet relire ${R}`, message: 'Bonjour, ceci est un test.' });
    const e2 = (await envois()).filter((e) => String(e.sujet).includes(`Sujet relire ${R}`));
    juger(`courriel à un client : un envoi simulé existe${t2?.error ? ' (NON EXÉCUTABLE ICI : ' + t2.error + ')' : ''}`, 'send_email', t2, e2, local(t2) !== undefined ? local(t2)! : e2.length === 1 ? null : `${e2.length} envoi(s) simulé(s) pour un « envoyé »`);
    const t3 = await appeler('send_payment_reminders', {});
    juger('relances de paiement : la réponse compte ce qui est parti', 'send_payment_reminders', t3, (await envois()).length, null);
  }
} catch (e: any) {
  if (e?.message !== '__crm_seulement__') throw e;
} finally {
  // Ménage des règles de la partie 1.
  if (crees.length) {
    const maintenant = new Date().toISOString();
    await admin.from('automation_scheduled_tasks').update({ status: 'cancelled' }).in('automation_rule_id', crees).eq('status', 'pending');
    await admin.from('automation_rules').update({ is_active: false, deleted_at: maintenant, purged_at: maintenant }).in('id', crees);
  }
}

// ── Rapport (écrit à la sortie du processus : le scénario a1 se termine par process.exit) ──
function rapport(): void {
  const noms = ECRITURE.map((t) => t.declaration.name);
  if (CUMUL) {
    // Les mesures de la passe précédente d'abord : cette passe complète, elle ne remplace pas.
    try {
      const avant = JSON.parse(readFileSync(join(SORTIES, 'relire-apres-ecriture.json'), 'utf8'));
      const anciennes = (avant.mesures_brutes ?? []) as Mesure[];
      mesures.unshift(...anciennes);
      cas.unshift(...((avant.cas_automatisations ?? []) as Cas[]));
    } catch { /* pas de passe précédente */ }
  }
  const parOutil = new Map<string, Mesure[]>();
  for (const m of mesures) parOutil.set(m.outil, [...(parOutil.get(m.outil) ?? []), m]);
  const executes = noms.filter((n) => parOutil.has(n));
  const relus = executes.filter((n) => parOutil.get(n)!.some((m) => m.verdict === 'écrit' || m.verdict.startsWith('sans écriture')));
  const sansEcriture = mesures.filter((m) => m.verdict === 'sans écriture');
  const dejaFait = mesures.filter((m) => m.verdict === 'déjà fait');
  const defautsCas = cas.filter((c) => c.defaut);
  const outilsEnDefaut = [...new Set([...sansEcriture.map((m) => m.outil), ...defautsCas.map((c) => c.outil)])];
  const nonExecutes = noms.filter((n) => !parOutil.has(n));
  const jamaisReussi = executes.filter((n) => !relus.includes(n));
  const sortie = {
    quand: new Date().toISOString(),
    comptes: {
      outils_d_ecriture_recenses: noms.length, executes: executes.length, relus_apres_un_appel_reussi: relus.length,
      en_defaut: outilsEnDefaut.length, non_executes: nonExecutes.length, executes_sans_jamais_reussir: jamaisReussi.length, appels: mesures.length,
    },
    outils_en_defaut: outilsEnDefaut,
    cas_automatisations: cas,
    sans_ecriture: sansEcriture.map((m) => ({ outil: m.outil, args: m.args, reponse: m.reponse, journal: m.journal })),
    deja_fait: dejaFait.map((m) => ({ outil: m.outil, args: m.args, reponse: m.reponse })),
    non_executes: nonExecutes,
    executes_sans_jamais_reussir: jamaisReussi.map((n) => ({ outil: n, motifs: parOutil.get(n)!.map((m) => m.erreur ?? m.reponse?.error ?? m.verdict) })),
    sans_ecriture_annonce: mesures.filter((m) => m.verdict === 'sans écriture (annoncé)').map((m) => ({ outil: m.outil, reponse: m.reponse })),
    mesures: mesures.map((m) => ({ n: m.n, outil: m.outil, partie: m.partie, verdict: m.verdict, tables: m.metier, journal: m.journal, reponse: JSON.stringify(m.reponse ?? m.erreur).slice(0, 400) })),
    mesures_brutes: mesures,
  };
  writeFileSync(join(SORTIES, 'relire-apres-ecriture.json'), JSON.stringify(sortie, null, 1));
  const md = [
    `# Relecture après écriture — outils d'écriture de Lumi (${sortie.quand})`, '',
    `- Outils d'écriture recensés : **${noms.length}**`, `- Exécutés : **${executes.length}** (${mesures.length} appels)`,
    `- Relus après un appel réussi : **${relus.length}**`, `- En défaut : **${outilsEnDefaut.length}** — ${outilsEnDefaut.join(', ') || 'aucun'}`,
    `- Non exécutés : **${nonExecutes.length}** — ${nonExecutes.join(', ')}`,
    `- Exécutés sans jamais réussir (refus ou erreur) : **${jamaisReussi.length}** — ${jamaisReussi.join(', ')}`, '',
    '## Cas des automatisations (relecture exacte)', '',
    ...cas.map((c) => `- ${c.defaut ? '**DÉFAUT**' : 'ok'} \`${c.outil}\` — ${c.cas}${c.defaut ? ` : ${c.defaut}` : ''}`), '',
    '## Appels réussis SANS écriture métier', '',
    ...(sansEcriture.length ? sansEcriture.map((m) => `- \`${m.outil}\` ${JSON.stringify(m.args).slice(0, 140)} → ${JSON.stringify(m.reponse).slice(0, 220)}`) : ['(aucun)']), '',
    '## Appels « déjà fait » (résultat mémorisé, rien de refait)', '',
    ...(dejaFait.length ? dejaFait.map((m) => `- \`${m.outil}\` ${JSON.stringify(m.args).slice(0, 140)}`) : ['(aucun)']),
  ].join('\n');
  writeFileSync(join(SORTIES, 'relire-apres-ecriture.md'), md);
  console.log(`\n${md.split('\n').slice(0, 9).join('\n')}\nsortie : ${join(SORTIES, 'relire-apres-ecriture.json')}`);
}
process.on('exit', rapport);

// ── 3. Le reste du CRM : le scénario de la session a1, rejoué tel quel ─────────────────────
if (!AUTO_SEULEMENT) {
  partie = '3-crm';
  process.env.QA_COMPTE = COMPTES.proprioA.email;
  // Son `--sortie` : hors du dépôt.
  process.argv.push('--sortie', join(SORTIES, 'execution-a1.json'));
  await import(pathToFileURL(join(process.cwd(), 'scripts/qa/executer-outils-staging.mts')).href);
}
await db.end().catch(() => undefined);
process.exit(0);
