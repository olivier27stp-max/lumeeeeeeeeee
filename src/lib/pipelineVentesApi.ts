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
import { listClients } from './clientsApi';

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
  /** Chance de conclure depuis cette étape, 0-100. `null` = non renseignée. */
  probability: number | null;
  /** Icône ENTONNOIR — `false` = exclue de l'entonnoir et des prévisions. */
  show_in_reports: boolean;
  /** Icône CAMEMBERT — `false` = exclue de la répartition par étape. */
  show_in_pie: boolean;
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
  /** Date de fermeture visée — le mois de la chronologie. `null` = sans date. */
  expected_close_date: string | null;
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
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Où la couleur d'une étape apparaît sur le board.
 *
 * Les teintes restent DÉRIVÉES du rang de l'étape (`presentation.ts`) : une
 * palette stockée devrait être maintenue à la main, et réordonner un
 * pipeline la désaccorderait en silence. Ce réglage dit seulement OÙ elle
 * se pose.
 */
export type ModeCouleur = 'none' | 'dot' | 'tint';

export interface PipelineResume {
  id: string;
  name: string;
  /** Le premier de la liste (position 1) — c'est lui qui reçoit les leads sans destination. */
  is_default: boolean;
  /** Ordre de la liste « Pipelines », utilisé partout où l'on choisit un pipeline. */
  position?: number;
  /** Dernière modification du pipeline lui-même (pas de ses deals). */
  updated_at?: string;
  /** Étapes actives. Compté par la base — la liste seule ne le dirait pas. */
  nb_etapes?: number;
  /** Où le board pose la teinte : aucune, pastille, ou fond de colonne. */
  color_mode?: ModeCouleur;
  /** La prévision lit la probabilité du deal plutôt que celle de l'étape. */
  use_deal_probability?: boolean;
}

/** Les pipelines ACTIFS de l'organisation, dans l'ordre de la liste « Pipelines ». */
export async function fetchPipelines(): Promise<PipelineResume[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('pipelines_ventes')
    // `pipeline_stages(count)` : PostgREST compte les étapes actives sans
    // les rapatrier. Les charger toutes pour n'afficher qu'un nombre
    // ramènerait des centaines de lignes inutiles.
    .select('id,name,is_default,position,updated_at,color_mode,use_deal_probability,pipeline_stages(count)')
    .eq('org_id', orgId)
    // Un pipeline supprimé est ARCHIVÉ : ses deals ont été déplacés, il
    // n'est plus proposé nulle part.
    .is('archived_at', null)
    .is('pipeline_stages.archived_at', null)
    .order('position')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    const compte = x.pipeline_stages as Array<{ count: number }> | undefined;
    return {
      id: x.id as string,
      name: x.name as string,
      is_default: x.is_default as boolean,
      position: x.position as number | undefined,
      updated_at: x.updated_at as string | undefined,
      nb_etapes: compte?.[0]?.count ?? 0,
      color_mode: (x.color_mode as ModeCouleur | null) ?? 'none',
      use_deal_probability: (x.use_deal_probability as boolean | null) ?? false,
    };
  });
}

export async function fetchStages(pipelineId: string): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('id,pipeline_id,name_fr,name_en,guidance_fr,guidance_en,position,kind,probability,show_in_reports,show_in_pie,archived_at')
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
      'lost_reason,lost_from_stage_id,expected_close_date,pin_id,field_rep_id,created_at,' +
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

/**
 * Les relances automatiques parties sur ce deal.
 *
 * C'est la matière première du Reçu : sans savoir QUAND une relance est
 * partie, on ne peut pas dire qu'elle a récupéré une vente. Le journal
 * d'exécution des automatisations porte déjà l'information (`entity_type` +
 * `entity_id`) — il suffisait de la lire du bon côté.
 *
 * On interroge aussi le CLIENT, pas seulement le deal : une relance de
 * soumission vise la facture ou le devis, mais elle a bel et bien été
 * déclenchée pour cette personne, et c'est ce que le vendeur veut voir.
 */
export interface RelanceDeal {
  id: string;
  /** `send_sms`, `send_email`, `create_task`… */
  action: string;
  reussi: boolean;
  erreur: string | null;
  declencheur: string;
  created_at: string;
}

export async function fetchRelances(
  dealId: string,
  clientId?: string | null,
): Promise<RelanceDeal[]> {
  // `entity_id` est un uuid nu : on cible le deal ET son client, sans
  // supposer lequel des deux l'automatisation a nommé.
  const cibles = [dealId, clientId].filter(Boolean) as string[];
  const { data, error } = await supabase
    .from('automation_execution_logs')
    .select('id,action_type,result_success,result_error,trigger_event,created_at,entity_id')
    .in('entity_id', cibles)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((x: Record<string, unknown>) => ({
    id: x.id as string,
    action: (x.action_type as string) ?? '',
    reussi: (x.result_success as boolean) ?? false,
    erreur: (x.result_error as string) ?? null,
    declencheur: (x.trigger_event as string) ?? '',
    created_at: x.created_at as string,
  }));
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
  champs: { title: string; due_date: string | null; assignee_user_id?: string | null },
): Promise<TacheDeal> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      created_by: user.id,
      // Une tâche SANS responsable n'apparaît dans la liste de personne :
      // « Planifier un rappel » créait donc une tâche que son auteur ne
      // revoyait jamais. À défaut de destinataire explicite, elle revient à
      // celui qui la pose — c'est lui qui a demandé à être rappelé.
      assignee_user_id: champs.assignee_user_id ?? user.id,
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

/**
 * La date de fermeture visée.
 *
 * Reporter la date incrémente le glissement (trigger en base) ; l'avancer ne
 * compte pas — c'est une bonne nouvelle, pas un signal de risque.
 */
export async function majDateFermeture(dealId: string, date: string | null): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .update({ expected_close_date: date || null })
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

/**
 * Rattache une job au deal, et le fait passer en « Gagné ».
 *
 * LE BUG (QA 2026-09-24, P0-1) : cette fonction n'écrivait que `job_id`. On
 * choisissait « Gagné » dans la fiche, la job se créait, le message disait
 * « Job créée et liée au deal » — et le deal restait dans son étape
 * d'origine. Le commentaire d'appel affirmait pourtant que le modal écrivait
 * « l'étape ET la job d'un seul geste » ; c'est ce commentaire faux qui a
 * masqué le défaut.
 *
 * `versEtapeId` est optionnel : créer une job depuis un deal encore ouvert
 * (chemin « Créer une job » de la fiche) ne doit pas le déclarer gagné.
 */
