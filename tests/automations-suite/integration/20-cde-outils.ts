/**
 * Outils communs des tests C (négatifs), D (idempotence / concurrence) et
 * E (échecs / reprise) — fichiers `20-cde-*.test.ts`.
 *
 * Tout ce qui est créé ici vit dans le bureau A de test (bac à sable) et est
 * noté pour le ménage : une règle active oubliée réagirait aux tests suivants.
 *
 * Déclencheur par défaut : `note.added` sur un client. Aucun préréglage ne
 * l'écoute (vérifié sur le bureau de test : les préréglages écoutent
 * lead.created, quote.sent, invoice.*, appointment.*, job.completed…), et
 * seule la route des notes l'émet : nos assertions ne voient que NOS règles.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { attendre, envoisSimules, traiterFile } from '../harnais/moteur';

export type Bureau = { admin: SupabaseClient; orgA: string; orgB: string; users: Record<string, string> };

/** Pile de ménage d'un fichier de test. */
export class Menage {
  private taches: Array<() => PromiseLike<unknown>> = [];
  ajouter(f: () => PromiseLike<unknown>) { this.taches.push(f); }
  async vider() {
    for (const f of this.taches.reverse()) {
      try { await f(); } catch (e) { console.error('[menage]', e instanceof Error ? e.message : e); }
    }
    this.taches = [];
  }
}

/** Une adresse fictive propre au test (jamais routable, plafond de fréquence propre). */
export function courrielFictif(m: string): string {
  const id = m.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-14);
  return `cde-${id}@lume-qa.test`;
}

/** Un numéro de la plage fictive 555-0100…0199. */
export function telephoneFictif(): string {
  return `+1514555${String(100 + Math.floor(Math.random() * 100)).padStart(4, '0')}`;
}

export async function creerClient(
  b: Bureau, menage: Menage, m: string,
  champs: Record<string, unknown> = {},
): Promise<string> {
  const maintenant = new Date().toISOString();
  const { data, error } = await b.admin.from('clients').insert({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Cde', last_name: m, status: 'active',
    email: courrielFictif(m), phone: telephoneFictif(),
    sms_consent_at: maintenant, email_consent_at: maintenant,
    ...champs,
  }).select('id').single();
  if (error) throw new Error(`client : ${error.message}`);
  const id = (data as { id: string }).id;
  menage.ajouter(() => b.admin.from('clients').delete().eq('id', id));
  return id;
}

/**
 * Une règle de NOTRE bureau. `fenetre` 0-24 par défaut : les tests ne doivent
 * pas dépendre de l'heure à laquelle ils tournent (la fenêtre d'envoi est
 * éprouvée ailleurs). Insérée directement : la validation de l'éditeur n'est
 * pas le sujet, le moteur l'est.
 */
export async function creerRegle(
  b: Bureau, menage: Menage, m: string,
  champs: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: m, trigger_event: 'note.added', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, actions: [],
    settings: { fenetre: { debut: 0, fin: 24 } },
    ...champs,
  }).select('id').single();
  if (error) throw new Error(`règle : ${error.message}`);
  const id = (data as { id: string }).id;
  menage.ajouter(() => b.admin.from('automation_rules').delete().eq('id', id));
  return id;
}

export async function journaux(b: Bureau, ruleId: string) {
  const { data, error } = await b.admin.from('automation_execution_logs')
    .select('id, action_type, result_success, result_data, result_error, execution_key, scheduled_task_id, entity_id, created_at')
    .eq('org_id', b.orgA).eq('automation_rule_id', ruleId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string; action_type: string; result_success: boolean; result_data: Record<string, unknown> | null;
    result_error: string | null; execution_key: string | null; scheduled_task_id: string | null; entity_id: string; created_at: string;
  }>;
}

export async function taches(b: Bureau, ruleId: string) {
  const { data, error } = await b.admin.from('automation_scheduled_tasks')
    .select('id, status, attempts, last_error, execute_at, step_id, execution_key, action_config, created_at, completed_at')
    .eq('org_id', b.orgA).eq('automation_rule_id', ruleId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string; status: string; attempts: number; last_error: string | null; execute_at: string; step_id: string | null;
    execution_key: string; action_config: Record<string, any>; created_at: string; completed_at: string | null;
  }>;
}

