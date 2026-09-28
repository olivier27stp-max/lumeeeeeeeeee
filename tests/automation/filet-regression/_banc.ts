/**
 * Banc du FILET DE RÉGRESSION des automatisations.
 *
 * Rejoue une règle (déclencheur + actions, ou séquence) sur un monde FIXE avec
 * le VRAI moteur, le VRAI bus et les VRAIES actions, puis dépile chaque tâche
 * différée à son échéance — y compris les étapes suivantes d'une séquence.
 * Tout ce qui sort est capturé : écritures en base (insert/update/delete/RPC,
 * avec leurs filtres), SMS, courriels, appels sortants (webhook, Slack),
 * planifications et annulations.
 *
 * Le résultat est un instantané : il décrit le comportement ACTUEL, bugs
 * compris. Il ne juge rien. Son seul rôle est de rester identique quand une
 * PR ne doit rien changer (drapeau OFF).
 *
 * Horloge figée au 13 sept. 2026 11 h Montréal, fuseau du processus forcé :
 * le résultat ne dépend ni de la machine ni du jour.
 */
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { clientEnregistreur, requetes, type Requete } from './_enregistreur';

export const HORLOGE = '2026-09-13T15:00:00Z';
const VEILLE = '2026-09-12T15:00:00Z';
export const ORG = '11111111-1111-4111-8111-111111111111';
export const IDS = {
  client: 'aaaaaaaa-0000-4000-8000-000000000001',
  job: 'aaaaaaaa-0000-4000-8000-000000000002',
  visite: 'aaaaaaaa-0000-4000-8000-000000000003',
  devis: 'aaaaaaaa-0000-4000-8000-000000000004',
  facture: 'aaaaaaaa-0000-4000-8000-000000000005',
  owner: 'aaaaaaaa-0000-4000-8000-000000000006',
  deal: 'aaaaaaaa-0000-4000-8000-000000000007',
  pipeline: 'aaaaaaaa-0000-4000-8000-000000000008',
  etape: 'aaaaaaaa-0000-4000-8000-000000000009',
  etape2: 'aaaaaaaa-0000-4000-8000-00000000000a',
  membre: 'aaaaaaaa-0000-4000-8000-00000000000b',
  champ: 'aaaaaaaa-0000-4000-8000-00000000000c',
  webhook: 'aaaaaaaa-0000-4000-8000-00000000000d',
  autreRegle: 'aaaaaaaa-0000-4000-8000-00000000000e',
  tache: 'aaaaaaaa-0000-4000-8000-00000000000f',
};
const CONNUS = new Set(Object.values(IDS).concat(ORG));

const CLIENT = {
  id: IDS.client, org_id: ORG, first_name: 'Marie', last_name: 'Tremblay', email: 'marie.tremblay@example.test',
  phone: '+15145550142', company: null, status: 'active', lead_status: 'new', deleted_at: null,
  email_consent_at: null, sms_consent_at: null, email_opt_out_at: null, created_at: VEILLE,
  source: 'site_web', assigned_to: null, estimated_value: null, language: 'fr',
};

export interface Regle {
  trigger_event: string;
  conditions?: Record<string, unknown>;
  delay_seconds?: number;
  actions?: Array<{ type: string; config: Record<string, unknown> }>;
  steps?: unknown[] | null;
  settings?: Record<string, unknown> | null;
  name?: string;
  preset_key?: string | null;
}

export interface Evenement { entityType: string; entityId: string; metadata: Record<string, unknown> }