export async function lierJob(
  dealId: string,
  jobId: string,
  versEtapeId?: string | null,
): Promise<void> {
  const champs: { job_id: string; stage_id?: string } = { job_id: jobId };
  if (versEtapeId) champs.stage_id = versEtapeId;

  const { error } = await supabase.from('deals').update(champs).eq('id', dealId);
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
 * Trois portes d'entrée :
 *  - `clientId` : un client DÉJÀ en base. La base lit le contact sur sa fiche
 *    et y rattache le deal — aucun doublon possible, même pour un client
 *    sans téléphone ni courriel.
 *  - `quoteId` : un devis existant. Il donne son client et son montant, et
 *    est RATTACHÉ au deal au lieu qu'un devis estimatif soit fabriqué.
 *  - ni l'un ni l'autre : un nouveau contact, rapproché par `ingest_lead`
 *    sur le téléphone ou le courriel (la porte du formulaire public).
 *
 * `pipelineId` choisit le pipeline ; sans lui, celui par défaut.
 */
export async function creerDealManuel(champs: {
  prenom: string;
  nom?: string | null;
  courriel?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  /**
   * Ce qui fait vivre les prévisions. Tous optionnels : un champ absent
   * laisse le deal dans « Corriger vos données », jamais un chiffre inventé.
   *
   * Le montant n'est PAS écrit sur le deal — il reste dérivé. La base en fait
   * un devis brouillon rattaché, donc visible et modifiable plus tard.
   */
  montantCents?: number | null;
  assigneA?: string | null;
  dateFermetureVisee?: string | null;
  source?: string | null;
  clientId?: string | null;
  quoteId?: string | null;
  pipelineId?: string | null;
}): Promise<{ dealId: string; fusionne: boolean; dealExistant: boolean; pipelineId: string | null }> {
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
    p_montant_cents: champs.montantCents ?? null,
    p_assigne_a: champs.assigneA ?? null,
    p_date_fermeture_visee: champs.dateFermetureVisee ?? null,
    p_source: champs.source ?? null,
    p_client_id: champs.clientId ?? null,
    p_quote_id: champs.quoteId ?? null,
    p_pipeline_id: champs.pipelineId ?? null,
  });
  if (error) throw error;
  const r = data as { deal_id: string; fusionne: boolean; deal_existant: boolean };

  // OÙ le deal a VRAIMENT atterri, relu en base plutôt que supposé : un
  // pipeline sans étape ouverte fait retomber `ingest_lead` sur le pipeline
  // par défaut. Sans cette relecture, le compteur restait à zéro et le bug
  // passait pour un défaut de rafraîchissement (QA 2026-09-24, P1-6).
  let pipelineId: string | null = null;
  if (r.deal_id) {
    const { data: place } = await supabase
      .from('deals')
      .select('pipeline_id')
      .eq('id', r.deal_id)
      .maybeSingle();
    pipelineId = (place as { pipeline_id?: string } | null)?.pipeline_id ?? null;
  }

  return { dealId: r.deal_id, fusionne: r.fusionne, dealExistant: r.deal_existant, pipelineId };
}

/** Un client proposé dans « Nouveau deal ». */
export interface ClientPourDeal {
  id: string;
  nom: string;
  telephone: string | null;
  courriel: string | null;
  adresse: string | null;
}

/** Un devis proposé dans « Nouveau deal ». */
export interface DevisPourDeal {
  id: string;
  numero: string;
  titre: string | null;
  statut: string;
  totalCents: number;
  clientId: string;
  clientNom: string;
}

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function nomAffiche(c: { first_name?: string | null; last_name?: string | null; company?: string | null }): string {
  const n = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return n || (c.company ?? '').trim() || '—';
}

/**
 * Cherche les clients de l'organisation (nom, entreprise, courriel,
 * téléphone, adresse — accents ignorés, via `listClients`).
 *
 * Sert aussi l'AVERTISSEMENT de doublon : un nom tapé à la main est
 * comparé aux fiches existantes avant la création.
 */
export async function rechercherClientsPourDeal(q: string, limite = 8): Promise<ClientPourDeal[]> {
  const mots = sansAccents(q).split(/\s+/).filter((m) => m.length > 0);
  if (mots.join('').length < 2) return [];
  // `listClients` compare chaque colonne SÉPARÉMENT : « marc tremblay » n'est
  // contenu ni dans le prénom ni dans le nom, et ne trouverait rien — ni ici,
  // ni pour l'avertissement de doublon. On interroge donc la base sur le mot
  // le plus long, puis on exige que TOUS les mots soient présents.
  const pivot = mots.reduce((a, b) => (b.length > a.length ? b : a));
  const { items } = await listClients({
    q: pivot,
    pageSize: mots.length > 1 ? 50 : limite,
    sort: 'activity_desc',
  });
  return items
    .filter((c) => {
      const botte = sansAccents(
        [c.first_name, c.last_name, c.company, c.email, c.phone, c.address].filter(Boolean).join(' '),
      );
      return mots.every((m) => botte.includes(m));
    })
    .slice(0, limite)
    .map((c) => ({
    id: c.id,
    nom: nomAffiche(c),
    telephone: c.phone ?? null,
    courriel: c.email ?? null,
    adresse: c.address ?? null,
  }));
}

/**
 * Les devis qui peuvent encore devenir une affaire : ni convertis, ni
 * archivés, ni refusés, ni expirés — ceux-là sont déjà tranchés.
 * Recherche sur le numéro, le titre ou le nom du client.
 */
