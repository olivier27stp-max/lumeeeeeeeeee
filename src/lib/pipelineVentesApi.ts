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
  /** Porte-à-porte : la porte d'où vient ce deal, et le rep qui l'a ouverte. */
  pin_id: string | null;
  field_rep_id: string | null;
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

/** Une raison de perte, avec l'étape d'où le deal a été perdu. */
export interface RaisonPerteRow {
  raison: string;
  etape_perdue: string;
  etape_perdue_en: string;
  perdus: number;
  /** Part du total des pertes, déjà en pourcentage (0–100). */
  part: number;
}

/** Une ligne par membre ; `membre_id` à `null` = les deals non assignés. */
export interface VendeurRow {
  membre_id: string | null;
  nom: string;
  deals_pris: number;
  gagnes: number;
  perdus: number;
  abandonnes: number;
  ouverts: number;
  /** Fermés seulement, abandonnés exclus. Déjà en pourcentage (0–100). */
  taux_closing: number;
  /** Moyenne en heures ; `null` si aucun deal n'a été contacté. */
  delai_premier_contact_h: number | null;
  revenus_cents: number;
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

export interface MontantDeal {
  deal_id: string;
  cents: number;
  /** D'où vient le chiffre : job liée, devis lié, dernier devis du client, ou rien. */
  provenance: 'job' | 'devis' | 'devis_client' | 'aucun';
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

export interface PipelineResume {
  id: string;
  name: string;
  is_default: boolean;
}

/** Tous les pipelines de l'organisation — le défaut en premier, puis par nom. */
export async function fetchPipelines(): Promise<PipelineResume[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('pipelines_ventes')
    .select('id,name,is_default')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('name');
  if (error) throw error;
  return (data ?? []) as PipelineResume[];
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
      'lost_reason,lost_from_stage_id,pin_id,field_rep_id,created_at,' +
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

// ── Éléments liés à un deal (onglet « Lié » de la fiche) ────

export interface JobLiee {
  id: string;
  job_number: string;
  title: string;
  status: string;
  total_cents: number;
}

export interface DevisLie {
  id: string;
  quote_number: string;
  title: string;
  status: string;
  total_cents: number;
}

export interface PaiementLie {
  id: string;
  amount_cents: number;
  paid_at: string;
  method: string | null;
  status: string;
}

/** La porte du D2D d'où vient le deal, pour revenir à sa position sur la carte. */
export interface PorteLiee {
  house_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
}

export interface ElementsLies {
  job: JobLiee | null;
  devis: DevisLie | null;
  paiements: PaiementLie[];
  porte: PorteLiee | null;
}

/**
 * Job, devis et paiements rattachés à un deal.
 *
 * Les paiements sont lus par `payments.job_id` — le lien DIRECT de la table,
 * pas une reconstitution par les factures. Sans job liée on ne renvoie aucun
 * paiement : additionner ceux du client entier donnerait un chiffre faux.
 */
export async function fetchElementsLies(deal: Deal): Promise<ElementsLies> {
  const [job, devis, paiements, porte] = await Promise.all([
    chargerJob(deal.job_id),
    chargerDevis(deal.quote_id),
    chargerPaiements(deal.job_id),
    chargerPorte(deal.pin_id),
  ]);
  return { job, devis, paiements, porte };
}

/**
 * La porte du porte-à-porte. Les coordonnées vivent sur
 * `field_house_profiles` — `field_pins` ne porte ni lat ni lng — d'où la
 * jointure par `house_id`.
 */
async function chargerPorte(pinId: string | null): Promise<PorteLiee | null> {
  if (!pinId) return null;
  const { data, error } = await supabase
    .from('field_pins')
    .select('status,house_id,maison:field_house_profiles!field_pins_house_id_fkey(address,lat,lng)')
    .eq('id', pinId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const brut = data as unknown as {
    status: string; house_id: string;
    maison: { address: string | null; lat: number | null; lng: number | null } | null;
  };
  return {
    house_id: brut.house_id,
    address: brut.maison?.address ?? null,
    lat: brut.maison?.lat ?? null,
    lng: brut.maison?.lng ?? null,
    status: brut.status,
  };
}

async function chargerJob(jobId: string | null): Promise<JobLiee | null> {
  if (!jobId) return null;
  const { data, error } = await supabase
    .from('jobs')
    .select('id,job_number,title,status,total_cents')
    .eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as JobLiee | null) ?? null;
}

async function chargerDevis(quoteId: string | null): Promise<DevisLie | null> {
  if (!quoteId) return null;
  const { data, error } = await supabase
    .from('quotes')
    .select('id,quote_number,title,status,total_cents')
    .eq('id', quoteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as DevisLie | null) ?? null;
}

async function chargerPaiements(jobId: string | null): Promise<PaiementLie[]> {
  if (!jobId) return [];
  const { data, error } = await supabase
    .from('payments')
    .select('id,amount_cents,paid_at,method,status')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PaiementLie[];
}

// ── Tâches rattachées à un deal ─────────────────────────────
//
// `tasks.linked_entity_type` accepte 'deal' depuis la migration
// 20260923180000. Le type `TaskLinkedEntityType` de src/types/task.ts ne le
// liste pas encore : les deux fonctions ci-dessous tapent donc leur propre
// forme, restreinte aux colonnes réellement lues.

export interface TacheDeal {
  id: string;
  title: string;
  status: 'open' | 'done';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  created_at: string;
}

const COLONNES_TACHE = 'id,title,status,priority,due_date,created_at';

export async function fetchTachesDuDeal(dealId: string): Promise<TacheDeal[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('tasks')
    .select(COLONNES_TACHE)
    .eq('org_id', orgId)
    .eq('linked_entity_type', 'deal')
    .eq('linked_entity_id', dealId)
    .is('deleted_at', null)
    .order('status')
    .order('due_date', { nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as TacheDeal[];
}

/** Crée une tâche rattachée au deal. `created_by` est NOT NULL sans défaut. */
export async function creerTacheDeal(
  dealId: string,
  champs: { title: string; due_date: string | null },
): Promise<TacheDeal> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      created_by: user.id,
      title: champs.title,
      due_date: champs.due_date,
      status: 'open',
      priority: 'medium',
      type: 'Sales',
      linked_entity_type: 'deal',
      linked_entity_id: dealId,
    })
    .select(COLONNES_TACHE)
    .single();
  if (error) throw error;
  return data as TacheDeal;
}

/** Coche / décoche une tâche. `completed_at` suit le statut, comme tasksApi. */
export async function basculerTacheDeal(tacheId: string, fait: boolean): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: fait ? 'done' : 'open',
      completed_at: fait ? new Date().toISOString() : null,
    })
    .eq('id', tacheId);
  if (error) throw error;
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