/** Le monde fixe vu par le moteur. `surcharges` remplace une table entière. */
export function monde(regle: Regle & { id: string }, surcharges: Record<string, unknown> = {}) {
  const ligneRegle = {
    id: regle.id, org_id: ORG, name: regle.name ?? regle.id, trigger_event: regle.trigger_event,
    conditions: regle.conditions ?? {}, delay_seconds: regle.delay_seconds ?? 0, actions: regle.actions ?? [],
    steps: regle.steps ?? null, settings: regle.settings ?? null, is_active: true, deleted_at: null,
    pipeline_id: null, stage_id: null, preset_key: regle.preset_key ?? null,
  };
  return {
    automation_rules: { data: [ligneRegle] },
    company_settings: { data: [{ org_id: ORG, company_name: 'Plomberie Tremblay inc.', phone: '+14505550199', email: 'info@plomberie.test', default_language: 'fr', timezone: 'America/Montreal', google_review_url: 'https://g.page/r/plomberie-tremblay/review', facebook_review_url: null, review_enabled: true, automations_paused: false }] },
    clients: { data: [CLIENT] },
    jobs: { data: [{ id: IDS.job, org_id: ORG, title: 'Nettoyage de gouttières', client_id: IDS.client, status: 'completed', deposit_status: 'unpaid', currency: 'CAD', created_at: VEILLE, deleted_at: null, property_address: '412 rue des Érables, Longueuil' }] },
    schedule_events: { data: [{ id: IDS.visite, org_id: ORG, job_id: IDS.job, start_at: '2026-09-25T13:00:00Z', end_at: '2026-09-25T14:00:00Z', status: 'scheduled', deleted_at: null, job: { id: IDS.job, title: 'Nettoyage de gouttières', property_address: '412 rue des Érables, Longueuil', client_id: IDS.client, client_name: 'Marie Tremblay', clients: CLIENT } }] },
    quotes: { data: [{ id: IDS.devis, org_id: ORG, quote_number: 'Q-2026-042', total_cents: 162690, currency: 'CAD', valid_until: '2026-09-30', client_id: IDS.client, lead_id: null, job_id: IDS.job, status: 'sent', deleted_at: null, created_at: VEILLE, view_token: 'bbbbbbbb-0000-4000-8000-000000000001' }] },
    invoices: { data: [{ id: IDS.facture, org_id: ORG, invoice_number: 'INV-000042', due_date: '2026-09-01', total_cents: 162690, balance_cents: 162690, client_id: IDS.client, job_id: IDS.job, status: 'sent', created_at: VEILLE, deleted_at: null, view_token: 'bbbbbbbb-0000-4000-8000-000000000002', public_token: null }] },
    deals: { data: [{ id: IDS.deal, org_id: ORG, client_id: IDS.client, pipeline_id: IDS.pipeline, stage_id: IDS.etape, title: 'Gouttières Tremblay', value_cents: 162690, source: 'site_web', owner_id: null, deleted_at: null, stage_entered_at: VEILLE }] },
    pipeline_stages: { data: [{ id: IDS.etape, org_id: ORG, pipeline_id: IDS.pipeline, name: 'Nouveau', slug: 'nouveau', position: 0 }, { id: IDS.etape2, org_id: ORG, pipeline_id: IDS.pipeline, name: 'Soumission', slug: 'soumission', position: 1 }] },
    job_agreements: { data: [] },
    memberships: { data: [{ user_id: IDS.owner, org_id: ORG, role: 'owner', status: 'active' }] },
    sms_opt_outs: { data: [] },
    email_unsubscribes: { data: [] },
    client_tags: { data: [] },
    conversations: { data: [{ id: 'conv-1', org_id: ORG, client_id: IDS.client }] },
    messages: { data: [], count: 0 },
    activity_log: { data: [], count: 0 },
    notifications: { data: [] },
    notes: { data: [] },
    tasks: { data: [] },
    review_requests: { data: [] },
    satisfaction_surveys: { data: [{ id: 'sondage-1' }] },
    email_templates: { data: [] },
    email_deliveries: { data: [] },
    automation_execution_logs: { data: [] },
    automation_scheduled_tasks: { data: [] },
    custom_field_definitions: { data: [{ id: IDS.champ, org_id: ORG, key: 'fin_garantie', label: 'Fin de garantie', field_type: 'date', object_type: 'client', archived_at: null }] },
    custom_field_values: { data: [] },
    org_features: { data: [] },
    ...surcharges,
  } as Record<string, any>;
}