export async function rechercherDevisPourDeal(q: string, limite = 8): Promise<DevisPourDeal[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  let requete = supabase
    .from('quotes')
    .select('id,quote_number,title,status,total_cents,client_id,clients!quotes_client_id_fkey!inner(first_name,last_name,company,deleted_at)')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('client_id', 'is', null)
    .in('status', ['draft', 'awaiting_response', 'changes_requested', 'approved'])
    .order('created_at', { ascending: false })
    .limit(limite);

  // Le nom du client vit sur `clients`, pas sur `quotes` : un `.or()` qui
  // mélangerait les deux ferait échouer TOUTE la requête (PostgREST refuse une
  // colonne inconnue, et supabase-js ne lève pas — la liste resterait vide en
  // silence). On cherche donc d'abord les clients, puis leurs devis.
  const t = q.trim().replace(/[,%_()]/g, ' ').trim();
  if (t) {
    const clients = await rechercherClientsPourDeal(t, 25);
    const ids = clients.map((c) => c.id);
    const parDevis = `quote_number.ilike.%${t}%,title.ilike.%${t}%`;
    requete = requete.or(ids.length ? `${parDevis},client_id.in.(${ids.join(',')})` : parDevis);
  }

  const { data, error } = await requete;
  if (error) throw error;
  type Ligne = {
    id: string; quote_number: string | null; title: string | null; status: string;
    total_cents: number | null; client_id: string;
    clients: { first_name: string | null; last_name: string | null; company: string | null; deleted_at: string | null } | null;
  };
  return ((data ?? []) as unknown as Ligne[])
    .filter((d) => d.clients && !d.clients.deleted_at)
    .map((d) => ({
      id: d.id,
      numero: d.quote_number ?? '—',
      titre: d.title,
      statut: d.status,
      totalCents: d.total_cents ?? 0,
      clientId: d.client_id,
      clientNom: d.clients ? nomAffiche(d.clients) : '—',
    }));
}

// ── Réglages des étapes ─────────────────────────────────────

export async function renommerEtape(
  stageId: string,
  champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en' | 'probability' | 'show_in_reports' | 'show_in_pie'>>,
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
/**
 * Remet une étape archivée sur le board.
 *
 * Elle repart EN DERNIÈRE position parmi les étapes ouvertes : sa place
 * d'origine a pu être reprise depuis, et réinsérer de force au milieu
 * décalerait tout le reste sans que personne l'ait demandé. Le client la
 * remonte ensuite avec les flèches s'il le souhaite.
 *
 * Sans cette fonction, archiver était irréversible (QA 2026-09-24, P0-2).
 */
export async function desarchiverEtape(stageId: string): Promise<void> {
  const { data: etape, error: eLecture } = await supabase
    .from('pipeline_stages')
    .select('pipeline_id,kind')
    .eq('id', stageId)
    .maybeSingle();
  if (eLecture) throw eLecture;
  if (!etape) throw new Error('Étape introuvable.');

  // La dernière position occupée du pipeline, archivées comprises : viser
  // au-delà garantit qu'on n'entre en conflit avec personne.
  const { data: derniere } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('pipeline_id', (etape as { pipeline_id: string }).pipeline_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = ((derniere as { position?: number } | null)?.position ?? 0) + 1;

  const { error } = await supabase
    .from('pipeline_stages')
    .update({ archived_at: null, position })
    .eq('id', stageId);
  if (error) throw error;
}

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

/** Le refus d'unicité de la base, en clair : jamais de code brut à l'écran. */
function nomDejaPris(error: unknown): Error | null {
  return (error as { code?: string } | null)?.code === '23505'
    ? new Error('Un pipeline porte déjà ce nom. Choisissez-en un autre.')
    : null;
}

export async function renommerPipeline(pipelineId: string, nom: string): Promise<void> {
  const { error } = await supabase
    .from('pipelines_ventes')
    .update({ name: nom.trim() })
    .eq('id', pipelineId);
  if (error) throw nomDejaPris(error) ?? error;
}

/**
 * Règle l'affichage d'un pipeline APRÈS sa création.
 *
 * Ces deux champs n'étaient posés qu'à la création : pour passer d'un
 * affichage gris à un affichage teinté, il fallait recréer le pipeline —
 * donc perdre ses deals.
 *
 * Un champ laissé à `undefined` n'est pas écrit : on peut changer la couleur
 * sans toucher au mode de probabilité. Sans ça, régler l'un depuis un onglet
 * écraserait ce qu'un autre vient de changer.
 */
export async function definirAffichagePipeline(
  pipelineId: string,
  reglages: { color_mode?: ModeCouleur; use_deal_probability?: boolean },
): Promise<void> {
  const { error } = await supabase.rpc('pipeline_definir_affichage', {
    p_pipeline_id: pipelineId,
    p_color_mode: reglages.color_mode ?? null,
    p_use_deal_probability: reglages.use_deal_probability ?? null,
  });
  if (error) throw error;
}

/**
 * Le pipeline par défaut n'est plus un réglage à part : c'est le PREMIER de
 * la liste « Pipelines » (voir `reordonnerPipelines`).
 */

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
    // `devis_client` = le dernier devis du CLIENT, pas un chiffrage de ce
    // deal-ci. Sur une carte, un montant est lu comme la valeur du deal :
    // afficher 4 900 $ sur un « Nouveau lead » que personne n'a chiffré fait
    // gonfler le total de la colonne avec de l'argent qui n'existe pas.
    // Le repère reste visible dans la fiche, où il est expliqué.
    if (r.cents > 0 && r.provenance !== 'devis_client') out[r.deal_id] = Number(r.cents);
  }
  return out;
}

/**
 * Les montants AVEC leur provenance, pour la fiche.
 *
 * `fetchMontants` écarte volontairement les montants spéculatifs (le dernier
 * devis du client) : sur une carte, un chiffre est lu comme la valeur du
 * deal. La fiche, elle, a la place de dire d'où il vient — elle a donc
 * besoin de la provenance, pas seulement du nombre.
 */
