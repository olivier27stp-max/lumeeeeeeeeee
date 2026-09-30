/**
 * Banc du GOLDEN SET (T14) et du contrôle de vocabulaire (T3.11).
 *
 * Rejoue un preset sur un jeu de données FIXE (Marie Tremblay, visite le 25
 * sept. 2026 à 9 h, devis 1 626,90 $, facture INV-000042 due le 1er sept.)
 * avec l'horloge figée au 13 sept. 2026 11 h Montréal et le fuseau du processus
 * forcé sur America/Toronto (voir T9 pour la dépendance au fuseau du serveur).
 *
 * Le vrai moteur, le vrai bus, les vraies actions ; client Supabase
 * enregistreur ; Twilio et courriel remplacés par des enregistreurs. Les
 * actions différées sont ensuite DÉPILÉES à leur échéance pour obtenir le
 * texte réellement résolu — c'est ainsi que les 16 presets jamais vus en prod
 * produisent enfin une sortie observable.
 */
import { vi } from 'vitest';
import type { AutomationPresetDef } from '../../../server/lib/automationPresets.data';
import { clientEnregistreur, requetes } from '../../quarantaine/automation/_enregistreur';

export const HORLOGE = '2026-09-13T15:00:00Z'; // 11:00 EDT
/** La veille de l'horloge : donne au client une relation d'affaires en cours (LCAP). */
const VEILLE = '2026-09-12T15:00:00Z';
export const ORG = '11111111-1111-4111-8111-111111111111';
export const IDS = {
  client: 'aaaaaaaa-0000-4000-8000-000000000001',
  job: 'aaaaaaaa-0000-4000-8000-000000000002',
  visite: 'aaaaaaaa-0000-4000-8000-000000000003',
  devis: 'aaaaaaaa-0000-4000-8000-000000000004',
  facture: 'aaaaaaaa-0000-4000-8000-000000000005',
  owner: 'aaaaaaaa-0000-4000-8000-000000000006',
};

/**
 * Pipeline fixe des presets de ventes : le deal lié au devis part de
 * « Nouveau », sauf pour « avancer quand le client ouvre » qui n'agit QUE
 * depuis « Soumission envoyée » (jamais en arrière).
 */
const PIPELINE = 'bbbbbbbb-0000-4000-8000-000000000001';
const ETAPES = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000011', pipeline_id: PIPELINE, role_systeme: 'nouveau', position: 1, kind: 'open', archived_at: null, name_fr: 'Nouveau' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000012', pipeline_id: PIPELINE, role_systeme: 'soumission_envoyee', position: 2, kind: 'open', archived_at: null, name_fr: 'Soumission envoyée' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000013', pipeline_id: PIPELINE, role_systeme: 'soumission_ouverte', position: 3, kind: 'open', archived_at: null, name_fr: 'Soumission ouverte' },
];
export const nomEtape = (id: string) => ETAPES.find((e) => e.id === id)?.name_fr ?? id;

/** Filtres `eq`/`in` notés par l'enregistreur, appliqués aux colonnes présentes dans la ligne. */
function filtrer<T extends Record<string, unknown>>(lignes: T[], filtres: Array<[string, string, unknown]>): T[] {
  return lignes.filter((l) => filtres.every(([op, col, val]) => !(col in l)
    || (op === 'eq' ? l[col] === val : op === 'in' ? (val as unknown[]).includes(l[col]) : true)));
}

const CLIENT = { first_name: 'Marie', last_name: 'Tremblay', email: 'marie.tremblay@example.test', phone: '+15145550142', company: null };

