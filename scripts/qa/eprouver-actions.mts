/* ═══════════════════════════════════════════════════════════════
   ÉPROUVER CHAQUE ACTION — sur le vrai moteur.

   Pendant du banc des déclencheurs (`eprouver-declencheurs.mts`), qui a
   prouvé les 23 déclencheurs. Le catalogue offre 21 ACTIONS ; mesuré en
   prod, ~5 seulement avaient laissé une trace. Les autres étaient
   « plausibles » — c'est-à-dire non prouvées.

   Une action offerte dans l'écran mais qui échoue à l'exécution est pire
   qu'une action absente : le client la configure, la règle se dit
   « Publiée », et rien n'arrive. Personne ne le voit, parce que l'échec
   vit dans automation_execution_logs et que personne ne lit cette table.

   CE QUE FAIT CE BANC. Il monte un décor complet (client, soumission,
   facture, deal, rendez-vous, champ personnalisé, seconde règle), puis
   pour chaque action : il crée une règle qui la porte SEULE, émet le VRAI
   événement par le bus — le même chemin que la production — et lit le
   journal d'exécution. Quand l'action mute une donnée, il vérifie AUSSI
   la donnée : une action qui se déclare réussie sans rien changer est
   précisément le genre de bogue qu'on cherche.

   Aucun message ne part vers un vrai client : le décor est un client
   `@example.invalid`, et staging n'a pas d'identifiants d'envoi. Un envoi
   qui échoue faute d'identifiants est signalé comme tel, pas confondu
   avec une action cassée.

   Usage : npm run qa:actions
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';
import { createServer } from 'node:http';

const URL_SB = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL_SB || !KEY) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(1);
}
/* Ce banc ÉCRIT. Le garde est sur la référence de prod, comme le banc des
   déclencheurs : une variable oubliée ne doit pas suffire à viser la prod. */
if (/bbzcuzqfgsdvjsymfwmr/.test(URL_SB) || (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD))) {
  console.error('REFUS : ce banc crée des règles, des tâches et mute des données — jamais sur la production.');
  process.exit(1);
}

const admin = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const MARQUE = '[QA-ACT]';
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Le décor ────────────────────────────────────────────────────────────
console.log('Décor…');

/* Une org qui a déjà un pipeline avec des étapes : les actions de deal en
   ont besoin, et les recréer de zéro ferait dépendre le banc du seed. */
const { data: candidats } = await admin
  .from('pipelines_ventes')
  .select('org_id, id, pipeline_stages(id, position)')
  .limit(40);

/*
 * Il faut une org qui ait À LA FOIS un pipeline de 2 étapes et un membre :
 * les actions de deal ont besoin des étapes, et `assigner_responsable` d'un
 * membre. Prendre le premier pipeline venu tombait sur une org vide — et le
 * banc concluait à tort, ce qui est pire que pas de banc.
 */
let ORG = '', PIPELINE = '', ETAPE_A = '', ETAPE_B = '', USER = '';
for (const c of (candidats ?? []) as any[]) {
  const etapes = [...(c.pipeline_stages ?? [])].sort((a: any, b: any) => a.position - b.position);
  if (etapes.length < 2) continue;
  const { data: m } = await admin.from('memberships').select('user_id').eq('org_id', c.org_id).limit(1).maybeSingle();
  if (!m?.user_id) continue;
  ORG = c.org_id; PIPELINE = c.id; ETAPE_A = etapes[0].id; ETAPE_B = etapes[1].id; USER = m.user_id;
  break;
}
if (!ORG) {
  console.error('Aucune org avec un pipeline de 2 étapes ET un membre sur cette base.');
  process.exit(1);
}

const suffixe = Date.now().toString(36);

const { data: client, error: eClient } = await admin.from('clients').insert({
  org_id: ORG, first_name: 'Banc', last_name: `Actions ${suffixe}`,
  email: `qa-actions-${suffixe}@example.invalid`, phone: '+15555550100',
  status: 'active', created_by: USER,
}).select('id').single();
if (eClient || !client) { console.error('Décor — client :', eClient?.message ?? 'aucune ligne'); process.exit(1); }
const CLIENT = client.id as string;

/* Les étiquettes sont une TABLE (`client_tags`), pas une colonne de `clients` :
   ma première version vérifiait `clients.tags` et concluait à tort que
   `ajouter_etiquette` ne faisait rien. L'étiquette de départ doit donc être
   semée là où l'action va la chercher. */