export async function fetchMontantsDetailles(): Promise<Record<string, MontantDeal>> {
  const { data, error } = await supabase.rpc('pipeline_montants');
  if (error) throw error;
  const out: Record<string, MontantDeal> = {};
  for (const r of (data ?? []) as MontantDeal[]) {
    out[r.deal_id] = { ...r, cents: Number(r.cents) };
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

/** Les pipelines que l'utilisateur connecté peut MODIFIER sans être administrateur. */
export async function fetchMesPipelinesModifiables(): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('pipeline_acces')
    .select('pipeline_id')
    .eq('user_id', user.id)
    .eq('peut_modifier', true);
  if (error) throw error;
  return ((data ?? []) as { pipeline_id: string }[]).map((r) => r.pipeline_id);
}

/** Rôle de chaque membre actif (page Rôles) — pour les permissions d'un pipeline. */
export async function fetchRolesMembres(): Promise<Record<string, string>> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id,role')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const m of (data ?? []) as { user_id: string; role: string }[]) out[m.user_id] = m.role;
  return out;
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

// ── Vues sauvegardées du board ──────────────────────────────
//
// Une vue vit en base, pas dans `localStorage` : elle doit suivre le vendeur
// d'un appareil à l'autre, et une vue d'entreprise doit être la même pour
// toute l'équipe. `user_id` NULL = vue d'entreprise (admins) ; sinon vue
// privée. C'est la RLS qui décide de ce qui remonte — jamais le client.

export interface VueSauvegardee {
  id: string;
  pipeline_id: string;
  /** `null` = vue d'entreprise, visible de toute l'équipe. */
  user_id: string | null;
  nom: string;
  /** Forme libre : le board ignore les clés qu'il ne connaît pas. */
  filtres: Record<string, string>;
  tri: string | null;
  affichage: string | null;
  position: number;
}

export async function fetchVues(pipelineId: string): Promise<VueSauvegardee[]> {
  const { data, error } = await supabase
    .from('pipeline_vues')
    .select('id,pipeline_id,user_id,nom,filtres,tri,affichage,position')
    .eq('pipeline_id', pipelineId)
    .order('position')
    .order('nom');
  if (error) throw error;
  return (data ?? []) as VueSauvegardee[];
}

export async function creerVue(
  pipelineId: string,
  nom: string,
  filtres: Record<string, string>,
  options: { tri?: string | null; affichage?: string | null; pourEquipe?: boolean } = {},
): Promise<string> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id ?? null;
  if (!uid) throw new Error('Aucune session.');

  const { data, error } = await supabase
    .from('pipeline_vues')
    .insert({
      org_id: orgId,
      pipeline_id: pipelineId,
      // Une vue d'entreprise s'impose à toute l'équipe : la RLS la refuse
      // aux non-admins, et l'écran ne propose la case qu'au patron.
      user_id: options.pourEquipe ? null : uid,
      nom: nom.trim(),
      // On ne garde que les filtres RENSEIGNÉS : une vue n'a pas à transporter
      // des clés vides qui grossissent sans rien vouloir dire.
      filtres: Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== '')),
      tri: options.tri ?? null,
      affichage: options.affichage ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function supprimerVue(vueId: string): Promise<void> {
  const { error } = await supabase.from('pipeline_vues').delete().eq('id', vueId);
  if (error) throw error;
}

// ── Raisons de perte proposées ──────────────────────────────
//
// `deals.lost_reason` reste du TEXTE : cette liste harmonise l'écriture sans
// empêcher un motif imprévu. Sans elle, « trop cher », « prix » et « trop
// dispendieux » comptent pour trois raisons distinctes dans les statistiques,
// et le seul retour structuré sur pourquoi on perd devient illisible.

export interface RaisonPerteProposee {
  id: string;
  libelle: string;
  position: number;
}

export async function fetchRaisonsProposees(): Promise<RaisonPerteProposee[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('pipeline_raisons_perte_liste')
    .select('id,libelle,position')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('position');
  if (error) throw error;
  return (data ?? []) as RaisonPerteProposee[];
}

/**
 * Ajoute un motif à la liste (réservé aux admins par la RLS).
 *
 * Un motif déjà présent n'est pas une erreur à montrer : on renvoie
 * simplement l'existant, pour que l'écran n'interrompe pas la saisie d'un
 * vendeur qui retape un libellé connu.
 */
export async function ajouterRaisonProposee(libelle: string): Promise<RaisonPerteProposee | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const propre = libelle.trim();
  if (!propre) return null;

  const { data, error } = await supabase
    .from('pipeline_raisons_perte_liste')
    .insert({ org_id: orgId, libelle: propre, position: 99 })
    .select('id,libelle,position')
    .single();

  if (error) {
    // 23505 = doublon : un motif ACTIF porte déjà ce libellé (l'index ignore
    // désormais les archivés). On rend l'existant, la saisie n'est pas une
    // erreur à montrer.
    if ((error as { code?: string }).code === '23505') {
      const { data: existant } = await supabase
        .from('pipeline_raisons_perte_liste')
        .select('id,libelle,position')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .ilike('libelle', propre)
        .maybeSingle();
      return (existant as RaisonPerteProposee) ?? null;
    }
    throw error;
  }
  return data as RaisonPerteProposee;
}

/**
 * Retire un motif de la liste — archivage, jamais suppression.
 *
 * Les deals perdus citent encore ce texte : supprimer la ligne ne les
 * changerait pas, mais un motif qu'on « retire » doit pouvoir revenir, et
 * l'historique de la liste a sa valeur. Il cesse simplement d'être proposé.
 */