/** L'événement de chaque déclencheur, avec des métadonnées réalistes. */
export function evenementPour(cle: string): Evenement {
  const par: Record<string, Evenement> = {
    'quote.sent': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042', channel: 'email', client_id: IDS.client } },
    'quote.approved': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042', client_id: IDS.client } },
    'quote.declined': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042', client_id: IDS.client, reason: 'trop cher' } },
    'quote.changes_requested': { entityType: 'quote', entityId: IDS.devis, metadata: { quote_number: 'Q-2026-042', client_id: IDS.client, message: 'moins de lignes' } },
    'invoice.sent': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042', client_id: IDS.client } },
    'invoice.paid': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042', amount_cents: 162690, payment_type: 'full', client_id: IDS.client } },
    'invoice.overdue': { entityType: 'invoice', entityId: IDS.facture, metadata: { invoice_number: 'INV-000042', days_overdue: 12, client_id: IDS.client } },
    'appointment.created': { entityType: 'schedule_event', entityId: IDS.visite, metadata: { job_id: IDS.job, client_id: IDS.client, start_time: '2026-09-25T13:00:00Z' } },
    'appointment.cancelled': { entityType: 'schedule_event', entityId: IDS.visite, metadata: { job_id: IDS.job, client_id: IDS.client } },
    'job.completed': { entityType: 'job', entityId: IDS.job, metadata: { job_name: 'Nettoyage de gouttières', client_id: IDS.client } },
    'job.ready_for_invoicing': { entityType: 'job', entityId: IDS.job, metadata: { job_name: 'Nettoyage de gouttières', client_id: IDS.client } },
    'lead.created': { entityType: 'lead', entityId: IDS.client, metadata: { name: 'Marie Tremblay', email: CLIENT.email, phone: CLIENT.phone, source: 'site_web' } },
    'lead.status_changed': { entityType: 'lead', entityId: IDS.client, metadata: { old_status: 'new', new_status: 'contacted' } },
    'client.replied': { entityType: 'client', entityId: IDS.client, metadata: { conversation_id: 'conv-1', body: 'Oui merci' } },
    'client.tagged': { entityType: 'client', entityId: IDS.client, metadata: { tag: 'vip' } },
    'agreement.signed': { entityType: 'job', entityId: IDS.job, metadata: { signer_name: 'Marie Tremblay' } },
    'task.completed': { entityType: 'client', entityId: IDS.client, metadata: { task_id: IDS.tache, title: 'Rappeler' } },
    'note.added': { entityType: 'client', entityId: IDS.client, metadata: { note_id: 'note-1', entity_type: 'client' } },
    'webhook.received': { entityType: 'automation_webhook', entityId: IDS.webhook, metadata: { source: 'facebook', corps: { source: 'facebook', nom: 'Marie' } } },
    'date.reached': { entityType: 'client', entityId: IDS.client, metadata: { champ_id: IDS.champ, date: '2026-09-20', jour: '2026-09-13' } },
    'deal.stage_entered': { entityType: 'deal', entityId: IDS.deal, metadata: { pipeline_id: IDS.pipeline, stage_id: IDS.etape, client_id: IDS.client } },
    'deal.stage_idle': { entityType: 'deal', entityId: IDS.deal, metadata: { pipeline_id: IDS.pipeline, stage_id: IDS.etape, jours: 14, client_id: IDS.client } },
    'custom_field.changed': { entityType: 'client', entityId: IDS.client, metadata: { field_id: IDS.champ, field_key: 'fin_garantie', object_type: 'client', old_value: null, new_value: '2026-09-20' } },
  };
  const e = par[cle];
  if (!e) throw new Error(`aucun événement de test pour ${cle}`);
  return e;
}