/** Réponses du client enregistreur : le monde fixe vu par le moteur. */
export function monde(preset: AutomationPresetDef) {
  return {
    automation_rules: { data: [{ id: `regle-${preset.preset_key}`, org_id: ORG, name: preset.name, trigger_event: preset.trigger_event, conditions: preset.conditions, delay_seconds: preset.delay_seconds, actions: preset.actions, is_active: true }] },
    company_settings: { data: { company_name: 'Plomberie Tremblay inc.', phone: '+14505550199', default_language: 'fr', google_review_url: 'https://g.page/r/plomberie-tremblay/review', facebook_review_url: null, review_enabled: true } },
    // Un TABLEAU d'une fiche : `maybeSingle()` en rend la première, et la
    // recherche du consentement SMS (préfiltre sur les 4 derniers chiffres,
    // `.limit(50)`) attend une liste. Un objet seul faisait lever `.find`, lu
    // par le moteur comme « lecture du carnet impossible ».
    clients: { data: [{ id: IDS.client, ...CLIENT, status: 'lead', lead_status: preset.preset_key === 'lost_lead_reengagement' ? 'lost' : 'new', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null, deleted_at: null }] },
    // `created_at` la veille de l'horloge : ces presets se déclenchent APRÈS un
    // job ou une facture, donc le client a une relation d'affaires en cours.
    // Sans cette date, le calcul du consentement tacite (LCAP, 2 ans après un
    // contrat) ne trouve aucune base et bloque les envois — ce qui ressemblait
    // à 59 presets cassés alors que c'est le banc qui était incomplet.
    jobs: { data: { title: 'Nettoyage de gouttières', client_id: IDS.client, deposit_status: 'unpaid', currency: 'CAD', created_at: VEILLE, deleted_at: null } },
    schedule_events: { data: { id: IDS.visite, job_id: IDS.job, start_at: '2026-09-25T13:00:00Z', end_at: '2026-09-25T14:00:00Z', status: 'scheduled', deleted_at: null, job: { id: IDS.job, title: 'Nettoyage de gouttières', property_address: '412 rue des Érables, Longueuil', client_id: IDS.client, client_name: 'Marie Tremblay', clients: CLIENT } } },
    quotes: { data: { quote_number: 'Q-2026-042', total_cents: 162690, currency: 'CAD', valid_until: '2026-09-30', client_id: IDS.client, lead_id: null, job_id: IDS.job, status: 'sent', deleted_at: null, created_at: VEILLE,
      // Ouverture enregistrée AVANT l'émission de quote.viewed (vuesSoumission.ts) : la notification la cite.
      ...(preset.trigger_event === 'quote.viewed' ? { viewed_at: '2026-09-13T14:58:00Z', view_count: 1 } : {}) } },
    invoices: { data: { invoice_number: 'INV-000042', due_date: '2026-09-01', total_cents: 162690, client_id: IDS.client, job_id: IDS.job, status: 'sent', created_at: VEILLE, deleted_at: null } },
    job_agreements: { data: null },
    // Liste : la notification « équipe du deal » parcourt les membres actifs.
    memberships: { data: [{ user_id: IDS.owner, role: 'owner', status: 'active', language: 'fr' }] },
    deals: (req: any) => (req.op === 'update'
      ? { data: [{ id: 'deal-golden' }] }
      : { data: [{ id: 'deal-golden', pipeline_id: PIPELINE, stage_id: ETAPES[preset.preset_key === 'quote_opened_move_deal' ? 1 : 0].id, quote_id: IDS.devis, job_id: null, client_id: IDS.client, assigned_user_id: null, pipeline_stages: { kind: 'open' } }] }),
    pipeline_stages: (req: any) => ({ data: filtrer(ETAPES, req.filtres) }),
    'rpc:peut_voir_pipeline': { data: true },
    sms_opt_outs: { data: null },
    conversations: { data: { id: 'conv-1', client_id: IDS.client } },
    messages: { data: null, count: 0 },
    activity_log: { data: null, count: 0 },
    notifications: { data: null },
    tasks: { data: null },
    review_requests: { data: null },
    satisfaction_surveys: { data: { id: 'sondage-1' } },
    email_templates: { data: null },
    automation_execution_logs: { data: null },
    automation_scheduled_tasks: { data: null },
  } as Record<string, any>;
}

/** L'événement qui arme le preset, avec les métadonnées que ses conditions attendent. */
export function evenementPour(preset: AutomationPresetDef) {
  const base = { orgId: ORG, actorId: IDS.owner } as const;
  const parType: Record<string, { entityType: string; entityId: string; metadata: Record<string, unknown> }> = {
    'appointment.created': { entityType: 'schedule_event', entityId: IDS.visite, metadata: { job_id: IDS.job, client_id: IDS.client, start_time: '2026-09-25T13:00:00Z' } },
    'appointment.cancelled': { entityType: 'schedule_event', entityId: IDS.visite, metadata: { job_id: IDS.job, client_id: IDS.client } },
    'job.completed': { entityType: 'job', entityId: IDS.job, metadata: { job_name: 'Nettoyage de gouttières', client_id: IDS.client } },
    'agreement.signed': { entityType: 'job', entityId: IDS.job, metadata: { signer_name: 'Marie Tremblay' } },
    'quote.sent': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042', channel: 'email' } },
    'quote.approved': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042' } },
    // Même forme que l'émission réelle (vuesSoumission.ts) : première ouverture.
    'quote.viewed': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_id: IDS.devis, quote_number: 'Q-2026-042', client_id: IDS.client, is_first_view: true, view_count: 1, ouverture: ['premiere', 'chaque'], total_cents: 162690, montant: 1626.9, pipeline_id: null, stage_id: null, etiquette: [], service_id: [] } },
    'estimate.sent': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042' } },
    'invoice.sent': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042', client_id: IDS.client } },
    'invoice.paid': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042', amount_cents: 162690, payment_type: preset.preset_key === 'deposit_received' ? 'deposit' : 'full' } },
    'lead.created': { entityType: 'lead', entityId: IDS.client, metadata: { name: 'Marie Tremblay', email: CLIENT.email, phone: CLIENT.phone } },
    'lead.status_changed': { entityType: 'lead', entityId: IDS.client, metadata: { old_status: 'contacted', new_status: 'lost' } },
  };
  const e = parType[preset.trigger_event];
  if (!e) throw new Error(`aucun événement de test pour ${preset.trigger_event}`);
  return { ...base, ...e };
}