export async function archiverRaisonProposee(id: string): Promise<void> {
  const { error } = await supabase
    .from('pipeline_raisons_perte_liste')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Le dossier complet du client, vu depuis un deal ─────────
//
// La fiche ne lisait que `deal.job_id` et `deal.quote_id` : UN job, UN devis.
// Un client qui a fait affaire six fois avec l'entreprise apparaissait donc
// comme s'il arrivait de nulle part — alors que la page Client, elle, montre
// tout. Un vendeur qui rappelle quelqu'un a besoin de savoir qu'il lui doit
// déjà 1 200 $, ou qu'on lui a posé trois devis sans suite.

export interface LigneHistorique {
  id: string;
  /** Ce qu'on montre : numéro de job, de devis ou de facture. */
  numero: string;
  titre: string;
  statut: string;
  cents: number;
  /** Solde restant dû — factures seulement. */
  solde_cents?: number;
  date: string;
}

export interface MessageClient {
  id: string;
  /** `inbound` = le client nous écrit ; `outbound` = on lui écrit. */
  direction: string;
  texte: string;
  date: string;
}

export interface DossierClient {
  jobs: LigneHistorique[];
  devis: LigneHistorique[];
  factures: LigneHistorique[];
  /** Les encaissements réels — ce qui est entré au compte. */
  transactions: LigneHistorique[];
  /** Les propriétés du client : ses immeubles, ses adresses de service. */
  proprietes: { id: string; nom: string; adresse: string | null }[];
  messages: MessageClient[];
  /** Somme encaissée depuis toujours — ce que le client a réellement payé. */
  paye_cents: number;
  /** Ce qu'il doit ENCORE : somme des soldes de factures non réglées. */
  du_cents: number;
}

const DOSSIER_VIDE: DossierClient = {
  jobs: [], devis: [], factures: [], transactions: [], proprietes: [], messages: [], paye_cents: 0, du_cents: 0,
};

/**
 * Tout l'historique d'un client, pas seulement ce que ce deal-ci a produit.
 *
 * Les cinq lectures partent ensemble : la fiche s'ouvre déjà, et enchaîner
 * les requêtes ferait clignoter les sections l'une après l'autre.
 *
 * Une lecture refusée (un vendeur n'a pas le droit de voir les montants —
 * `membre_voit_les_montants` protège `quotes`) rend une section vide plutôt
 * que de faire échouer toute la fiche : mieux vaut une section absente qu'un
 * écran mort.
 */
export async function fetchDossierClient(clientId: string | null): Promise<DossierClient> {
  if (!clientId) return DOSSIER_VIDE;

  const [jobsR, devisR, facturesR, messagesR, paiementsR, proprietesR] = await Promise.all([
    supabase.from('jobs')
      .select('id,job_number,title,status,total_cents,created_at')
      .eq('client_id', clientId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('quotes')
      .select('id,quote_number,title,status,total_cents,created_at')
      .eq('client_id', clientId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('invoices')
      .select('id,invoice_number,status,total_cents,paid_cents,balance_cents,created_at')
      .eq('client_id', clientId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('messages')
      .select('id,direction,message_text,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(10),
    // Les encaissements réels : « Transactions » dans le filtre des paiements.
    supabase.from('payments')
      .select('id,amount_cents,paid_at,method,status')
      .eq('client_id', clientId).is('deleted_at', null)
      .order('paid_at', { ascending: false }).limit(50),
    // Les propriétés : l'équivalent terrain des « objets associés » de GHL.
    supabase.from('properties')
      .select('id,name,address')
      .eq('client_id', clientId).is('deleted_at', null)
      .order('name').limit(20),
  ]);

  const jobs = (jobsR.data ?? []).map((j: Record<string, unknown>) => ({
    id: j.id as string,
    numero: (j.job_number as string) ?? '',
    titre: (j.title as string) ?? '',
    statut: (j.status as string) ?? '',
    cents: (j.total_cents as number) ?? 0,
    date: j.created_at as string,
  }));

  const devis = (devisR.data ?? []).map((q: Record<string, unknown>) => ({
    id: q.id as string,
    numero: (q.quote_number as string) ?? '',
    titre: (q.title as string) ?? '',
    statut: (q.status as string) ?? '',
    cents: (q.total_cents as number) ?? 0,
    date: q.created_at as string,
  }));

  const factures = (facturesR.data ?? []).map((f: Record<string, unknown>) => ({
    id: f.id as string,
    numero: (f.invoice_number as string) ?? '',
    titre: '',
    statut: (f.status as string) ?? '',
    cents: (f.total_cents as number) ?? 0,
    solde_cents: (f.balance_cents as number) ?? 0,
    date: f.created_at as string,
  }));

  const messages = (messagesR.data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    direction: (m.direction as string) ?? '',
    texte: (m.message_text as string) ?? '',
    date: m.created_at as string,
  }));

  const transactions = (paiementsR.data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    numero: (t.method as string) || '—',
    titre: '',
    statut: (t.status as string) ?? '',
    cents: (t.amount_cents as number) ?? 0,
    date: (t.paid_at as string) ?? '',
  }));

  const proprietes = (proprietesR.data ?? []).map((x: Record<string, unknown>) => ({
    id: x.id as string,
    nom: (x.name as string) ?? '',
    adresse: (x.address as string) ?? null,
  }));

  // Un BROUILLON n'est pas une dette : il n'a jamais été envoyé, donc le
  // client ne doit rien et ne sait même pas qu'il existe. Les compter dans
  // « Doit » gonflait le solde de 5 823 $ en production, répartis sur 14
  // brouillons — de l'argent jamais réclamé, affiché comme réclamé.
  //
  // Une facture ANNULÉE (`void`) porte déjà un solde à zéro en base : elle
  // n'a jamais faussé le total, on la laisse donc passer telle quelle.
  const facturesReclamees = (facturesR.data ?? []).filter(
    (f: Record<string, unknown>) => (f.status as string) !== 'draft',
  );

  return {
    jobs, devis, factures, transactions, proprietes, messages,
    // `paid_cents` et `balance_cents` sont tenus par la base : on les somme,
    // on ne les recalcule pas.
    paye_cents: facturesReclamees.reduce(
      (s: number, f: Record<string, unknown>) => s + ((f.paid_cents as number) ?? 0), 0),
    du_cents: facturesReclamees.reduce(
      (s: number, f: Record<string, unknown>) => s + ((f.balance_cents as number) ?? 0), 0),
  };
}

// ── Pastilles automatiques ──────────────────────────────────
//
// GoHighLevel appelle ça des « smart tags » et les fait configurer par un
// constructeur de règles en deux écrans. Pour une PME de service, ça revient
// à faire remplir un formulaire pour obtenir ce que le logiciel sait déjà.
//
// Ici elles sont DÉRIVÉES, comme le montant et la priorité : rien n'est
// stocké, rien n'est à configurer, et une pastille ne peut pas devenir fausse
// parce qu'un travail de fond a cessé de tourner.

export type ClePastille = 'gros' | 'dort' | 'non_assigne' | 'jamais_contacte' | 'a_relancer';

export interface Pastille {
  cle: ClePastille;
  fr: string;
  en: string;
  /** Teinte CSS — `danger` attire l'œil, `info` informe seulement. */
  ton: 'danger' | 'warning' | 'info';
}

/** Au-dessus de ce montant, un deal mérite qu'on le traite en premier. */
const SEUIL_GROS_CENTS = 500_000; // 5 000 $

/**
 * Les pastilles d'un deal, au plus deux.
 *
 * Deux, pas plus : une carte couverte de pastilles ne hiérarchise plus rien,
 * et l'œil cesse de les lire. Elles sortent dans l'ordre d'urgence, donc les
 * deux premières sont les deux qui comptent.
 *
 * Aucune pastille sur un deal fermé : « dort depuis 20 jours » sur une vente
 * conclue est un faux signal.
 */
export function pastilles(
  deal: Deal,
  stages: PipelineStage[],
  montantCents: number | undefined,
  maintenant = new Date(),
): Pastille[] {
  const s = stages.find((x) => x.id === deal.stage_id);
  if (!s || s.kind !== 'open') return [];

  const out: Pastille[] = [];
  const jours = Math.floor(
    (maintenant.getTime() - new Date(deal.last_activity_at).getTime()) / 86_400_000,
  );

  // 1. Jamais contacté : le pire cas, parce que le client attend une réponse
  //    qu'il n'a jamais eue. Passe avant « dort », qui en est la conséquence.
  if (!deal.first_contacted_at && jours >= 1) {
    out.push({ cle: 'jamais_contacte', fr: 'Jamais contacté', en: 'Never contacted', ton: 'danger' });
  }

  // 2. Personne ne l'a pris. Un lead sans propriétaire n'est relancé par
  //    personne — c'est une fuite silencieuse.
  if (!deal.assigned_user_id) {
    out.push({ cle: 'non_assigne', fr: 'Non assigné', en: 'Unassigned', ton: 'warning' });
  }

  // 3. Dort depuis deux semaines.
  if (jours >= 14) {
    out.push({ cle: 'dort', fr: `Dort ${jours} j`, en: `Stale ${jours}d`, ton: 'danger' });
  } else if (jours >= 5) {
    out.push({ cle: 'a_relancer', fr: 'À relancer', en: 'Follow up', ton: 'warning' });
  }

  // 4. Gros montant — informatif, jamais alarmant : un gros deal récent et
  //    bien suivi n'a aucun problème.
  if ((montantCents ?? 0) >= SEUIL_GROS_CENTS) {
    out.push({ cle: 'gros', fr: 'Gros job', en: 'High value', ton: 'info' });
  }

  return out.slice(0, 2);
}

// ── Partage d'un pipeline ───────────────────────────────────
//
// AUCUNE ligne = le pipeline est visible de toute l'organisation, ce qui est
// l'état par défaut et celui de toutes les organisations existantes. Dès
// qu'une ligne apparaît, il devient réservé aux membres nommés — plus les
// administrateurs, qui voient toujours tout.

export interface AccesPipeline {
  id: string;
  user_id: string;
  /** Peut aussi MODIFIER le pipeline (nom, étapes, réglages). */
  peut_modifier: boolean;
}

export async function fetchAccesPipeline(pipelineId: string): Promise<AccesPipeline[]> {
  const { data, error } = await supabase
    .from('pipeline_acces')
    .select('id,user_id,peut_modifier')
    .eq('pipeline_id', pipelineId);
  if (error) throw error;
  return (data ?? []) as AccesPipeline[];
}

/**
 * Donne accès à un membre.
 *
 * Le premier appel sur un pipeline le FERME : il passe de « visible de tous »
 * à « réservé aux nommés ». L'écran doit le dire avant, pas après.
 */
export async function donnerAccesPipeline(pipelineId: string, userId: string, peutModifier = false): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('pipeline_acces')
    .insert({ org_id: orgId, pipeline_id: pipelineId, user_id: userId, peut_modifier: peutModifier });
  // 23505 = ce membre a déjà accès : ce n'est pas une erreur à montrer.
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

/** Donne ou retire le droit de MODIFIER à un membre qui voit déjà le pipeline. */
export async function majDroitModifier(accesId: string, peutModifier: boolean): Promise<void> {
  const { error } = await supabase.from('pipeline_acces').update({ peut_modifier: peutModifier }).eq('id', accesId);
  if (error) throw error;
}

export async function retirerAccesPipeline(accesId: string): Promise<void> {
  const { error } = await supabase.from('pipeline_acces').delete().eq('id', accesId);
  if (error) throw error;
}

/**
 * Rouvre le pipeline à toute l'organisation, en supprimant tout partage.
 *
 * Retirer les accès un par un aboutirait au même résultat, mais laisserait
 * croire qu'on restreint de plus en plus alors qu'on rouvre d'un coup à la
 * dernière suppression. Un geste explicite vaut mieux qu'un effet de bord.
 */
export async function rouvrirPipeline(pipelineId: string): Promise<void> {
  const { error } = await supabase.from('pipeline_acces').delete().eq('pipeline_id', pipelineId);
  if (error) throw error;
}

// ── Les rendez-vous du client ───────────────────────────────
//
// Les visites ne sont pas rattachées au deal : elles vivent sur la JOB
// (`schedule_events.job_id`). C'est voulu — on planifie du travail, pas une
// intention de vente. La fiche montre donc les visites de toutes les jobs du
// client, pas seulement celles du deal courant : quelqu'un qu'on rappelle a
// peut-être déjà une visite prévue mardi pour un autre contrat.

export interface RendezVousClient {
  id: string;
  job_id: string | null;
  titre: string;
  debut: string | null;
  statut: string;
}

export async function fetchRendezVousClient(clientId: string | null): Promise<RendezVousClient[]> {
  if (!clientId) return [];

  // `schedule_events` n'a pas de `client_id` : on passe par les jobs.
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('id,title')
    .eq('client_id', clientId)
    .is('deleted_at', null);
  if (jobsErr) throw jobsErr;

  const ids = (jobs ?? []).map((j) => (j as { id: string }).id);
  if (ids.length === 0) return [];

  const titres = new Map(
    (jobs ?? []).map((j) => [(j as { id: string }).id, (j as { title?: string }).title ?? '']),
  );

  const { data, error } = await supabase
    .from('schedule_events')
    .select('id,job_id,start_at,start_time,status')
    .in('job_id', ids)
    .order('start_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  return (data ?? []).map((e) => {
    const r = e as Record<string, unknown>;
    return {
      id: r.id as string,
      job_id: (r.job_id as string) ?? null,
      titre: titres.get(r.job_id as string) ?? '',
      // Deux colonnes coexistent dans le schéma : `start_at` est la récente.
      debut: (r.start_at as string) ?? (r.start_time as string) ?? null,
      statut: (r.status as string) ?? '',
    };
  });
}

