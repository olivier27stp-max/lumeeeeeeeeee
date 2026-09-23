/**
 * Pipeline de ventes — accès aux données.
 *
 * Les statistiques passent par les fonctions Postgres `pipeline_*`, qui sont
 * en SECURITY INVOKER : elles ne voient que ce que l'utilisateur connecté peut
 * voir, et `org_id` n'est jamais un paramètre — il vient de la session. Rien à
 * filtrer ici, donc rien à oublier de filtrer.
 *
 * Le reste (board, fiche, réglages) passe par PostgREST, sous la même RLS.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ── Types ───────────────────────────────────────────────────

export type StageKind = 'open' | 'won' | 'lost';
export type ActorType = 'user' | 'automation' | 'lumi' | 'system';

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name_fr: string;
  name_en: string;
  guidance_fr: string;
  guidance_en: string;
  position: number;
  kind: StageKind;
  archived_at: string | null;
}

export interface Deal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  client_id: string;
  assigned_user_id: string | null;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbclid: string | null;
  job_id: string | null;
  quote_id: string | null;
  first_contacted_at: string | null;
  last_activity_at: string;
  stage_entered_at: string;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  lost_from_stage_id: string | null;
  created_at: string;
  /** Jointure client — le « contact » est une ligne de `clients`. */
  client?: {
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  } | null;
}

export interface DealStageHistory {
  id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  created_at: string;
}

export interface PipelineKpis {
  leads_entrants: number;
  leads_precedents: number;
  gagnes: number;
  perdus: number;
  ouverts: number;
  taux_closing: number;
  revenus_cents: number;
  jobs_liees: number;
  job_a_creer: number;
}

export interface SourceRow {
  source: string;
  campagne: string | null;
  leads: number;
  gagnes: number;
  perdus: number;
  taux_closing: number;
  revenus_cents: number;
  revenu_moyen_par_lead: number;
}

export interface FunnelRow {
  stage_id: string;
  nom_fr: string;
  nom_en: string;
  rang: number;
  atteints: number;
  taux_passage: number;
}

export interface VitesseRow {
  delai_contact_moyen_h: number;
  jamais_contactes: number;
  /** `null` = aucun deal fermé dans la tranche — pas « 0 % ». */
  closing_moins_1h: number | null;
  closing_moins_24h: number | null;
  closing_plus_24h: number | null;
  n_moins_1h: number;
  n_moins_24h: number;
  n_plus_24h: number;
  cycle_moyen_jours: number;
}

export interface ATraiterRow {
  deal_id: string;
  client_nom: string;
  raison: 'job_a_creer' | 'non_assigne' | 'sans_activite';
  stage_nom_fr: string;
  depuis_jours: number;
}

export interface TendanceRow {
  semaine: string;
  leads: number;
  gagnes: number;
}

export interface CohorteRow {
  mois: string;
  inscrits: number;
  gagnes: number;
  encore_ouvert: number;
  /** Dénominateur = TOUS les leads du mois, ouverts compris. */
  taux_gagne: number;
}

// ── Lecture ─────────────────────────────────────────────────

export async function fetchPipelineDefaut(): Promise<{ id: string; name: string } | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('pipelines_ventes')
    .select('id,name')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchStages(pipelineId: string): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('id,pipeline_id,name_fr,name_en,guidance_fr,guidance_en,position,kind,archived_at')
    .eq('pipeline_id', pipelineId)
    .order('position');
  if (error) throw error;
  return (data ?? []) as PipelineStage[];
}

export async function fetchDeals(pipelineId: string): Promise<Deal[]> {
  const { data, error } = await supabase
    .from('deals')
    .select(
      'id,pipeline_id,stage_id,client_id,assigned_user_id,source,' +
      'utm_source,utm_medium,utm_campaign,utm_content,fbclid,job_id,quote_id,' +
      'first_contacted_at,last_activity_at,stage_entered_at,won_at,lost_at,' +
      'lost_reason,lost_from_stage_id,created_at,' +
      'client:clients!deals_client_same_org(first_name,last_name,company,email,phone,address)',
    )
    .eq('pipeline_id', pipelineId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Deal[];
}

export async function fetchHistorique(dealId: string): Promise<DealStageHistory[]> {
  const { data, error } = await supabase
    .from('deal_stage_history')
    .select('id,deal_id,from_stage_id,to_stage_id,actor_type,actor_id,created_at')
    .eq('deal_id', dealId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as DealStageHistory[];
}

// ── Écriture ────────────────────────────────────────────────
//
// Les horodatages, l'historique et les événements sont posés par les triggers :
// on n'écrit QUE l'étape. Écrire `won_at` ici produirait une valeur concurrente
// de celle de la base.

export async function deplacerDeal(dealId: string, versEtapeId: string): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .update({ stage_id: versEtapeId })
    .eq('id', dealId);
  if (error) throw error;
}

export async function marquerPerdu(dealId: string, versEtapeId: string, raison: string): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .update({ stage_id: versEtapeId, lost_reason: raison })
    .eq('id', dealId);
  if (error) throw error;
}

