/**
 * Données de la page Statistiques (/insights). Une fonction par carte, toutes avec la même
 * période (dates locales) et les mêmes filtres (p_filtres) ; les calculs vivent en base
 * (rpc_insights_*, migrations 20261004300000 et 20261004300200) : aucune somme côté navigateur,
 * donc ni troncature à 1 000 lignes ni coût qui grandit avec le volume.
 * detail() rend les lignes EXACTES derrière un chiffre (leur somme = le chiffre affiché).
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { pourRpc, type Filtres } from './statsFiltres';
import type { InsightsRange } from './insightsPeriod';

export type Plage = Pick<InsightsRange, 'from' | 'to' | 'granularity'>;

async function rpc<T = any>(nom: string, args: Record<string, unknown>): Promise<T[]> {
  const p_org = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc(nom, { p_org, ...args });
  if (error) throw error;
  return (Array.isArray(data) ? data : data == null ? [] : [data]) as T[];
}
const n = (v: unknown) => Number(v) || 0;
const periode = (p: Plage, filtres: Filtres) => ({ p_from: p.from, p_to: p.to, p_filtres: pourRpc(filtres) });

/* ── Revenu (encaissé) ────────────────────────────────────────────────────── */
export interface PointRevenu { debut: string; encaisseCents: number; factureCents: number }
export async function serieRevenus(p: Plage, filtres: Filtres): Promise<PointRevenu[]> {
  const lignes = await rpc('rpc_insights_revenue_series', { ...periode(p, filtres), p_granularity: p.granularity });
  return lignes.map((r: any) => ({ debut: String(r.bucket_start), encaisseCents: n(r.revenue_cents), factureCents: n(r.invoiced_cents) }));
}

/* ── Répartitions ─────────────────────────────────────────────────────────── */
export interface Part { cle: string; valeur: number }
/** 3 premières parts + « other » pour le reste (ex æquo : ordre alphabétique). */
export function top3EtAutres(parts: Part[], max = 4): Part[] {
  const triees = parts.filter((x) => x.valeur !== 0).sort((a, b) => b.valeur - a.valeur || a.cle.localeCompare(b.cle));
  if (triees.length <= max) return triees;
  const tete = triees.slice(0, max - 1);
  return [...tete, { cle: 'other', valeur: triees.slice(max - 1).reduce((s, x) => s + x.valeur, 0) }];
}
/** Revenu par service : lignes des jobs complétés, AVANT taxes (toutes les parts, non regroupées). */
export async function revenuParService(p: Plage, filtres: Filtres): Promise<Part[]> {
  return (await rpc('rpc_insights_service_mix', periode(p, filtres))).map((r: any) => ({ cle: String(r.title), valeur: n(r.cents) }));
}
/** Encaissé par mode de paiement (paiements seulement : une facture importée n'a pas de mode). */
export async function modesPaiement(p: Plage, filtres: Filtres): Promise<Part[]> {
  return (await rpc('rpc_insights_payment_mix', periode(p, filtres))).map((r: any) => ({ cle: String(r.method), valeur: n(r.cents) }));
}

/* ── Jobs complétés : valeur moyenne et part récurrente ───────────────────── */
export interface JobsCompletes { mois: Array<{ mois: string; nombre: number; totalCents: number }>; nombre: number; moyenneCents: number; partRecurrentePct: number }
export async function jobsCompletes(p: Plage, filtres: Filtres): Promise<JobsCompletes> {
  const lignes = await rpc('rpc_insights_completed_jobs_monthly', periode(p, filtres));
  let nombre = 0; let total = 0; let rec = 0;
  const mois = lignes.map((r: any) => {
    nombre += n(r.nombre); total += n(r.total_cents); rec += n(r.recurrent_cents);
    return { mois: String(r.mois), nombre: n(r.nombre), totalCents: n(r.total_cents) };
  });
  return { mois, nombre, moyenneCents: nombre ? Math.round(total / nombre) : 0, partRecurrentePct: total > 0 ? Math.round((rec / total) * 100) : 0 };
}

/* ── Équipes ──────────────────────────────────────────────────────────────── */
export interface Equipe { id: string; nom: string; jobs: number; completes: number; tauxPct: number; revenuCents: number; moyenneCents: number }
export async function equipes(p: Plage, filtres: Filtres): Promise<Equipe[]> {
  return (await rpc('rpc_insights_team_performance', periode(p, filtres))).map((r: any) => ({
    id: String(r.team_id), nom: String(r.team_name || '—'), jobs: n(r.jobs_count), completes: n(r.jobs_completed),
    tauxPct: n(r.completion_rate), revenuCents: n(r.revenue_cents), moyenneCents: n(r.avg_job_value_cents),
  }));
}

/* ── Clients ──────────────────────────────────────────────────────────────── */
export interface TopClient { id: string; nom: string; cents: number; paiements: number }
/** Les clients qui ont le plus PAYÉ sur la période (même définition que la courbe Revenu). */
export async function topClients(p: Plage, filtres: Filtres, limite = 5): Promise<TopClient[]> {
  return (await rpc('rpc_insights_top_clients', { ...periode(p, filtres), p_limit: limite })).map((r: any) => ({
    id: String(r.client_id), nom: String(r.client_name || '—'), cents: n(r.cents), paiements: n(r.paiements),
  }));
}
/** Valeur vie moyenne (à vie) sur tous les clients qui ont eu un job retenu par les filtres. */
export async function valeurVieMoyenne(filtres: Filtres): Promise<{ clients: number; moyenneCents: number }> {
  const [r] = await rpc('rpc_insights_valeur_vie_moyenne', { p_filtres: pourRpc(filtres) });
  return { clients: n(r?.clients), moyenneCents: n(r?.moyenne_cents) };
}
/** Rétention moyenne des cohortes des 12 derniers mois (mois 1 à 11) — indépendante de la période et des filtres. */
export async function retentionPct(): Promise<number> {
  const lignes = await rpc('rpc_insights_cohort_retention', {});
  const rets = lignes.filter((c: any) => n(c.months_after) >= 1).map((c: any) => n(c.retention_pct));
  return rets.length ? Math.round(rets.reduce((s, r) => s + r, 0) / rets.length) : 0;
}