/** Ligne de réservation du moteur (`reserverExecution`), complétée ensuite par le résultat. */
const estReservation = (v: any) => v?.result_success === false && v?.result_error === 'en cours';

export interface Sortie {
  preset_key: string;
  trigger_event: string;
  delay_seconds: number;
  /** Tâches différées créées par l'événement (avant dépilage). */
  planifie: Array<{ action: string; execute_at: string; execution_key: string }>;
  /** Tout ce qui est parti ou a été écrit, immédiat puis différé, dans l'ordre. */
  messages: Array<{ canal: 'sms' | 'courriel' | 'notification' | 'tache' | 'activite' | 'avis' | 'deal'; to?: string; subject?: string; body: string; moment: 'immediat' | 'differe' }>;
  erreurs: string[];
  /** Tâches différées annulées par la condition d'arrêt au dépilage (jamais exécutées). */
  annulees: string[];
}

/**
 * Rejoue un preset : émission, puis dépilage de chaque tâche différée à son
 * échéance. Le fuseau du processus et l'horloge sont posés ici et restaurés
 * par l'appelant (afterEach).
 */
export async function jouer(preset: AutomationPresetDef, enregistreurs: { sms: any[]; courriels: any[] }): Promise<Sortie> {
  process.env.TZ = 'America/Toronto';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(HORLOGE));

  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const twilio = { messages: { create: vi.fn(async (p: any) => { enregistreurs.sms.push({ to: p.to, body: p.body, moment: 'immediat' }); return { sid: 'SM_golden' }; }) } };

  const { client, journal } = clientEnregistreur(monde(preset));
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' });
  // Chaque preset repart d'enregistreurs vides : un courriel immédiat qui
  // arrive en retard (premier chargement dynamique du module mailer) ne doit
  // pas être attribué au preset suivant.
  enregistreurs.sms.length = 0; enregistreurs.courriels.length = 0;
  const avantSms = 0, avantMails = 0;
  await eventBus.emit(preset.trigger_event as any, evenementPour(preset));
  // Le listener du bus est asynchrone : on attend que CHAQUE action de la règle
  // ait laissé sa trace (log d'exécution pour l'immédiat, insertion de tâche
  // pour le différé), avec une borne réelle de 5 s.
  const nbActions = preset.actions.length;
  // La RÉSERVATION anti-doublon (F3) insère d'abord une ligne « en cours » :
  // ce n'est pas encore le résultat de l'action, on attend la ligne finale.
  const traces = () => requetes(journal, 'automation_execution_logs', 'insert').filter((r) => !estReservation(r.valeur)).length + requetes(journal, 'automation_scheduled_tasks', 'insert').length;
  const limite = performance.now() + 5000;
  while (traces() < nbActions && performance.now() < limite) await new Promise((r) => setTimeout(r, 10));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  const messages: Sortie['messages'] = [];
  const erreurs: string[] = [];
  const collecter = (moment: 'immediat' | 'differe', depuisSms: number, depuisMails: number, journalDepuis: number) => {
    for (const s of enregistreurs.sms.slice(depuisSms)) messages.push({ canal: 'sms', to: s.to, body: s.body, moment });
    for (const c of enregistreurs.courriels.slice(depuisMails)) messages.push({ canal: 'courriel', to: c.to, subject: c.subject, body: c.html, moment });
    for (const r of journal.slice(journalDepuis)) {
      const v = r.valeur as any;
      if (r.table === 'deals' && r.op === 'update' && v?.stage_id) messages.push({ canal: 'deal', body: `étape → ${nomEtape(v.stage_id)}`, moment });
      if (r.op !== 'insert' || !v) continue;
      // Une notification ciblée insère une ligne PAR destinataire, en un seul appel.
      if (r.table === 'notifications') for (const n of [v].flat()) messages.push({ canal: 'notification', to: n.user_id ?? undefined, body: `${n.title}\n${n.body}`, moment });
      if (r.table === 'tasks') messages.push({ canal: 'tache', body: `${v.title}${v.description ? `\n${v.description}` : ''}`, moment });
      if (r.table === 'activity_log' && v.metadata?.source !== 'automation' && v.event_type !== 'review_requested') messages.push({ canal: 'activite', body: String(v.event_type), moment });
      if (r.table === 'review_requests') messages.push({ canal: 'avis', body: `${v.status}: ${v.subject_sent}`, moment });
      if (r.table === 'automation_execution_logs' && v.result_success === false && !estReservation(v)) erreurs.push(`${v.action_type}: ${v.result_error}`);
    }
  };
  // L'insert activity_log du bus lui-même (émission) précède tout : on l'ignore.
  const journalApresBus = 1;
  collecter('immediat', avantSms, avantMails, journalApresBus);

  const planifie = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => {
    const v = r.valeur as any;
    return { action: v.action_config.type as string, execute_at: v.execute_at as string, execution_key: v.execution_key as string, _config: v.action_config, _ligne: v };
  });

  // Dépilage de chaque tâche à son échéance. Un report d'heures calmes (le
  // tick ne fait que repousser execute_at) est suivi jusqu'à 3 fois, comme le
  // ferait la vraie file.
  const annulees: string[] = [];
  for (const t of planifie) {
    let echeance = t.execute_at;
    for (let tour = 0; tour < 4; tour++) {
    vi.setSystemTime(new Date(echeance));
    const tache = { id: `tache-${t.execution_key}`, org_id: ORG, automation_rule_id: t._ligne.automation_rule_id, entity_type: t._ligne.entity_type, entity_id: t._ligne.entity_id, attempts: 0, status: 'pending', execute_at: echeance, execution_key: t.execution_key, action_config: t._config, automation_rules: { name: preset.name, actions: preset.actions, conditions: preset.conditions } };
    const { client: c2, journal: j2 } = clientEnregistreur({ ...monde(preset), automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: tache.id }] }) });
    initAutomationEngine({ supabase: c2, twilio: { client: { messages: { create: vi.fn(async (p: any) => { enregistreurs.sms.push({ to: p.to, body: p.body }); return { sid: 'SM_golden' }; }) } }, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' });
    const s0 = enregistreurs.sms.length, m0 = enregistreurs.courriels.length;
    await processScheduledTasks(c2);
    const majs = requetes(j2, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter((v) => v && !('attempts' in v));
    const report = majs.find((v) => v.execute_at && !v.status);
    const annulation = majs.find((v) => v.status === 'cancelled');
    if (annulation) { annulees.push(`${t.action}@${t.execute_at}`); break; }
    if (report && enregistreurs.sms.length === s0 && enregistreurs.courriels.length === m0) { echeance = report.execute_at; continue; }
    for (const s of enregistreurs.sms.slice(s0)) messages.push({ canal: 'sms', to: s.to, body: s.body, moment: 'differe' });
    for (const c of enregistreurs.courriels.slice(m0)) messages.push({ canal: 'courriel', to: c.to, subject: c.subject, body: c.html, moment: 'differe' });
    for (const r of j2) {
      const v = r.valeur as any;
      if (r.table === 'deals' && r.op === 'update' && v?.stage_id) messages.push({ canal: 'deal', body: `étape → ${nomEtape(v.stage_id)}`, moment: 'differe' });
      if (r.op !== 'insert' || !v) continue;
      // Une notification ciblée insère une ligne PAR destinataire, en un seul appel.
      if (r.table === 'notifications') for (const n of [v].flat()) messages.push({ canal: 'notification', to: n.user_id ?? undefined, body: `${n.title}\n${n.body}`, moment: 'differe' });
      if (r.table === 'tasks') messages.push({ canal: 'tache', body: `${v.title}${v.description ? `\n${v.description}` : ''}`, moment: 'differe' });
      if (r.table === 'activity_log' && v.metadata?.source !== 'automation' && v.event_type !== 'review_requested') messages.push({ canal: 'activite', body: String(v.event_type), moment: 'differe' });
      if (r.table === 'review_requests') messages.push({ canal: 'avis', body: `${v.status}: ${v.subject_sent}`, moment: 'differe' });
      if (r.table === 'automation_execution_logs' && v.result_success === false && !estReservation(v)) erreurs.push(`${v.action_type}: ${v.result_error}`);
    }
    break;
    }
  }

  // Le jeton d'un sondage d'avis est aléatoire (crypto.randomUUID) : on le
  // neutralise pour que la sortie soit comparable d'une passe à l'autre.
  for (const m of messages) m.body = m.body.replace(/\/survey\/[0-9a-f]{32}/g, '/survey/<jeton>');

  return {
    preset_key: preset.preset_key, trigger_event: preset.trigger_event, delay_seconds: preset.delay_seconds,
    planifie: planifie.map(({ action, execute_at, execution_key }) => ({ action, execute_at, execution_key })),
    messages, erreurs, annulees,
  };
}