/**
 * Abandonner un deal : le client ne répond plus, on arrête de relancer.
 *
 * Différent de « perdu », où le client a dit non. Confondus, le taux de
 * closing compte comme défaite commerciale un deal qui n'a jamais été
 * arbitré — et « pourquoi on perd » devient illisible.
 *
 * Le vendeur n'a pas à choisir une étape : la fonction place le deal dans
 * l'étape perdue du pipeline elle-même.
 */
export async function abandonnerDeal(dealId: string, raison: string): Promise<void> {
  const { error } = await supabase.rpc('pipeline_abandonner_deal', {
    p_deal_id: dealId,
    p_raison: raison.trim() || null,
  });
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

/** Canal d'acquisition du deal. `deals.source` est du texte libre : on écrit ce qu'on reçoit. */
export async function majSourceDuDeal(dealId: string, source: string): Promise<void> {
  const { error } = await supabase.from('deals').update({ source }).eq('id', dealId);
  if (error) throw error;
}

/** Raison de perte seule — sans changer d'étape (le deal est déjà dans une étape `lost`). */
export async function majRaisonPerte(dealId: string, raison: string): Promise<void> {
  const { error } = await supabase.from('deals').update({ lost_reason: raison }).eq('id', dealId);
  if (error) throw error;
}

/** Champs de contact modifiables depuis la fiche d'un deal — ils vivent dans `clients`. */
export interface ContactClient {
  email: string | null;
  phone: string | null;
  address: string | null;
}

/**
 * Écrit le contact du CLIENT rattaché au deal.
 *
 * Le courriel, le téléphone et l'adresse n'appartiennent pas au deal : ils sont
 * sur `clients`. Les modifier depuis la fiche du deal change donc la fiche
 * client — la fiche le dit explicitement, sans quoi l'utilisateur croirait
 * n'avoir touché qu'un deal.
 *
 * `org_id` est filtré en plus de la RLS : un id de client d'une autre org ne
 * doit pas pouvoir être adressé, même par accident.
 */
export async function majContactDuDeal(
  clientId: string,
  champs: Partial<ContactClient>,
): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('clients')
    .update(champs)
    .eq('id', clientId)
    .eq('org_id', orgId);
  if (error) throw error;
}

/**
 * Crée un deal à la main, depuis le board.
 *
 * Passe par `ingest_lead` — la porte d'entrée unique déjà utilisée par le
 * formulaire public. Un deal créé ici suit donc exactement le même chemin
 * qu'un lead entrant : rapprochement sur le téléphone ou le courriel,
 * première étape ouverte, non assigné. Écrire directement dans `deals`
 * contournerait tout ça et créerait un doublon pour un client existant.
 */