// ── Prévisions ──────────────────────────────────────────────
//
// Les chiffres sont une PROJECTION, jamais une prévision : ils dépendent de
// probabilités saisies à la main, étape par étape. Une étape sans
// probabilité est ABSENTE du revenu attendu — pas comptée à zéro. La
// différence compte : un pipeline non configuré afficherait sinon « 0 $
// attendu » tout en ayant des deals bien vivants.

export interface PrevisionsPipeline {
  max_potentiel_cents: number;
  attendu_cents: number;
  gagne_cents: number;
  ouverts: number;
  /** Deals ouverts sans date visée — absents de la chronologie. */
  sans_date: number;
  /** Deals ouverts sans montant connu — ils tirent le potentiel vers le bas. */
  sans_montant: number;
  /** Deals dont la date visée est déjà passée. */
  en_retard: number;
}

export interface RisqueRow {
  niveau: 'haut' | 'moyen' | 'faible';
  deals: number;
  montant_cents: number;
}

export interface MoisChronologie {
  mois: string;
  deals: number;
  potentiel_cents: number;
  gagne_cents: number;
}

/** Comment ventiler la prévision. Les trois axes que l'équipe possède. */
export type AxeGroupe = 'etape' | 'vendeur' | 'source';

export interface LigneGroupe {
  cle: string;
  libelle: string;
  nb: number;
  potentiel_cents: number;
  attendu_cents: number;
  gagne_cents: number;
  total_cents: number;
}

