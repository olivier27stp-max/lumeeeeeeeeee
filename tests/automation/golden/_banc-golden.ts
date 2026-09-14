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
import { clientEnregistreur, requetes } from '../_enregistreur';

export const HORLOGE = '2026-09-13T15:00:00Z'; // 11:00 EDT
export const ORG = '11111111-1111-4111-8111-111111111111';
export const IDS = {
  client: 'aaaaaaaa-0000-4000-8000-000000000001',
  job: 'aaaaaaaa-0000-4000-8000-000000000002',
  visite: 'aaaaaaaa-0000-4000-8000-000000000003',
  devis: 'aaaaaaaa-0000-4000-8000-000000000004',
  facture: 'aaaaaaaa-0000-4000-8000-000000000005',
  owner: 'aaaaaaaa-0000-4000-8000-000000000006',
};

const CLIENT = { first_name: 'Marie', last_name: 'Tremblay', email: 'marie.tremblay@example.test', phone: '+15145550142', company: null };

/** Réponses du client enregistreur : le monde fixe vu par le moteur. */
export function monde(preset: AutomationPresetDef) {
  return {
    automation_rules: { data: [{ id: `regle-${preset.preset_key}`, org_id: ORG, name: preset.name, trigger_event: preset.trigger_event, conditions: preset.conditions, delay_seconds: preset.delay_seconds, actions: preset.actions, is_active: true }] },
    company_settings: { data: { company_name: 'Plomberie Tremblay inc.', phone: '+14505550199', default_language: 'fr', google_review_url: 'https://g.page/r/plomberie-tremblay/review', facebook_review_url: null, review_enabled: true } },
    clients: { data: { ...CLIENT, status: 'lead', lead_status: preset.preset_key === 'lost_lead_reengagement' ? 'lost' : 'new', deleted_at: null } },
    jobs: { data: { title: 'Nettoyage de gouttières', client_id: IDS.client, deposit_status: 'unpaid', currency: 'CAD' } },
    schedule_events: { data: { id: IDS.visite, job_id: IDS.job, start_at: '2026-09-25T13:00:00Z', end_at: '2026-09-25T14:00:00Z', status: 'scheduled', deleted_at: null, job: { id: IDS.job, title: 'Nettoyage de gouttières', property_address: '412 rue des Érables, Longueuil', client_id: IDS.client, client_name: 'Marie Tremblay', clients: CLIENT } } },
    quotes: { data: { quote_number: 'Q-2026-042', total_cents: 162690, currency: 'CAD', valid_until: '2026-09-30', client_id: IDS.client, lead_id: null, job_id: IDS.job, status: 'sent', deleted_at: null } },
    invoices: { data: { invoice_number: 'INV-000042', due_date: '2026-09-01', total_cents: 162690, client_id: IDS.client, job_id: IDS.job, status: 'sent' } },
    job_agreements: { data: null },
    memberships: { data: { user_id: IDS.owner } },
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

export interface Sortie {
  preset_key: string;
  trigger_event: string;
  delay_seconds: number;
  /** Tâches différées créées par l'événement (avant dépilage). */
  planifie: Array<{ action: string; execute_at: string; execution_key: string }>;
  /** Tout ce qui est parti ou a été écrit, immédiat puis différé, dans l'ordre. */
  messages: Array<{ canal: 'sms' | 'courriel' | 'notification' | 'tache' | 'activite' | 'avis'; to?: string; subject?: string; body: string; moment: 'immediat' | 'differe' }>;
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
  // Les réservations d'idempotence (F3, status `running`) précèdent l'exécution :
  // elles ne comptent pas comme trace, sinon on lirait la sortie trop tôt.
  const traces = () => requetes(journal, 'automation_execution_logs', 'insert').length
    + requetes(journal, 'automation_scheduled_tasks', 'insert').filter((r) => (r.valeur as any).status === 'pending').length;
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
      if (r.op !== 'insert' || !v) continue;
      if (r.table === 'notifications') messages.push({ canal: 'notification', body: `${v.title}\n${v.body}`, moment });
      if (r.table === 'tasks') messages.push({ canal: 'tache', body: `${v.title}${v.description ? `\n${v.description}` : ''}`, moment });
      if (r.table === 'activity_log' && v.metadata?.source !== 'automation' && v.event_type !== 'review_requested') messages.push({ canal: 'activite', body: String(v.event_type), moment });
      if (r.table === 'review_requests') messages.push({ canal: 'avis', body: `${v.status}: ${v.subject_sent}`, moment });
      if (r.table === 'automation_execution_logs' && v.result_success === false) erreurs.push(`${v.action_type}: ${v.result_error}`);
    }
  };
  // L'insert activity_log du bus lui-même (émission) précède tout : on l'ignore.
  const journalApresBus = 1;
  collecter('immediat', avantSms, avantMails, journalApresBus);

  // Les réservations d'idempotence des actions immédiates (F3, status `running`)
  // ne sont pas des planifications : seules les tâches `pending` comptent.
  const planifie = requetes(journal, 'automation_scheduled_tasks', 'insert').filter((r) => (r.valeur as any).status === 'pending').map((r) => {
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
      if (r.op !== 'insert' || !v) continue;
      if (r.table === 'notifications') messages.push({ canal: 'notification', body: `${v.title}\n${v.body}`, moment: 'differe' });
      if (r.table === 'tasks') messages.push({ canal: 'tache', body: `${v.title}${v.description ? `\n${v.description}` : ''}`, moment: 'differe' });
      if (r.table === 'activity_log' && v.metadata?.source !== 'automation' && v.event_type !== 'review_requested') messages.push({ canal: 'activite', body: String(v.event_type), moment: 'differe' });
      if (r.table === 'review_requests') messages.push({ canal: 'avis', body: `${v.status}: ${v.subject_sent}`, moment: 'differe' });
      if (r.table === 'automation_execution_logs' && v.result_success === false) erreurs.push(`${v.action_type}: ${v.result_error}`);
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
