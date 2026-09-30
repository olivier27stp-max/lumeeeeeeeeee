/**
 * Rentabilité — le service (une seule porte d'entrée pour Lumi, le MCP et
 * l'écran) : permission, normalisation des filtres, cache, calcul.
 *
 * Sécurité (Loi 25 : taux horaires, commissions et rentabilité sont des
 * renseignements sensibles) :
 *  - l'org vient de la session serveur, jamais d'un argument ;
 *  - permission financial.view_margins (page Rôles) exigée ; un technicien est
 *    refusé d'office (rbac bloque déjà toutes ses permissions financières) ;
 *  - la sortie ne contient JAMAIS de taux horaire ;
 *  - sans permission : un refus en mots simples, sans aucun chiffre.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { getUserContext, hasPermission } from '../rbac';
import { analyser, type Filtres, type GroupePar, type Tri, type Resultat } from './calcul';
import { chargerDonnees, FUSEAU_DEFAUT, jourDans } from './charger';

export const GROUPES_PAR: readonly GroupePar[] = ['job', 'technicien', 'rep', 'client', 'service', 'mois'];
export const TRIS: readonly Tri[] = ['revenus_desc', 'profit_desc', 'profit_asc', 'marge_desc', 'marge_asc'];
const LIMITE_MAX = 500;

export interface Demande {
  job_ids?: string[];
  job_numbers?: string[];
  technician_id?: string;
  rep_id?: string;
  client_id?: string;
  service_id?: string;
  date_from?: string;
  date_to?: string;
  group_by?: string;
  sort?: string;
  limit?: number;
}

export type Reponse =
  | { ok: true; resultat: Resultat }
  | { ok: false; refus: { fr: string; en: string } }
  | { ok: false; erreur: string };

export const REFUS_PERMISSION = {
  fr: 'Tu n’as pas accès à la rentabilité dans Lume (permission « Voir marges et profits » de la page Rôles). Vois ton administrateur si ça devrait changer.',
  en: 'You don’t have access to profitability in Lume (the “View margins & profits” permission on the Roles page). Check with your administrator if that should change.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jourValide = (s: string) => JOUR.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/* ── Cache : (org, utilisateur, filtres, empreinte des données) ───────── */
const DUREE_CACHE_MS = 10 * 60_000;
const cache = new Map<string, { resultat: Resultat; expire: number }>();

/**
 * Empreinte bon marché, lue AVANT le calcul : la plus récente modification de
 * chaque table qui entre dans la rentabilité, plus les volumes des tables où
 * une ligne peut disparaître sans laisser de date (matériaux, pointages,
 * valeurs de champs). Même utilisateur + mêmes filtres + même empreinte =
 * même résultat.
 */
async function empreinte(client: SupabaseClient, orgId: string): Promise<string> {
  const sc = getServiceClient();
  const derniere = (c: SupabaseClient, table: string, col = 'updated_at') =>
    c.from(table).select(col).eq('org_id', orgId).order(col, { ascending: false, nullsFirst: false }).limit(1)
      .then(({ data, error }) => (error ? `!${table}` : String((data?.[0] as any)?.[col] ?? '')));
  const volume = (table: string) =>
    client.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId)
      .then(({ count, error }) => (error ? `!${table}` : String(count ?? 0)));
  const morceaux = await Promise.all([
    derniere(client, 'jobs'), derniere(client, 'invoices'), derniere(client, 'payments'), derniere(client, 'quotes'),
    derniere(client, 'time_entries'), derniere(client, 'schedule_events'), derniere(client, 'custom_field_values'),
    derniere(client, 'custom_fields'), derniere(client, 'team_members'), derniere(client, 'job_line_items'),
    derniere(sc, 'fs_commission_entries'), derniere(sc, 'fs_commission_rules'), derniere(sc, 'commission_settings'),
    derniere(client, 'job_materials', 'created_at'),
    volume('job_materials'), volume('time_entries'), volume('custom_field_values'),
  ]);
  return morceaux.join('|');
}

export function viderCacheRentabilite(): void { cache.clear(); }

/* ── Normalisation ─────────────────────────────────────────────────────── */