await admin.from('client_tags').insert({ client_id: CLIENT, tag: 'QA-DEPART' });

/*
 * Chaque insertion du décor est vérifiée. Une fixture absente faisait
 * planter le banc 80 lignes plus loin sur un `null`, ou pire : le laissait
 * conclure qu'une action est cassée alors que c'est le décor qui manquait.
 */
const exige = <T,>(quoi: string, r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error || !r.data) {
    console.error(`Décor — ${quoi} : ${r.error?.message ?? 'aucune ligne rendue'}`);
    process.exit(1);
  }
  return r.data;
};

const r_quote = await admin.from('quotes').insert({
  org_id: ORG, quote_number: `QA-${suffixe}`, client_id: CLIENT, status: 'draft',
  title: `${MARQUE} soumission`, total_cents: 12500, created_by: USER,
}).select('id').single();

const r_invoice = await admin.from('invoices').insert({
  org_id: ORG, invoice_number: `QA-${suffixe}`, client_id: CLIENT, status: 'draft',
  total_cents: 12500, balance_cents: 12500, created_by: USER,
  // `envoyer_facture` refuse un document sans lien public — c'est voulu.
  public_token: `qa-${suffixe}`,
}).select('id').single();

const r_deal = await admin.from('deals').insert({
  org_id: ORG, pipeline_id: PIPELINE, stage_id: ETAPE_A, client_id: CLIENT, created_by: USER,
}).select('id').single();

const r_rdv = await admin.from('schedule_events').insert({
  org_id: ORG, title: `${MARQUE} rendez-vous`, status: 'scheduled',
  start_at: new Date(Date.now() + 86400000).toISOString(),
  end_at: new Date(Date.now() + 90000000).toISOString(), created_by: USER,
}).select('id').single();

const r_champ = await admin.from('custom_fields').insert({
  org_id: ORG, object_type: 'client', key: `qa_actions_${suffixe}`,
  label: `${MARQUE} champ`, field_type: 'single_line',
}).select('id').single();

/* Cible de `demarrer_automatisation`. L'action n'ALLUME pas une règle : elle
   EXÉCUTE une règle déjà publiée pour l'entité courante. Une cible en
   brouillon est donc refusée — à raison. */
const r_regleCible = await admin.from('automation_rules').insert({
  org_id: ORG, name: `${MARQUE} cible`, trigger_event: 'note.added',
  conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
  actions: [{ type: 'create_task', config: { title: `${MARQUE} cible` } }],
}).select('id').single();

const quote = exige('soumission', r_quote as never) as { id: string };
const invoice = exige('facture', r_invoice as never) as { id: string };
const deal = exige('deal', r_deal as never) as { id: string };
const rdv = exige('rendez-vous', r_rdv as never) as { id: string };
const champ = exige('champ personnalisé', r_champ as never) as { id: string };
const regleCible = exige('règle cible', r_regleCible as never) as { id: string };

// Récepteur local pour l'action `webhook` : la seule preuve honnête est
// qu'un vrai appel arrive.
const recus: string[] = [];
const serveur = createServer((req, res) => { recus.push(req.url ?? ''); res.writeHead(200); res.end('ok'); });
await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', () => r()));
const PORT = (serveur.address() as any).port as number;

console.log(`  org=${ORG}  client=${CLIENT}  deal=${deal.id}  port webhook=${PORT}\n`);

// ── Le moteur, dans ce processus ─────────────────────────────────────────
const { eventBus } = await import('../../server/lib/eventBus');
const { initAutomationEngine } = await import('../../server/lib/automationEngine');
initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' } as never);

// ── Les 21 actions du catalogue ──────────────────────────────────────────
type Cas = {
  cle: string;
  config: Record<string, unknown>;
  declencheur: string;
  entite: string;
  entityId: string;
  /** Preuve propre à l'action, au-delà du journal. */
  verifier?: () => Promise<string | null>;
};

const lireClient = async (col: string) => {
  const { data } = await admin.from('clients').select(col).eq('id', CLIENT).maybeSingle();
  return (data as any)?.[col];
};
const lireDeal = async (col: string) => {
  const { data } = await admin.from('deals').select(col).eq('id', deal.id).maybeSingle();
  return (data as any)?.[col];
};