/**
 * L'état RÉEL de l'entité juste après chaque déclencheur : un devis accepté
 * est `approved`, une facture payée est `paid`… Sans lui, le filet joue tout
 * sur un devis `sent` et ne voit rien de ce que les conditions d'arrêt font.
 */
export function etatApres(cle: string): Record<string, unknown> {
  const m = monde({ id: 'x', trigger_event: cle });
  const avec = (table: string, champs: Record<string, unknown>) => ({ [table]: { data: [{ ...m[table].data[0], ...champs }] } });
  switch (cle) {
    case 'quote.approved': return avec('quotes', { status: 'approved' });
    case 'quote.declined': return avec('quotes', { status: 'declined' });
    case 'quote.changes_requested': return avec('quotes', { status: 'changes_requested' });
    case 'invoice.paid': return avec('invoices', { status: 'paid', balance_cents: 0 });
    case 'invoice.overdue': return avec('invoices', { status: 'overdue' });
    case 'appointment.cancelled': return avec('schedule_events', { status: 'cancelled' });
    case 'lead.status_changed': return avec('clients', { status: 'lead', lead_status: 'contacted' });
    case 'lead.created': return avec('clients', { status: 'lead', lead_status: 'new' });
    default: return {};
  }
}

/** L'entité « résolue » pendant l'attente — le cas que la PR 2 encadre. */
export function resoluPendantAttente(cle: string): Record<string, unknown> | null {
  const m = monde({ id: 'x', trigger_event: cle });
  const avec = (table: string, champs: Record<string, unknown>) => ({ [table]: { data: [{ ...m[table].data[0], ...champs }] } });
  switch (cle) {
    case 'quote.sent': return avec('quotes', { status: 'approved' });
    case 'invoice.sent':
    case 'invoice.overdue': return avec('invoices', { status: 'paid', balance_cents: 0 });
    case 'appointment.created': return avec('schedule_events', { status: 'cancelled' });
    case 'deal.stage_entered': return avec('deals', { stage_id: IDS.etape2 });
    default: return null;
  }
}

export interface Enregistreurs {
  sms: Array<{ to: string; body: string }>;
  courriels: Array<{ to: string; subject: string; html: string; headers?: unknown }>;
  appels: Array<{ url: string; corps: string }>;
  slack: Array<{ canal: unknown; texte: unknown }>;
}

export function enregistreursVides(): Enregistreurs {
  return { sms: [], courriels: [], appels: [], slack: [] };
}

/** Le client Supabase que `getServiceClient()` rend pendant la passe en cours. */
export const courant: { client: any } = { client: null };

type Sortie = {
  planifie: Array<{ action: string; execute_at: string; step_id?: string | null }>;
  ecritures: Array<{ moment: string; table: string; op: string; filtres?: unknown; valeur?: unknown }>;
  envois: Array<{ moment: string; canal: string; to?: string; subject?: string; texte: string; empreinte?: string }>;
  annulees: string[];
};

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Rend une valeur comparable d'une passe à l'autre (ids aléatoires, durées). */
function stabiliser(v: unknown): unknown {
  if (typeof v === 'string') {
    return v
      .replace(UUID, (u) => (CONNUS.has(u.toLowerCase()) || u.startsWith('bbbbbbbb') ? u : '<uuid>'))
      .replace(/\b[0-9a-f]{32,64}\b/g, '<jeton>');
  }
  if (Array.isArray(v)) return v.map(stabiliser);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'duration_ms') o[k] = '<ms>';
      // La config d'une action (textes des messages) est recopiée dans chaque
      // tâche et chaque journal : une empreinte suffit, le texte réellement
      // envoyé est déjà capturé dans `envois`. Divise l'instantané par ~3.
      else if (k === 'config' && x && typeof x === 'object') o[k] = `#${createHash('sha256').update(JSON.stringify(stabiliser(x))).digest('hex').slice(0, 12)}`;
      else o[k] = stabiliser(x);
    }
    return o;
  }
  return v;
}