export async function creerDealManuel(champs: {
  prenom: string;
  nom?: string | null;
  courriel?: string | null;
  telephone?: string | null;
  adresse?: string | null;
}): Promise<{ dealId: string; fusionne: boolean; dealExistant: boolean }> {
  // `pipeline_creer_deal` ne prend PAS d'organisation : elle la dérive de la
  // session et vérifie la permission « leads.create ». `ingest_lead` reste
  // réservée au serveur — elle accepte un org_id en paramètre, ce qui n'a rien
  // à faire dans un navigateur.
  const { data, error } = await supabase.rpc('pipeline_creer_deal', {
    p_first_name: champs.prenom,
    p_last_name: champs.nom ?? null,
    p_email: champs.courriel ?? null,
    p_phone: champs.telephone ?? null,
    p_address: champs.adresse ?? null,
  });
  if (error) throw error;
  const r = data as { deal_id: string; fusionne: boolean; deal_existant: boolean };
  return { dealId: r.deal_id, fusionne: r.fusionne, dealExistant: r.deal_existant };
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

// ── Réglages du pipeline lui-même ───────────────────────────

export type ModelePipeline = 'generique' | 'nettoyage' | 'construction';

/**
 * Crée un pipeline SUPPLÉMENTAIRE avec ses étapes.
 *
 * `seed_pipeline_ventes` ne convient pas ici : elle est idempotente (elle ne
 * fait rien si un pipeline par défaut existe) et elle pose `is_default`. Le
 * RPC `creer_pipeline_ventes` (migration 20260923190000) fait l'inverse :
 * jamais de court-circuit, jamais de défaut volé. `org_id` n'est pas un
 * paramètre — il vient de la session.
 */
export async function creerPipeline(nom: string, modele: ModelePipeline): Promise<string> {
  const { data, error } = await supabase.rpc('creer_pipeline_ventes', {
    p_nom: nom,
    p_modele: modele,
  });
  if (error) throw error;
  return data as string;
}

export async function renommerPipeline(pipelineId: string, nom: string): Promise<void> {
  const { error } = await supabase
    .from('pipelines_ventes')
    .update({ name: nom })
    .eq('id', pipelineId);
  if (error) throw error;
}

/**
 * Change le pipeline par défaut. Passe par un RPC : l'index partiel
 * `uq_pipelines_ventes_defaut` refuserait l'état intermédiaire à deux
 * défauts que produiraient deux `update` PostgREST séparés.
 */
export async function definirParDefaut(pipelineId: string): Promise<void> {
  const { error } = await supabase.rpc('pipeline_definir_defaut', {
    p_pipeline_id: pipelineId,
  });
  if (error) throw error;
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

/**
 * Pourquoi on perd, et depuis quelle étape.
 *
 * Les deals ABANDONNÉS (client injoignable) sont exclus côté base : ce ne
 * sont pas des défaites commerciales, et les compter ici rendrait « pourquoi
 * on perd » illisible.
 */
export async function fetchRaisonsPerte(from?: string, to?: string): Promise<RaisonPerteRow[]> {
  const { data, error } = await supabase.rpc('pipeline_raisons_perte', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data ?? []) as RaisonPerteRow[];
}

/** Par vendeur. Les deals non assignés ont leur propre ligne, en dernier. */
export async function fetchParVendeur(from?: string, to?: string): Promise<VendeurRow[]> {
  const { data, error } = await supabase.rpc('pipeline_par_vendeur', { p_from: from ?? null, p_to: to ?? null });
  if (error) throw error;
  return (data ?? []) as VendeurRow[];
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

/**
 * Valeur de chaque deal, dérivée : job liée, sinon devis lié, sinon dernier
 * devis du client. Aucun montant n'est stocké sur le deal (décision Q5).
 * Rendu en Map pour que le board y accède sans parcourir un tableau.
 */
export async function fetchMontants(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('pipeline_montants');
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as MontantDeal[]) {
    if (r.cents > 0) out[r.deal_id] = Number(r.cents);
  }
  return out;
}

/**
 * Membres de l'organisation, pour afficher le nom d'un deal assigné.
 *
 * `team_members` porte `first_name` / `last_name` — PAS `full_name` : une
 * assignation avait déjà été cassée par cette confusion (audit 2026-09-10).
 * Les membres sans compte utilisateur sont écartés : on ne peut pas leur
 * assigner un deal.
 */
export async function fetchMembres(): Promise<{ id: string; name: string }[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id,first_name,last_name,email')
    .eq('org_id', orgId)
    .not('user_id', 'is', null);
  if (error) throw error;
  return (data ?? [])
    .filter((m): m is { user_id: string; first_name: string; last_name: string; email: string } => !!m.user_id)
    .map((m) => ({
      id: m.user_id,
      name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email,
    }));
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