const CAS: Cas[] = [
  { cle: 'send_email', config: { subject: `${MARQUE} sujet`, body: 'Bonjour [client_first_name]' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'send_sms', config: { body: 'Bonjour [client_first_name]' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'create_notification', config: { title: `${MARQUE} notif`, body: 'corps', destinataire: 'membre', membre_id: USER },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG).eq('title', `${MARQUE} notif`);
      return (count ?? 0) > 0 ? null : 'aucune notification écrite';
    } },
  { cle: 'create_task', config: { title: `${MARQUE} tâche`, priorite: 'medium' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG).eq('title', `${MARQUE} tâche`);
      return (count ?? 0) > 0 ? null : 'aucune tâche écrite';
    } },
  { cle: 'ajouter_note', config: { body: `${MARQUE} note du banc` },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('notes').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG).eq('entity_id', CLIENT);
      return (count ?? 0) > 0 ? null : 'aucune note écrite';
    } },
  { cle: 'ajouter_etiquette', config: { etiquette: 'QA-AJOUT' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('client_tags').select('tag', { count: 'exact', head: true })
        .eq('client_id', CLIENT).eq('tag', 'QA-AJOUT');
      return (count ?? 0) > 0 ? null : 'étiquette absente de client_tags';
    } },
  { cle: 'retirer_etiquette', config: { etiquette: 'QA-DEPART' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('client_tags').select('tag', { count: 'exact', head: true })
        .eq('client_id', CLIENT).eq('tag', 'QA-DEPART');
      return (count ?? 0) === 0 ? null : 'étiquette toujours dans client_tags';
    } },
  { cle: 'modifier_client', config: { statut: 'inactive' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => (await lireClient('status')) === 'inactive' ? null : `statut = ${await lireClient('status')}` },
  { cle: 'assigner_responsable', config: { membre_id: USER },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => (await lireClient('assigned_to')) ? null : 'assigned_to vide' },
  { cle: 'update_custom_field', config: { field_id: champ.id, value: 'valeur-banc' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'request_review', config: { body: `${MARQUE} avis` },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'envoyer_slack', config: { body: `${MARQUE} slack` },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  /*
   * Le webhook n'est pas éprouvable depuis un banc local : le moteur exige
   * une adresse `https://` PUBLIQUE, garde anti-SSRF délibéré. Un récepteur
   * sur 127.0.0.1 est refusé — et c'est le bon comportement. On le vise
   * quand même pour PROUVER que le garde mord, plutôt que de sauter l'action.
   */
  { cle: 'webhook', config: { url: `http://127.0.0.1:${PORT}/qa-actions` },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'demarrer_automatisation', config: { rule_id: regleCible.id },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT,
    verifier: async () => {
      const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG).eq('title', `${MARQUE} cible`);
      return (count ?? 0) > 0 ? null : 'la règle cible n’a pas produit sa tâche';
    } },
  { cle: 'arreter_automatisation', config: { portee: 'courante' },
    declencheur: 'note.added', entite: 'client', entityId: CLIENT },
  { cle: 'move_deal_stage', config: { stage_id: ETAPE_B },
    declencheur: 'deal.stage_entered', entite: 'deal', entityId: deal.id,
    verifier: async () => (await lireDeal('stage_id')) === ETAPE_B ? null : 'le deal n’a pas changé d’étape' },
  { cle: 'modifier_deal', config: { source: 'banc-qa' },
    declencheur: 'deal.stage_entered', entite: 'deal', entityId: deal.id,
    verifier: async () => (await lireDeal('source')) === 'banc-qa' ? null : `source = ${await lireDeal('source')}` },
  { cle: 'assigner_deal', config: { membre_id: USER },
    declencheur: 'deal.stage_entered', entite: 'deal', entityId: deal.id,
    verifier: async () => (await lireDeal('assigned_user_id')) ? null : 'assigned_user_id vide' },
  { cle: 'modifier_statut_rendezvous', config: { statut: 'completed' },
    declencheur: 'appointment.created', entite: 'schedule_event', entityId: rdv.id,
    verifier: async () => {
      const { data } = await admin.from('schedule_events').select('status').eq('id', rdv.id).maybeSingle();
      return data?.status === 'completed' ? null : `statut = ${data?.status}`;
    } },
  { cle: 'envoyer_soumission', config: { body: `${MARQUE} envoi soumission` },
    declencheur: 'quote.sent', entite: 'quote', entityId: quote.id },
  { cle: 'envoyer_facture', config: { body: `${MARQUE} envoi facture` },
    declencheur: 'invoice.sent', entite: 'invoice', entityId: invoice.id },
];

// ── Exécution ───────────────────────────────────────────────────────────
type Verdict = 'ok' | 'echec' | 'sans_identifiants' | 'differee' | 'garde' | 'non_dispatchee';
const resultats: Array<{ cle: string; verdict: Verdict; detail: string }> = [];

/** Un échec d'ENVOI faute d'identifiants n'est pas une action cassée. */
const MANQUE_IDENTIFIANTS = /twilio|credential|api key|unauthorized|not configured|n’est pas configuré|resend|smtp|sendgrid|\bses\b/i;
/* Un garde VOLONTAIRE du produit qui refuse : ce n'est pas une action cassée,
   c'est le produit qui fait son travail. Les confondre ferait chercher un bug
   là où il y a une protection. */
const GARDE_VOLONTAIRE = /publique seulement|https:\/\/|disabled in Settings|désactivé|brouillon|ne peut pas se démarrer elle-même|Aucun lien public/i;

for (const cas of CAS) {
  const nom = `${MARQUE} ${cas.cle}`;
  const { data: regle, error } = await admin.from('automation_rules').insert({
    org_id: ORG, name: nom, trigger_event: cas.declencheur,
    conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
    actions: [{ type: cas.cle, config: cas.config }],
  }).select('id').single();

  if (error) {
    resultats.push({ cle: cas.cle, verdict: 'echec', detail: `règle refusée : ${error.message.slice(0, 60)}` });
    continue;
  }

  await eventBus.emit(cas.declencheur as never, {
    orgId: ORG, entityType: cas.entite, entityId: cas.entityId, metadata: {},
  });

  /*
   * On SONDE au lieu d'attendre un délai fixe. Ces déclencheurs portent
   * plusieurs préréglages de l'org, qui s'exécutent en série avant la nôtre :
   * avec 3 s fixes, une action passait au vert à un essai et au rouge au
   * suivant, selon la charge. Un banc instable ne prouve rien — on finit par
   * le relancer jusqu'à ce qu'il soit vert, ce qui est l'inverse du but.
   */
  const jusqua = Date.now() + 20_000;
  let log: { result_success: boolean; result_error: string | null } | undefined;
  let differee = 0;
  while (Date.now() < jusqua) {
    const { data: logs } = await admin.from('automation_execution_logs')
      .select('result_success, result_error')
      .eq('automation_rule_id', regle.id)
      .order('created_at', { ascending: false }).limit(1);
    // Depuis F3, la ligne de journal est RÉSERVÉE avant l'exécution
    // (« en cours ») puis complétée : seule la ligne complétée est un résultat.
    // Encore « en cours » au bout de 20 s = une action vraiment bloquée.
    if (logs?.[0]) { log = logs[0] as never; if (log!.result_error !== 'en cours') break; }
    const { count } = await admin.from('automation_scheduled_tasks')
      .select('id', { count: 'exact', head: true }).eq('automation_rule_id', regle.id);
    if ((count ?? 0) > 0) { differee = count ?? 0; break; }
    await attendre(500);
  }

  if (!log) {
    /*
     * Pas de journal ne veut pas dire « pas dispatchée » : hors de la fenêtre
     * d'envoi, le moteur REPORTE les SMS et les courriels au lieu de les
     * exécuter. Ma première version criait « jamais dispatchée » sur send_sms
     * simplement parce que le banc tournait à 20 h 32.
     */
    resultats.push(differee > 0
      ? { cle: cas.cle, verdict: 'differee', detail: 'reportée à la fenêtre d’envoi (heures de silence)' }
      : { cle: cas.cle, verdict: 'non_dispatchee', detail: 'aucun journal, aucune tâche planifiée après 20 s' });
  } else if (!log.result_success) {
    const err = (log.result_error ?? '').slice(0, 90);
    const verdict: Verdict = GARDE_VOLONTAIRE.test(err) ? 'garde'
      : MANQUE_IDENTIFIANTS.test(err) ? 'sans_identifiants' : 'echec';
    resultats.push({ cle: cas.cle, verdict, detail: err || 'échec sans message' });
  } else {
    const souci = cas.verifier ? await cas.verifier() : null;
    resultats.push(souci
      ? { cle: cas.cle, verdict: 'echec', detail: `journal OK mais ${souci}` }
      : { cle: cas.cle, verdict: 'ok', detail: cas.verifier ? 'exécutée et effet vérifié' : 'exécutée' });
  }

  await admin.from('automation_rules').delete().eq('id', regle.id);
}

// ── Ménage ──────────────────────────────────────────────────────────────
serveur.close();

/*
 * Ménage VÉRIFIÉ. Sans contrôle, un décor qui résiste (clé étrangère,
 * suppression logique) s'accumule à chaque passage : mesuré, les champs
 * personnalisés passaient de 2 à 3 d'un essai à l'autre. Un banc qui salit
 * la base finit par être interdit d'usage.
 */
const restes: string[] = [];
// Le builder de supabase-js est « thenable » sans être une vraie Promise :
// `PromiseLike` est donc le bon type, `Promise` ne compile pas.
const nettoyer = async (quoi: string, f: () => PromiseLike<{ error: { message: string } | null }>) => {
  const { error } = await f();
  if (error) restes.push(`${quoi} : ${error.message.slice(0, 70)}`);
};

await nettoyer('tâches', () => admin.from('tasks').delete().eq('org_id', ORG).like('title', `${MARQUE}%`));
await nettoyer('notifications', () => admin.from('notifications').delete().eq('org_id', ORG).like('title', `${MARQUE}%`));
await nettoyer('notes', () => admin.from('notes').delete().eq('org_id', ORG).eq('entity_id', CLIENT));
await nettoyer('étiquettes', () => admin.from('client_tags').delete().eq('client_id', CLIENT));
await nettoyer('journaux', () => admin.from('automation_execution_logs').delete().eq('org_id', ORG).eq('entity_id', CLIENT));
await nettoyer('règles', () => admin.from('automation_rules').delete().eq('org_id', ORG).like('name', `${MARQUE}%`));
await nettoyer('champ personnalisé', () => admin.from('custom_fields').delete().eq('id', champ.id));
await nettoyer('deal', () => admin.from('deals').delete().eq('id', deal.id));
await nettoyer('rendez-vous', () => admin.from('schedule_events').delete().eq('id', rdv.id));
await nettoyer('facture', () => admin.from('invoices').delete().eq('id', invoice.id));
await nettoyer('soumission', () => admin.from('quotes').delete().eq('id', quote.id));
await nettoyer('client', () => admin.from('clients').delete().eq('id', CLIENT));

if (restes.length) {
  console.log('\n⚠ MÉNAGE INCOMPLET — à supprimer à la main :');
  for (const r of restes) console.log(`   ${r}`);
}

// ── Rapport ─────────────────────────────────────────────────────────────
const par = (v: Verdict) => resultats.filter((r) => r.verdict === v);
const bloc = (titre: string, v: Verdict) => {
  const l = par(v);
  if (!l.length) return;
  console.log(`\n${titre}`);
  for (const r of l) console.log(`   ${r.cle.padEnd(28)} ${r.detail}`);
};

bloc('✓ ACTIONS PROUVÉES — exécutées, et l’effet constaté', 'ok');
bloc('⏱ REPORTÉES par la fenêtre d’envoi — le moteur a fait son travail', 'differee');
bloc('⚠ ENVOI SANS IDENTIFIANTS sur staging — dispatchée, pas envoyée', 'sans_identifiants');
bloc('🛡 REFUSÉES PAR UN GARDE du produit — comportement voulu', 'garde');
bloc('✗ ACTIONS QUI ÉCHOUENT', 'echec');
bloc('✗ ACTIONS JAMAIS DISPATCHÉES', 'non_dispatchee');

const casses = [...par('echec'), ...par('non_dispatchee')];
const couvertes = resultats.length - casses.length;
console.log(`\n${couvertes} / ${resultats.length} actions se comportent comme prévu`);
console.log(`   ${par('ok').length} prouvées de bout en bout · ${par('differee').length} reportées · ${par('sans_identifiants').length} sans identifiants · ${par('garde').length} refusées par un garde`);
if (casses.length) console.log(`   ${casses.length} À CORRIGER`);
process.exit(casses.length ? 1 : 0);
