/**
 * Outils des tests de l'agent B (moteur, déclencheurs, exécution).
 *
 * Tout tourne dans le bureau A de test « (b) », en bac à sable, sur la pile
 * locale. Le moteur est le vrai (harnais de la suite) ; les événements sont
 * émis sur le vrai bus ; la file est avancée pour NOTRE bureau seulement.
 *
 * Les règles sont insérées directement (comme tests/automations-suite/
 * integration/20-cde-outils.ts) : le sujet est le moteur, pas la validation
 * de l'éditeur. SANS réglage de fenêtre par défaut : c'est le comportement
 * d'une automatisation neuve qu'on mesure.
 */
import { afterAll } from 'vitest';
import { attendre, traiterFile } from '../../automations-suite/harnais/moteur';
import { ok, type Bureau } from '../../automations-suite/integration/10-b-outils';

export type { Bureau };

const reglesCreees: string[] = [];
let bureauDuMenage: Bureau | null = null;

afterAll(async () => {
  if (!bureauDuMenage || !reglesCreees.length) return;
  // Les tâches partent avec la règle (clé étrangère en cascade).
  await bureauDuMenage.admin.from('automation_rules').delete().in('id', reglesCreees.splice(0));
});

/** Une règle PUBLIÉE du bureau A, insérée telle quelle. */
export async function regle(b: Bureau, nom: string, champs: Record<string, unknown>): Promise<string> {
  bureauDuMenage = b;
  const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: nom, trigger_event: 'note.added', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, actions: [], ...champs,
  }).select('id').single(), 'règle');
  reglesCreees.push(r.id);
  return r.id;
}

export const courriel = (m: string, texte = 'Courriel') =>
  ({ type: 'send_email', config: { subject: `Sujet ${m}`, body: `<p>${texte} ${m}</p>` } });
export const texto = (m: string, texte = 'Texto') =>
  ({ type: 'send_sms', config: { body: `${texte} ${m}` } });

export interface Tache {
  id: string; status: string; step_id: string | null; execute_at: string; attempts: number; last_error: string | null;
  action_config: Record<string, any>; entity_type: string; entity_id: string; created_at: string; completed_at: string | null;
}

export async function tachesDe(b: Bureau, ruleId: string): Promise<Tache[]> {
  return ok<Tache[]>(b.admin.from('automation_scheduled_tasks')
    .select('id, status, step_id, execute_at, attempts, last_error, action_config, entity_type, entity_id, created_at, completed_at')
    .eq('automation_rule_id', ruleId).order('created_at'), 'tâches');
}

export interface Journal {
  id: string; trigger_event: string; entity_type: string; entity_id: string; action_type: string;
  result_success: boolean; result_data: Record<string, any> | null; result_error: string | null; scheduled_task_id: string | null; created_at: string;
}

export async function journauxDe(b: Bureau, ruleId: string): Promise<Journal[]> {
  return ok<Journal[]>(b.admin.from('automation_execution_logs')
    .select('id, trigger_event, entity_type, entity_id, action_type, result_success, result_data, result_error, scheduled_task_id, created_at')
    .eq('automation_rule_id', ruleId).order('created_at'), 'journaux');
}

/** Émet sur le vrai bus et attend que le moteur ait fini (outbox cochée). */
export async function emettre(
  b: Bureau, type: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {},
): Promise<void> {
  const depuis = new Date(Date.now() - 5_000).toISOString();
  await b.eventBus.emit(type as never, { orgId: b.orgA, entityType, entityId, metadata } as never);
  if (type.startsWith('deal.')) {
    // Pas d'outbox pour deal.* : on laisse les écouteurs finir.
    await new Promise((r) => setTimeout(r, 1_500));
    return;
  }
  const lignes = await attendre(async () => ok<Array<{ processed_at: string | null }>>(
    b.admin.from('domain_events').select('processed_at').eq('org_id', b.orgA).eq('entity_id', entityId).eq('type', type).gte('created_at', depuis), 'outbox'),
  (l) => l.length > 0 && l.every((x) => x.processed_at), 30_000);
  if (!lignes.length || !lignes.every((x) => x.processed_at)) throw new Error(`événement ${type} non traité à temps`);
}

/** Attend que la règle ait au moins `n` tâches en file. */
export async function attendreTaches(b: Bureau, ruleId: string, n = 1): Promise<Tache[]> {
  const t = await attendre(() => tachesDe(b, ruleId), (l) => l.length >= n, 20_000);
  if (t.length < n) throw new Error(`la règle n'a planifié que ${t.length} tâche(s), ${n} attendue(s)`);
  return t;
}