const texteDe = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function collecterEcritures(journal: Requete[], moment: string, sortie: Sortie) {
  for (const r of journal) {
    if (r.op === 'select') continue;
    // L'insertion de l'événement lui-même dans activity_log (le bus) : bruit constant.
    sortie.ecritures.push({ moment, table: r.table, op: r.op, ...(r.filtres.length ? { filtres: r.filtres } : {}), ...(r.valeur !== undefined ? { valeur: r.valeur } : {}) });
  }
}

function collecterEnvois(e: Enregistreurs, depuis: { sms: number; courriels: number; appels: number; slack: number }, moment: string, sortie: Sortie) {
  for (const s of e.sms.slice(depuis.sms)) sortie.envois.push({ moment, canal: 'sms', to: s.to, texte: s.body });
  for (const c of e.courriels.slice(depuis.courriels)) {
    sortie.envois.push({ moment, canal: 'courriel', to: c.to, subject: c.subject, texte: texteDe(c.html ?? ''), empreinte: createHash('sha256').update(String(stabiliser(String(c.html ?? ''))) + JSON.stringify(stabiliser(c.headers ?? null))).digest('hex').slice(0, 16) });
  }
  for (const a of e.appels.slice(depuis.appels)) sortie.envois.push({ moment, canal: 'webhook', to: a.url, texte: a.corps });
  for (const s of e.slack.slice(depuis.slack)) sortie.envois.push({ moment, canal: 'slack', texte: JSON.stringify(s) });
}

const reperes = (e: Enregistreurs) => ({ sms: e.sms.length, courriels: e.courriels.length, appels: e.appels.length, slack: e.slack.length });

/** Attend que plus rien ne bouge : le listener du bus n'est pas attendu par `emit`. */
async function auRepos(journal: Requete[], e: Enregistreurs) {
  let stable = 0;
  let avant = -1;
  const limite = performance.now() + 5000;
  // Pas de minuterie : sous Windows, un setTimeout(1) dure ~15 ms et le filet
  // en ferait des milliers. Les promesses laissées en vol par le moteur se
  // résolvent à coups de microtâches et d'`setImmediate`.
  while (stable < 20 && performance.now() < limite) {
    await new Promise((r) => setImmediate(r));
    const n = journal.length + e.sms.length + e.courriels.length + e.appels.length + e.slack.length;
    stable = n === avant ? stable + 1 : 0;
    avant = n;
  }
}

/**
 * Joue une règle et rend sa sortie stabilisée.
 * `surcharges` : tables du monde à remplacer (ex. le devis déjà accepté).
 */