/** Rend dues maintenant les tâches en attente de CETTE règle. */
export async function rendreDues(b: Bureau, ruleId: string): Promise<void> {
  const { error } = await b.admin.from('automation_scheduled_tasks')
    .update({ execute_at: new Date(Date.now() - 1000).toISOString() })
    .eq('org_id', b.orgA).eq('automation_rule_id', ruleId).eq('status', 'pending');
  if (error) throw new Error(error.message);
}

/** Rend dues les tâches de la règle puis fait avancer la file du bureau A. */
export async function avancer(b: Bureau, ruleId: string): Promise<void> {
  await rendreDues(b, ruleId);
  await traiterFile(b.admin, b.orgA);
}

/** Les envois simulés depuis `depuis` qui portent la marque `m`. */
export async function envoisMarques(b: Bureau, depuis: string, m: string) {
  // La marque est unique : on élargit la fenêtre de 10 min pour ne pas
  // dépendre de l'écart d'horloge entre ce poste et la base (test instable
  // constaté sur D-003 : horodatage de la base < `depuis` local).
  const large = new Date(Date.parse(depuis) - 10 * 60_000).toISOString();
  return (await envoisSimules(b.admin, b.orgA, large)).filter((r) =>
    String(r.corps ?? '').includes(m) || String(r.sujet ?? '').includes(m));
}

/** Émet `note.added` sur un client et attend que la règle ait laissé `n` journaux. */
export async function emettreNote(b: Bureau & { eventBus: { emit: (t: any, d: any) => Promise<boolean> } }, clientId: string, metadata: Record<string, unknown> = {}) {
  return b.eventBus.emit('note.added', { orgId: b.orgA, entityType: 'client', entityId: clientId, metadata });
}

export async function attendreJournaux(b: Bureau, ruleId: string, n: number, delaiMs = 15_000) {
  return attendre(() => journaux(b, ruleId), (j) => j.length >= n && j.every((l) => l.result_error !== 'en cours'), delaiMs);
}

/**
 * Attend que TOUS les écouteurs aient fini de traiter les événements
 * `type` de l'entité émis depuis `depuis` : l'outbox (`domain_events`) n'est
 * cochée qu'à la fin du dernier écouteur. C'est le signal sûr pour conclure
 * « rien ne s'est passé » sans deviner une durée.
 */
export async function attendreTraitement(b: Bureau, entityId: string, type: string, depuis: string, n = 1) {
  const lignes = await attendre(async () => {
    const { data, error } = await b.admin.from('domain_events').select('id, processed_at, last_error, regles_traitees, metadata, created_at')
      .eq('org_id', b.orgA).eq('entity_id', entityId).eq('type', type).gte('created_at', depuis);
    if (error) throw new Error(error.message);
    return data ?? [];
  }, (l) => l.length >= n && l.every((x) => x.processed_at), 20_000);
  if (lignes.length < n || !lignes.every((x) => x.processed_at)) {
    throw new Error(`événement ${type} non traité à temps : ${JSON.stringify(lignes)}`);
  }
  return lignes as Array<{ id: number; processed_at: string; last_error: string | null; regles_traitees: string[] | null; metadata: Record<string, unknown>; created_at: string }>;
}

/** Laisse le temps aux écouteurs non attendus de finir (émission tire-et-oublie). */
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Les notes (effet de l'action `ajouter_note`) qui portent la marque. */
export async function notesMarquees(b: Bureau, m: string) {
  const { data, error } = await b.admin.from('notes').select('id, content, entity_id, created_at')
    .eq('org_id', b.orgA).like('content', `%${m}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Met le fournisseur simulé du bureau A dans un mode (succes / panne / delai). */
export async function modeBac(b: Bureau, mode: 'succes' | 'panne' | 'delai'): Promise<void> {
  const { error } = await b.admin.from('orgs_envois_simules').update({ mode }).eq('org_id', b.orgA);
  if (error) throw new Error(error.message);
  const { oublierBacASable } = await import('../../../server/lib/bac-a-sable');
  oublierBacASable();
}