/* ── Ventes ───────────────────────────────────────────────────────────────── */
export interface Entonnoir { crees: number; avecSoumission: number; convertis: number; tauxPct: number; joursMoyens: number | null }
/** Cohorte : les leads créés dans la période → ceux qui ont eu une soumission → ceux devenus un job. */
export async function entonnoir(p: Plage, filtres: Filtres): Promise<Entonnoir> {
  const [r] = await rpc('rpc_insights_entonnoir', periode(p, filtres));
  const crees = n(r?.crees); const convertis = n(r?.convertis);
  return { crees, avecSoumission: n(r?.avec_soumission), convertis, tauxPct: crees ? Math.round((convertis / crees) * 100) : 0, joursMoyens: r?.jours_moyens == null ? null : Number(r.jours_moyens) };
}
export interface Pipeline { gagnes: number; perdus: number; tauxPct: number | null }
/** Deals du pipeline créés dans la période (sans les copies du classement). */
export async function pipeline(p: Plage, filtres: Filtres): Promise<Pipeline> {
  const [r] = await rpc('rpc_insights_pipeline_velocity', periode(p, filtres));
  const gagnes = n(r?.won_deals); const perdus = n(r?.lost_deals);
  return { gagnes, perdus, tauxPct: gagnes + perdus > 0 ? n(r?.win_rate) : null };
}
export interface Soumissions { nombre: number; valeurCents: number; approuvees: number; valeurApprouveeCents: number; valeurEnAttenteCents: number }
export async function soumissions(p: Plage, filtres: Filtres): Promise<Soumissions> {
  const [r] = await rpc('rpc_insights_soumissions', periode(p, filtres));
  return { nombre: n(r?.nombre), valeurCents: n(r?.valeur_cents), approuvees: n(r?.approuvees), valeurApprouveeCents: n(r?.valeur_approuvee_cents), valeurEnAttenteCents: n(r?.valeur_en_attente_cents) };
}

/* ── Trésorerie ───────────────────────────────────────────────────────────── */
export interface Tresorerie { aRecevoirCents: number; enRetard: number; delaiJours: number | null }
/** À recevoir et retards : À CE JOUR (pas une mesure de période) ; délai : factures payées dans la période. */
export async function tresorerie(p: Plage, filtres: Filtres): Promise<Tresorerie> {
  const [r] = await rpc('rpc_insights_invoices_summary', periode(p, filtres));
  return { aRecevoirCents: n(r?.total_outstanding_cents), enRetard: n(r?.count_past_due), delaiJours: r?.avg_payment_time_days == null ? null : Number(r.avg_payment_time_days) };
}

/* ── Zones ────────────────────────────────────────────────────────────────── */
export interface ZoneAdresse { adresse: string | null; jobs: number; revenuCents: number; latSomme: number; lngSomme: number; jobIds: string[] }
export async function zones(p: Plage, filtres: Filtres): Promise<ZoneAdresse[]> {
  return (await rpc('rpc_insights_zones', periode(p, filtres))).map((r: any) => ({
    adresse: r.adresse ?? null, jobs: n(r.jobs), revenuCents: n(r.revenu_cents), latSomme: n(r.lat_somme), lngSomme: n(r.lng_somme),
    jobIds: Array.isArray(r.job_ids) ? r.job_ids.map(String) : [],
  }));
}

/* ── Détail d'un chiffre ──────────────────────────────────────────────────── */
export type CarteDetail =
  | 'revenu' | 'mode' | 'client' | 'service' | 'valeur_moyenne' | 'equipe' | 'a_recevoir' | 'en_retard' | 'delai'
  | 'jobs' | 'soumissions' | 'soumissions_approuvees' | 'leads' | 'leads_soumission' | 'leads_convertis' | 'deals_gagnes' | 'deals_perdus';
export interface LigneDetail { type: 'paiement' | 'facture' | 'job' | 'soumission' | 'client' | 'deal'; id: string; libelle: string; sousLibelle: string; quand: string | null; cents: number }
export async function detail(p: Plage, filtres: Filtres, carte: CarteDetail, cle?: string | null): Promise<LigneDetail[]> {
  return (await rpc('rpc_insights_detail', { ...periode(p, filtres), p_carte: carte, p_cle: cle ?? null })).map((r: any) => ({
    type: r.type, id: String(r.id), libelle: String(r.libelle ?? '—'), sousLibelle: String(r.sous_libelle ?? ''), quand: r.quand ?? null, cents: n(r.cents),
  }));
}
/** Lien vers la fiche d'une ligne de détail (un paiement mène à la liste des paiements). */
export function lienDetail(l: Pick<LigneDetail, 'type' | 'id'>): string {
  switch (l.type) {
    case 'job': return `/jobs/${l.id}`;
    case 'facture': return `/invoices/${l.id}`;
    case 'soumission': return `/quotes/${l.id}`;
    case 'client': return `/clients/${l.id}`;
    case 'deal': return `/ventes?deal=${l.id}`;
    default: return '/finances?tab=paiements';
  }
}