/** Le délai est écoulé : les tâches en attente de la règle sont dues, la file avance. */
export async function avancer(b: Bureau, ruleId: string): Promise<void> {
  await ok(b.admin.from('automation_scheduled_tasks')
    .update({ execute_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('automation_rule_id', ruleId).eq('status', 'pending'), 'rendre dues');
  await traiterFile(b.admin, b.orgA);
}

/**
 * Les envois simulés qui portent la marque, filtrés PAR LA BASE.
 *
 * Pas `envoisSimules()` du harnais : il lit toute la fenêtre puis filtre en mémoire, et PostgREST
 * plafonne une réponse à 1 000 lignes (PGRST_DB_MAX_ROWS). Après la mesure de charge (600 envois),
 * la fenêtre dépassait 1 000 lignes : les envois les plus récents étaient coupés et « aucun envoi »
 * devenait vrai à tort (constaté le 2026-10-01 sur B11-01).
 */
export async function envoisAvec(b: Bureau, m: string, orgId: string = b.orgA) {
  type Envoi = { id: string; canal: string; destinataire: string; sujet: string | null; corps: string | null; created_at: string };
  const colonnes = 'id, canal, destinataire, sujet, corps, created_at';
  const [parCorps, parSujet] = await Promise.all([
    ok<Envoi[]>(b.admin.from('envois_simules').select(colonnes).eq('org_id', orgId).like('corps', `%${m}%`).order('created_at').limit(1000), 'envois (corps)'),
    ok<Envoi[]>(b.admin.from('envois_simules').select(colonnes).eq('org_id', orgId).like('sujet', `%${m}%`).order('created_at').limit(1000), 'envois (sujet)'),
  ]);
  const vus = new Map<string, Envoi>();
  for (const e of [...parCorps, ...parSujet]) vus.set(e.id, e);
  return [...vus.values()].sort((x, y) => x.created_at.localeCompare(y.created_at));
}

/** Le jour (AAAA-MM-JJ) dans un fuseau, décalé de `jours`. */
export function jourLocal(fuseau: string, jours = 0, maintenant = new Date()): string {
  const j = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
  const d = new Date(`${j}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** L'heure (0-23) qu'il est dans un fuseau. */
export function heureLocale(fuseau: string, maintenant = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hour12: false }).format(maintenant)) % 24;
}

/** Un fuseau où il est, en ce moment, en PLEINE NUIT (entre 1 h et 5 h). */
export function fuseauEnPleineNuit(maintenant = new Date()): string {
  for (let d = -12; d <= 14; d++) {
    const tz = d === 0 ? 'Etc/GMT' : `Etc/GMT${d > 0 ? '-' : '+'}${Math.abs(d)}`; // signe IANA inversé
    const h = heureLocale(tz, maintenant);
    if (h >= 1 && h <= 5) return tz;
  }
  throw new Error('aucun fuseau en pleine nuit');
}

export async function poserFuseau(b: Bureau, fuseau: string): Promise<void> {
  await ok(b.admin.from('company_settings').update({ timezone: fuseau }).eq('org_id', b.orgA), 'fuseau');
  const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
  viderCacheFuseau();
}

/** Une facture ENVOYÉE, échue depuis `joursDeRetard` jours (fuseau du bureau). */
export async function factureEnRetard(
  b: Bureau, m: string, clientId: string, joursDeRetard: number, fuseau: string, montantCents = 10_000,
): Promise<{ id: string; invoice_number: string; total_cents: number }> {
  const f = await ok<{ id: string }>(b.admin.from('invoices').insert({
    org_id: b.orgA, client_id: clientId, status: 'draft', created_by: b.users.proprioA, subject: `Facture ${m}`,
  }).select('id').single(), 'facture');
  await ok(b.admin.from('invoice_items').insert({ org_id: b.orgA, invoice_id: f.id, description: `Service ${m}`, qty: 1, unit_price_cents: montantCents }), 'ligne');
  await ok(b.admin.rpc('recalculate_invoice_totals', { p_invoice_id: f.id }), 'recalcul');
  const maintenant = new Date().toISOString();
  await ok(b.admin.from('invoices').update({
    status: 'sent', issued_at: maintenant, sent_at: maintenant, due_date: jourLocal(fuseau, -joursDeRetard),
  }).eq('id', f.id), 'envoi');
  return ok(b.admin.from('invoices').select('id, invoice_number, total_cents').eq('id', f.id).single(), 'relecture');
}

/** Le client paie la facture en entier (le trigger de la base la passe à « payée »). */
export async function payer(b: Bureau, factureId: string, clientId: string, montantCents: number): Promise<void> {
  await ok(b.admin.from('payments').insert({
    org_id: b.orgA, invoice_id: factureId, client_id: clientId, provider: 'manual', status: 'succeeded', amount_cents: montantCents,
    currency: 'CAD', payment_date: new Date().toISOString(), created_by: b.users.proprioA,
  }), 'paiement');
  const f = await ok<{ status: string }>(b.admin.from('invoices').select('status').eq('id', factureId).single(), 'facture payée');
  if (f.status !== 'paid') throw new Error(`la facture devrait être payée, elle est « ${f.status} »`);
}

/** Le motif générique du moteur, drapeau de sortie éteint : il ne dit pas POURQUOI. */
export const MOTIF_GENERIQUE = 'Annulée : la condition d’arrêt de la règle est remplie.';