export async function assignerDeal(dealId: string, membreId: string | null): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .update({
      assigned_user_id: membreId,
      assigned_at: membreId ? new Date().toISOString() : null,
    })
    .eq('id', dealId);
  if (error) throw error;
}

export async function lierJob(dealId: string, jobId: string): Promise<void> {
  const { error } = await supabase.from('deals').update({ job_id: jobId }).eq('id', dealId);
  if (error) throw error;
}

// ── Réglages des étapes ─────────────────────────────────────

export async function renommerEtape(
  stageId: string,
  champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en'>>,
): Promise<void> {
  const { error } = await supabase.from('pipeline_stages').update(champs).eq('id', stageId);
  if (error) throw error;
}

/**
 * Réordonne en écrivant toutes les positions d'un coup.
 *
 * La contrainte d'unicité est DEFERRABLE : les positions intermédiaires en
 * doublon sont tolérées jusqu'à la fin de la transaction. Sans ça, permuter
 * deux étapes échouerait au milieu.
 */
export async function reordonnerEtapes(ordre: { id: string; position: number }[]): Promise<void> {
  const { error } = await supabase.rpc('pipeline_reordonner_etapes', {
    p_ordre: ordre.map((o) => ({ id: o.id, position: o.position })),
  });
  if (error) throw error;
}

/** Archive une étape. La base refuse si des deals y sont, ou si c'était la dernière de son type. */
export async function archiverEtape(stageId: string): Promise<void> {
  const { error } = await supabase
    .from('pipeline_stages')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', stageId);
  if (error) throw error;
}

export async function ajouterEtape(
  pipelineId: string,
  champs: { name_fr: string; name_en: string; position: number },
): Promise<PipelineStage> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('pipeline_stages')
    .insert({ org_id: orgId, pipeline_id: pipelineId, kind: 'open', ...champs })
    .select('id,pipeline_id,name_fr,name_en,guidance_fr,guidance_en,position,kind,archived_at')
    .single();
  if (error) throw error;
  return data as PipelineStage;
}

// ── Statistiques ────────────────────────────────────────────
//
// `p_from` / `p_to` sont des dates ISO (YYYY-MM-DD) ou `null` pour les
// 12 dernières semaines.

export async function fetchKpis(from?: string, to?: string): Promise<PipelineKpis | null> {
  const { data, error } = await supabase.rpc('pipeline_kpis', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data?.[0] as PipelineKpis) ?? null;
}

export async function fetchParSource(from?: string, to?: string): Promise<SourceRow[]> {
  const { data, error } = await supabase.rpc('pipeline_par_source', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data ?? []) as SourceRow[];
}

export async function fetchEntonnoir(from?: string, to?: string): Promise<FunnelRow[]> {
  const { data, error } = await supabase.rpc('pipeline_entonnoir', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data ?? []) as FunnelRow[];
}

export async function fetchVitesse(from?: string, to?: string): Promise<VitesseRow | null> {
  const { data, error } = await supabase.rpc('pipeline_vitesse', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data?.[0] as VitesseRow) ?? null;
}

export async function fetchATraiter(jours = 7): Promise<ATraiterRow[]> {
  const { data, error } = await supabase.rpc('pipeline_a_traiter', { p_jours: jours });
  if (error) throw error;
  return (data ?? []) as ATraiterRow[];
}

export async function fetchTendance(semaines = 12): Promise<TendanceRow[]> {
  const { data, error } = await supabase.rpc('pipeline_tendance', { p_semaines: semaines });
  if (error) throw error;
  return (data ?? []) as TendanceRow[];
}

export async function fetchCohortes(mois = 6): Promise<CohorteRow[]> {
  const { data, error } = await supabase.rpc('pipeline_cohortes', { p_mois: mois });
  if (error) throw error;
  return (data ?? []) as CohorteRow[];
}

// ── Dérivés (jamais stockés) ────────────────────────────────

/** Badge « Job à créer » : étape gagnée + aucune job liée. */
export function estJobACreer(deal: Deal, stages: PipelineStage[]): boolean {
  const s = stages.find((x) => x.id === deal.stage_id);
  return !!s && s.kind === 'won' && !deal.job_id;
}

/** Nom affichable du contact, depuis la ligne `clients` jointe. */
export function nomClient(deal: Deal): string {
  const c = deal.client;
  if (!c) return '—';
  const nom = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return nom || c.company || '—';
}

/**
 * Priorité calculée sur l'inactivité — jamais saisie (décision Q9).
 * Un champ manuel se périme en silence et fausse les statistiques.
 */
export function priorite(deal: Deal, stages: PipelineStage[], maintenant = new Date()):
  { niveau: 'urgent' | 'moyen' | 'frais'; jours: number } | null {
  const s = stages.find((x) => x.id === deal.stage_id);
  if (!s || s.kind !== 'open') return null;
  const jours = Math.floor((maintenant.getTime() - new Date(deal.last_activity_at).getTime()) / 86_400_000);
  if (jours >= 14) return { niveau: 'urgent', jours };
  if (jours >= 5) return { niveau: 'moyen', jours };
  return { niveau: 'frais', jours };
}