/**
 * La prévision ventilée. Un total ne dit pas d'où il vient : savoir qu'on
 * attend 40 000 $ n'aide pas, savoir que 32 000 $ tiennent à trois deals
 * coincés dans la même étape se répare.
 */
export async function fetchPrevisionsGroupees(
  pipelineId: string | null,
  axe: AxeGroupe,
): Promise<LigneGroupe[]> {
  const { data, error } = await supabase.rpc('pipeline_previsions_groupees', {
    p_pipeline_id: pipelineId ?? null,
    p_groupe: axe,
  });
  if (error) throw error;
  return (data ?? []).map((x: Record<string, unknown>) => ({
    cle: String(x.cle ?? ''),
    libelle: String(x.libelle ?? ''),
    nb: Number(x.nb ?? 0),
    potentiel_cents: Number(x.potentiel_cents ?? 0),
    attendu_cents: Number(x.attendu_cents ?? 0),
    gagne_cents: Number(x.gagne_cents ?? 0),
    total_cents: Number(x.total_cents ?? 0),
  }));
}

export async function fetchPrevisions(pipelineId?: string | null): Promise<PrevisionsPipeline | null> {
  const { data, error } = await supabase.rpc('pipeline_previsions', {
    p_pipeline_id: pipelineId ?? null,
  });
  if (error) throw error;
  const r = (data?.[0] ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    max_potentiel_cents: Number(r.max_potentiel_cents ?? 0),
    attendu_cents: Number(r.attendu_cents ?? 0),
    gagne_cents: Number(r.gagne_cents ?? 0),
    ouverts: Number(r.ouverts ?? 0),
    sans_date: Number(r.sans_date ?? 0),
    sans_montant: Number(r.sans_montant ?? 0),
    en_retard: Number(r.en_retard ?? 0),
  };
}

export async function fetchARisque(pipelineId?: string | null, seuils?: {
  hautFois?: number; hautJours?: number; moyenFois?: number; moyenJours?: number;
}): Promise<RisqueRow[]> {
  const { data, error } = await supabase.rpc('pipeline_a_risque', {
    p_pipeline_id: pipelineId ?? null,
    p_haut_fois: seuils?.hautFois ?? 2,
    p_haut_jours: seuils?.hautJours ?? 14,
    p_moyen_fois: seuils?.moyenFois ?? 1,
    p_moyen_jours: seuils?.moyenJours ?? 7,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    niveau: r.niveau as RisqueRow['niveau'],
    deals: Number(r.deals ?? 0),
    montant_cents: Number(r.montant_cents ?? 0),
  }));
}

export async function fetchChronologie(pipelineId?: string | null, mois = 6): Promise<MoisChronologie[]> {
  const { data, error } = await supabase.rpc('pipeline_chronologie', {
    p_pipeline_id: pipelineId ?? null,
    p_mois: mois,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    mois: r.mois as string,
    deals: Number(r.deals ?? 0),
    potentiel_cents: Number(r.potentiel_cents ?? 0),
    gagne_cents: Number(r.gagne_cents ?? 0),
  }));
}

/**
 * Crée un pipeline avec ses propres étapes.
 *
 * `creerPipeline` part d'un modèle figé — c'est le bon défaut pour démarrer.
 * Celle-ci laisse écrire le parcours : un pipeline de contrats saisonniers
 * n'a pas les mêmes étapes qu'un pipeline de soumissions résidentielles.
 *
 * Les étapes « gagné » et « perdu » sont ajoutées par la base si elles
 * manquent : un pipeline qu'on ne peut pas terminer casse le taux de
 * closing, le badge « Job à créer » et la raison de perte.
 */
export interface EtapeSurMesure {
  nom_fr: string;
  nom_en?: string;
  kind: StageKind;
  /** 0-100, ou `null` = non renseignée (absente du revenu attendu). */
  probability?: number | null;
  show_in_reports?: boolean;
}

/** Les réglages d'affichage et de calcul choisis à la création. */
export interface ReglagesPipeline {
  color_mode?: ModeCouleur;
  use_deal_probability?: boolean;
}

export async function creerPipelineSurMesure(
  nom: string,
  etapes: EtapeSurMesure[],
  reglages: ReglagesPipeline = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('creer_pipeline_sur_mesure', {
    p_nom: nom.trim(),
    p_color_mode: reglages.color_mode ?? 'none',
    p_use_deal_probability: reglages.use_deal_probability ?? false,
    p_etapes: etapes.map((e) => ({
      nom_fr: e.nom_fr.trim(),
      nom_en: (e.nom_en ?? e.nom_fr).trim(),
      kind: e.kind,
      probability: e.probability ?? null,
      show_in_reports: e.show_in_reports ?? true,
    })),
  });
  if (error) throw error;
  return data as string;
}

/**
 * Duplique un pipeline : « Nom (copie) », mêmes réglages, mêmes étapes
 * actives — SANS les deals. La base fait la copie (`pipeline_dupliquer`) :
 * conseils, deux interrupteurs de rapports et probabilités compris.
 */
export async function dupliquerPipeline(pipelineId: string): Promise<string> {
  const { data, error } = await supabase.rpc('pipeline_dupliquer', { p_id: pipelineId });
  if (error) throw error;
  return data as string;
}

/**
 * Supprime (archive) un pipeline. S'il contient des deals, ils sont d'abord
 * DÉPLACÉS vers `dest` — sans déclencher d'automatisation chez ces clients.
 * Le dernier pipeline ne peut pas être supprimé. Renvoie le nombre de deals
 * déplacés.
 */