async function normaliser(
  client: SupabaseClient, orgId: string, d: Demande, fuseau: string, maintenant: Date,
): Promise<{ filtres: Filtres } | { erreur: string }> {
  const ids = (d.job_ids ?? []).map(String).filter(Boolean);
  if (ids.some((x) => !UUID.test(x))) return { erreur: 'job_ids : identifiant de job invalide.' };
  for (const [nom, v] of [['technician_id', d.technician_id], ['rep_id', d.rep_id], ['client_id', d.client_id], ['service_id', d.service_id]] as const) {
    if (v != null && v !== '' && !UUID.test(String(v))) return { erreur: `${nom} : identifiant invalide.` };
  }

  // Numéros de job → ids (org de la session)
  const numeros = (d.job_numbers ?? []).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean);
  if (numeros.length) {
    const { data, error } = await client.from('jobs').select('id, job_number')
      .eq('org_id', orgId).is('deleted_at', null).in('job_number', numeros.slice(0, 200));
    if (error) return { erreur: 'Lecture des jobs impossible.' };
    const trouves = (data ?? []) as Array<{ id: string; job_number: string }>;
    const manquants = numeros.filter((n) => !trouves.some((j) => String(j.job_number) === n));
    if (manquants.length) return { erreur: `Job introuvable : ${manquants.slice(0, 5).join(', ')}.` };
    ids.push(...trouves.map((j) => j.id));
  }

  let serviceNom: string | undefined;
  if (d.service_id) {
    const { data, error } = await client.from('predefined_services').select('name').eq('org_id', orgId).eq('id', d.service_id).maybeSingle();
    if (error || !data) return { erreur: 'Service introuvable.' };
    serviceNom = String((data as any).name);
  }

  // Période : explicite, sinon toute la vie des jobs nommés, sinon depuis le 1er janvier
  for (const [nom, v] of [['date_from', d.date_from], ['date_to', d.date_to]] as const) {
    if (v && !jourValide(v)) return { erreur: `${nom} : date attendue au format AAAA-MM-JJ.` };
  }
  const aujourdhui = jourDans(maintenant.toISOString(), fuseau);
  let du: string | null = d.date_from || null;
  let au: string | null = d.date_to || null;
  if (!ids.length || du || au) {
    au = au ?? aujourdhui;
    du = du ?? `${au.slice(0, 4)}-01-01`;
    if (du > au) return { erreur: 'La date de début est après la date de fin.' };
  }

  const groupePar = (GROUPES_PAR as readonly string[]).includes(String(d.group_by)) ? (d.group_by as GroupePar) : 'job';
  const tri = (TRIS as readonly string[]).includes(String(d.sort)) ? (d.sort as Tri) : 'revenus_desc';
  const limite = Math.min(Math.max(Math.floor(Number(d.limit) || 10), 1), LIMITE_MAX);

  return {
    filtres: {
      ...(ids.length ? { jobIds: [...new Set(ids)] } : {}),
      ...(d.technician_id ? { technicienId: d.technician_id } : {}),
      ...(d.rep_id ? { repId: d.rep_id } : {}),
      ...(d.client_id ? { clientId: d.client_id } : {}),
      ...(serviceNom ? { serviceNom } : {}),
      du, au, groupePar, tri, limite,
    },
  };
}

/**
 * Ce que le MODÈLE reçoit par défaut (phase 4 : payload minimal). Par groupe :
 * le nom, les revenus, le profit, la marge et les drapeaux utiles ; le détail
 * des coûts (main-d'œuvre, commissions, dépenses, heures) seulement si
 * l'utilisateur le demande (detail: true). L'action concrète est déjà dans le
 * résumé. Mesuré : ~1 200 tokens de résultat d'outil de moins par question.
 */
export function pourAgent(r: Resultat): Record<string, unknown> {
  // Déjà écrits dans resume_fr / resume_en : l'action, la période, les filtres, ce qui est inclus.
  const { action: _action, periode: _periode, filtres_noms: _filtres, inclus: _inclus, groupes, ...reste } = r;
  return {
    ...reste,
    groupes: groupes.map((g) => ({
      nom: g.nom,
      revenus_cents: g.revenus_cents,
      profit_cents: g.profit_cents,
      marge_pct: g.marge_pct,
      ...(g.completude !== 'complete' ? { completude: g.completude } : {}),
      ...(g.marge_est_un_maximum ? { marge_est_un_maximum: true } : {}),
    })),
  };
}

/* ── Point d'entrée ─────────────────────────────────────────────────────── */

export async function analyserRentabilite(opts: {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  demande: Demande;
  fuseau?: string;
  maintenant?: Date;
}): Promise<Reponse> {
  const { client, orgId, userId } = opts;
  const fuseau = opts.fuseau ?? FUSEAU_DEFAUT;

  const ctx = await getUserContext(getServiceClient(), userId, orgId);
  if (!ctx || ctx.role === 'technician' || !hasPermission(ctx, 'financial.view_margins')) {
    return { ok: false, refus: REFUS_PERMISSION };
  }

  const n = await normaliser(client, orgId, opts.demande, fuseau, opts.maintenant ?? new Date());
  if ('erreur' in n) return { ok: false, erreur: n.erreur };

  const cle = JSON.stringify([orgId, userId, n.filtres, await empreinte(client, orgId)]);
  const enCache = cache.get(cle);
  if (enCache && enCache.expire > Date.now()) return { ok: true, resultat: enCache.resultat };

  const donnees = await chargerDonnees({ client, orgId, filtres: n.filtres, fuseau });
  const resultat = analyser(donnees, n.filtres);

  if (cache.size > 500) {
    const t = Date.now();
    for (const [k, v] of cache) if (v.expire <= t) cache.delete(k);
    if (cache.size > 500) cache.clear();
  }
  cache.set(cle, { resultat, expire: Date.now() + DUREE_CACHE_MS });
  return { ok: true, resultat };
}