export async function jouer(
  regle: Regle & { id: string },
  evenement: Evenement,
  e: Enregistreurs,
  surcharges: Record<string, unknown> = {},
  /** Tables remplacées seulement au dépilage : l'état a changé pendant l'attente. */
  surchargesFile: Record<string, unknown> = {},
): Promise<Sortie> {
  process.env.TZ = 'America/Toronto';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(HORLOGE));

  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const twilio = { messages: { create: vi.fn(async (p: any) => { e.sms.push({ to: p.to, body: p.body }); return { sid: 'SM_filet' }; }) } };

  const sortie: Sortie = { planifie: [], ecritures: [], envois: [], annulees: [] };
  e.sms.length = 0; e.courriels.length = 0; e.appels.length = 0; e.slack.length = 0;

  const { client, journal } = clientEnregistreur({
    ...monde(regle, surcharges),
    automation_scheduled_tasks: (req) => (req.op === 'insert' ? { data: [{ id: 'tache-planifiee' }] } : { data: [] }),
  });
  courant.client = client;
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' } as any);

  // `emit` n'attend pas ses listeners : on les enveloppe pour récupérer la
  // promesse de `handleEvent` et l'attendre vraiment, au lieu de deviner.
  const enCours: Promise<unknown>[] = [];
  for (const nom of eventBus.eventNames()) {
    for (const l of eventBus.listeners(nom)) {
      eventBus.off(nom, l as any);
      eventBus.on(nom, (d: unknown) => { enCours.push(Promise.resolve((l as any)(d))); });
    }
  }
  await eventBus.emit(regle.trigger_event as any, { orgId: ORG, actorId: IDS.owner, ...evenement });
  while (enCours.length) await enCours.shift();
  await auRepos(journal, e);
  // La 1re écriture est l'activity_log du bus : constante, on l'écarte.
  collecterEcritures(journal.slice(1), 'immediat', sortie);
  collecterEnvois(e, { sms: 0, courriels: 0, appels: 0, slack: 0 }, 'immediat', sortie);

  // File : tâches insérées, dépilées à leur échéance ; une étape de séquence
  // en insère une autre, qu'on dépile à son tour (borne : 25).
  const file: any[] = requetes(journal, 'automation_scheduled_tasks', 'insert').flatMap((r) => (Array.isArray(r.valeur) ? r.valeur : [r.valeur]));
  let n = 0;
  while (file.length && n < 25) {
    const t = file.shift();
    n++;
    sortie.planifie.push({ action: t.action_config?.type, execute_at: t.execute_at, ...(t.step_id ? { step_id: t.step_id } : {}) });
    let echeance: string = t.execute_at;
    for (let tour = 0; tour < 4; tour++) {
      vi.setSystemTime(new Date(echeance));
      const tache = {
        id: `tache-${n}`, org_id: ORG, automation_rule_id: t.automation_rule_id, entity_type: t.entity_type, entity_id: t.entity_id,
        attempts: 0, status: 'pending', execute_at: echeance, execution_key: t.execution_key, action_config: t.action_config,
        step_id: t.step_id ?? null, sequence_context: t.sequence_context ?? null,
        // Mêmes colonnes que la jointure du moteur (processScheduledTasks).
        automation_rules: {
          name: regle.name ?? regle.id, actions: regle.actions ?? [], conditions: regle.conditions ?? {}, steps: regle.steps ?? null, settings: regle.settings ?? null,
          trigger_event: regle.trigger_event, delay_seconds: regle.delay_seconds ?? 0, preset_key: regle.preset_key ?? null,
        },
      };
      const { client: c2, journal: j2 } = clientEnregistreur({
        ...monde(regle, { ...surcharges, ...surchargesFile }),
        automation_scheduled_tasks: (req) => {
          if (req.op === 'select') return { data: req.filtres.some(([, col, val]) => col === 'status' && val === 'pending') ? [tache] : [] };
          if (req.op === 'insert') return { data: [{ id: 'tache-suivante' }] };
          return { data: [{ id: tache.id }] };
        },
      });
      courant.client = c2;
      initAutomationEngine({ supabase: c2, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' } as any);
      const r0 = reperes(e);
      await processScheduledTasks(c2);
      await auRepos(j2, e);
      const majs = requetes(j2, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter(Boolean);
      const report = majs.find((v) => v.execute_at && !v.status);
      const annulation = majs.find((v) => v.status === 'cancelled');
      const moment = `differe:${t.action_config?.type}${t.step_id ? `#${t.step_id}` : ''}`;
      if (annulation) {
        sortie.annulees.push(`${t.action_config?.type}@${t.execute_at}: ${annulation.last_error ?? ''}`);
        collecterEcritures(j2, moment, sortie);
        break;
      }
      if (report && reperes(e).sms === r0.sms && reperes(e).courriels === r0.courriels) { echeance = report.execute_at; continue; }
      collecterEcritures(j2, moment, sortie);
      collecterEnvois(e, r0, moment, sortie);
      for (const r of requetes(j2, 'automation_scheduled_tasks', 'insert')) file.push(...(Array.isArray(r.valeur) ? r.valeur : [r.valeur]));
      break;
    }
  }
  vi.useRealTimers();
  return stabiliser(sortie) as Sortie;
}