export async function supprimerPipeline(
  pipelineId: string,
  dest?: { pipelineId: string; etapeId: string } | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('pipeline_supprimer', {
    p_id: pipelineId,
    p_dest_pipeline: dest?.pipelineId ?? null,
    p_dest_etape: dest?.etapeId ?? null,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** Nombre de deals actifs d'un pipeline — pour savoir s'il faut une destination. */
export async function compterDealsPipeline(pipelineId: string): Promise<number> {
  const { count, error } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline_id', pipelineId)
    .is('deleted_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Une étape telle qu'éditée dans le modal « Créer / Modifier le pipeline ». */
export interface EtapeEditee {
  /** Absent = nouvelle étape. */
  id?: string;
  nom_fr: string;
  nom_en?: string;
  kind: StageKind;
  /** `null` = répartie uniformément par la base (comme GHL). */
  probability: number | null;
  show_in_reports: boolean;
  show_in_pie: boolean;
}

/**
 * Crée (`pipelineId` null) ou modifie un pipeline et TOUTES ses étapes, dans
 * l'ordre donné. En modification, une étape retirée de la liste est
 * supprimée ; Gagné et Perdu sont verrouillés. La base valide tout : nom
 * unique, au moins une étape, probabilité entre 0 et 100.
 */
export async function enregistrerPipeline(
  pipelineId: string | null,
  champs: { nom: string; color_mode: ModeCouleur; use_deal_probability: boolean; etapes: EtapeEditee[] },
): Promise<string> {
  const { data, error } = await supabase.rpc('pipeline_enregistrer', {
    p_id: pipelineId,
    p_nom: champs.nom.trim(),
    p_color_mode: champs.color_mode,
    p_use_deal_probability: champs.use_deal_probability,
    p_etapes: champs.etapes.map((e) => ({
      id: e.id ?? null,
      nom_fr: e.nom_fr.trim(),
      nom_en: (e.nom_en ?? '').trim() || e.nom_fr.trim(),
      kind: e.kind,
      probability: e.probability,
      show_in_reports: e.show_in_reports,
      show_in_pie: e.show_in_pie,
    })),
  });
  if (error) throw error;
  return data as string;
}

/**
 * Réordonne les pipelines (glisser-déposer, « Déplacer à la position »).
 * `ids` = TOUS les pipelines actifs, dans le nouvel ordre. Le premier devient
 * le pipeline par défaut.
 */
export async function reordonnerPipelines(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('pipeline_reordonner', { p_ids: ids });
  if (error) throw error;
}

/**
 * Supprime (archive) une étape. Si elle contient des deals, ils vont d'abord
 * vers `destId` (une autre étape ouverte du même pipeline), sans automatisation.
 */
export async function supprimerEtape(etapeId: string, destId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('pipeline_supprimer_etape', {
    p_etape: etapeId,
    p_dest: destId ?? null,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** Les autres bureaux que l'utilisateur administre (« sous-comptes » GHL). */
export async function fetchBureauxAdministres(): Promise<{ org_id: string; nom: string }[]> {
  const { data, error } = await supabase.rpc('pipeline_bureaux_administres');
  if (error) throw error;
  return (data ?? []) as { org_id: string; nom: string }[];
}

/** Copie le pipeline (réglages + étapes, sans deals) vers d'autres bureaux. */
export async function copierVersBureaux(pipelineId: string, orgIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('pipeline_copier_vers_bureaux', {
    p_id: pipelineId,
    p_orgs: orgIds,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** Deals ouverts par étape — le camembert. Seules les étapes « camembert » y figurent. */
export interface PartEtape {
  stage_id: string;
  nom_fr: string;
  nom_en: string;
  rang: number;
  deals: number;
}

export async function fetchRepartitionEtapes(pipelineId: string): Promise<PartEtape[]> {
  const { data, error } = await supabase.rpc('pipeline_repartition_etapes', { p_pipeline_id: pipelineId });
  if (error) throw error;
  return ((data ?? []) as PartEtape[]).map((r) => ({ ...r, deals: Number(r.deals) }));
}

// ── Journal des opérations en lot et des imports ────────────
//
// Une action en lot touche des dizaines de deals d'un coup. Sans trace,
// personne ne peut répondre à « qui a supprimé ces 40 deals mardi ? » ni
// annuler une erreur de masse. C'est ce journal qui rend le geste réversible,
// donc utilisable sans peur.

export type OperationLot = 'suppression' | 'modification' | 'import';
export type StatutLot = 'en_cours' | 'termine' | 'partiel' | 'echoue';

export interface LigneJournalLot {
  id: string;
  libelle: string;
  operation: OperationLot;
  statut: StatutLot;
  user_nom: string | null;
  total: number;
  reussis: number;
  echoues: number;
  erreurs: string[];
  restaure_le: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface FiltresJournal {
  /** Bornes de dates, en AAAA-MM-JJ. */
  du?: string;
  au?: string;
  statut?: StatutLot | '';
  operation?: OperationLot | '';
}

export async function fetchJournalLots(f: FiltresJournal = {}): Promise<LigneJournalLot[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  let q = supabase
    .from('pipeline_operations_lot')
    .select('id,libelle,operation,statut,user_nom,total,reussis,echoues,erreurs,restaure_le,created_at,completed_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (f.du) q = q.gte('created_at', `${f.du}T00:00:00Z`);
  // Borne HAUTE inclusive : filtrer « au 25 » doit inclure le 25 entier, pas
  // s'arrêter à minuit — sinon l'opération du jour même disparaît.
  if (f.au) q = q.lt('created_at', `${f.au}T23:59:59.999Z`);
  if (f.statut) q = q.eq('statut', f.statut);
  if (f.operation) q = q.eq('operation', f.operation);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      ...(x as unknown as LigneJournalLot),
      erreurs: Array.isArray(x.erreurs) ? (x.erreurs as string[]) : [],
    };
  });
}

/** Journalise une opération. Ne lève jamais : perdre la trace ne doit pas
 *  faire échouer l'action elle-même, mais l'échec est dit dans la console. */
export async function journaliserLot(entree: {
  libelle: string;
  operation: OperationLot;
  statut: StatutLot;
  total: number;
  reussis: number;
  echoues: number;
  cibles?: string[];
  erreurs?: string[];
}): Promise<void> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data: session } = await supabase.auth.getUser();
    const { error } = await supabase.from('pipeline_operations_lot').insert({
      org_id: orgId,
      libelle: entree.libelle,
      operation: entree.operation,
      statut: entree.statut,
      user_id: session.user?.id ?? null,
      // Le nom au moment de l'action : un membre parti reste nommé.
      user_nom: session.user?.user_metadata?.full_name
        ?? session.user?.email
        ?? null,
      total: entree.total,
      reussis: entree.reussis,
      echoues: entree.echoues,
      cibles: entree.cibles ?? [],
      erreurs: entree.erreurs ?? [],
      completed_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    console.error('[pipeline] journalisation du lot impossible', e);
  }
}

/** Annule une suppression en lot. Rend le nombre de deals réellement rendus. */
export async function restaurerLot(operationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('pipeline_restaurer_lot', {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
