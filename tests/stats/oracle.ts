/**
 * ORACLE de l'audit Statistiques — la valeur JUSTE de chaque chiffre de /insights,
 * calculée en SQL, indépendamment des RPC et du code de la page.
 *
 * Règles communes (voir STATS_AUDIT.md §2) :
 *  - une période [du, au] est en DATES LOCALES du tenant (company_settings.timezone) :
 *    ts >= du 00:00 local  et  ts < (au + 1) 00:00 local ;
 *  - lignes supprimées (deleted_at) exclues partout ;
 *  - l'argent en cents entiers ; aucun arrondi avant la somme.
 */
import type { Client } from 'pg';

export interface Periode { du: string; au: string }

const BORNES = `
  with tz as (select coalesce((select timezone from public.company_settings where org_id = $1), 'America/Toronto') as z),
  b as (select ($2::date)::timestamp at time zone (select z from tz) as debut,
               (($3::date) + 1)::timestamp at time zone (select z from tz) as fin,
               (select z from tz) as z)`;

async function un<T = any>(db: Client, sql: string, params: unknown[]): Promise<T> {
  const r = await db.query(sql, params);
  return r.rows[0] as T;
}
async function plusieurs<T = any>(db: Client, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
const n = (v: unknown) => Number(v ?? 0);

/**
 * ENCAISSÉ (carte « Revenu », Lumi get_revenue_summary, rapports) :
 *   paiements réussis NETS des remboursements (amount − refunded ; un paiement 'refunded' vaut 0),
 *   pourboires exclus (tip_cents vit à part), taxes incluses, à la date de paiement locale
 * + factures payées SANS AUCUNE ligne de paiement (importées de Jobber) : paid_cents à paid_at.
 */
export async function encaisseParMois(db: Client, org: string, p: Periode): Promise<Array<{ mois: string; cents: number }>> {
  return (await plusieurs(db, `${BORNES},
    mois as (select generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month')::date m),
    flux as (
      select (p.payment_date at time zone (select z from b)) as t, (p.amount_cents - coalesce(p.refunded_cents, 0)) as c
        from public.payments p, b
       where p.org_id = $1 and p.deleted_at is null and p.status in ('succeeded', 'refunded')
         and p.payment_date >= b.debut and p.payment_date < b.fin
      union all
      select (coalesce(i.paid_at, i.issued_at) at time zone (select z from b)), i.paid_cents
        from public.invoices i, b
       where i.org_id = $1 and i.deleted_at is null and i.status in ('paid', 'partial') and i.paid_cents > 0
         and not exists (select 1 from public.payments p where p.invoice_id = i.id and p.deleted_at is null)
         and coalesce(i.paid_at, i.issued_at) >= b.debut and coalesce(i.paid_at, i.issued_at) < b.fin)
    select to_char(m.m, 'YYYY-MM') mois, coalesce(sum(f.c), 0)::bigint cents
      from mois m left join flux f on date_trunc('month', f.t)::date = m.m
     group by m.m order by m.m`, [org, p.du, p.au])).map((r) => ({ mois: r.mois, cents: n(r.cents) }));
}

/** Même définition, sans l'import : ce que les PAIEMENTS seuls justifient (sert la répartition par mode). */
export async function encaissePaiementsParMode(db: Client, org: string, p: Periode): Promise<Array<{ mode: string; cents: number }>> {
  return (await plusieurs(db, `${BORNES}
    select coalesce(p.method, '∅') mode, sum(p.amount_cents - coalesce(p.refunded_cents, 0))::bigint cents
      from public.payments p, b
     where p.org_id = $1 and p.deleted_at is null and p.status in ('succeeded', 'refunded')
       and p.payment_date >= b.debut and p.payment_date < b.fin
     group by 1 having sum(p.amount_cents - coalesce(p.refunded_cents, 0)) > 0 order by 2 desc`, [org, p.du, p.au]))
    .map((r) => ({ mode: r.mode, cents: n(r.cents) }));
}

/** FACTURÉ : total TTC des factures émises (envoyée, partielle, payée ; ni brouillon ni annulée), à la date d'émission locale. */
export async function factureParMois(db: Client, org: string, p: Periode): Promise<Array<{ mois: string; cents: number }>> {
  return (await plusieurs(db, `${BORNES},
    mois as (select generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month')::date m)
    select to_char(m.m, 'YYYY-MM') mois, coalesce(sum(i.total_cents), 0)::bigint cents
      from mois m
      left join (select i.*, b.z from public.invoices i, b
                  where i.org_id = $1 and i.deleted_at is null and i.status in ('sent', 'partial', 'paid')
                    and coalesce(i.issued_at, i.created_at) >= b.debut and coalesce(i.issued_at, i.created_at) < b.fin) i
        on date_trunc('month', coalesce(i.issued_at, i.created_at) at time zone i.z)::date = m.m
     group by m.m order by m.m`, [org, p.du, p.au])).map((r) => ({ mois: r.mois, cents: n(r.cents) }));
}

/** « Revenu par service » tel que la page le DÉFINIT (valeur TTC des jobs créés, hors brouillon/annulé, par titre), sans troncature. */
export async function valeurParTitreDeJob(db: Client, org: string, p: Periode): Promise<Array<{ titre: string; cents: number }>> {
  return (await plusieurs(db, `${BORNES}
    select coalesce(nullif(j.title, ''), 'Untitled') titre, sum(j.total_cents)::bigint cents
      from public.jobs j, b
     where j.org_id = $1 and j.deleted_at is null and j.status not in ('draft', 'cancelled')
       and j.created_at >= b.debut and j.created_at < b.fin
     group by 1 order by 2 desc, 1`, [org, p.du, p.au])).map((r) => ({ titre: r.titre, cents: n(r.cents) }));
}

/** Valeur moyenne d'un job COMPLÉTÉ (TTC), par mois local de complétion, et moyenne réelle de la période (somme / nombre). */
export async function valeurMoyenneJob(db: Client, org: string, p: Periode) {
  const mois = await plusieurs(db, `${BORNES},
    mois as (select generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month')::date m)
    select to_char(m.m, 'YYYY-MM') mois, coalesce(round(avg(j.total_cents)), 0)::bigint moy, count(j.id)::int nb
      from mois m
      left join (select j.*, b.z from public.jobs j, b where j.org_id = $1 and j.deleted_at is null and j.status = 'completed'
                   and j.completed_at >= b.debut and j.completed_at < b.fin) j
        on date_trunc('month', j.completed_at at time zone j.z)::date = m.m
     group by m.m order by m.m`, [org, p.du, p.au]);
  const tot = await un(db, `${BORNES}
    select coalesce(sum(j.total_cents), 0)::bigint s, count(*)::int nb from public.jobs j, b
     where j.org_id = $1 and j.deleted_at is null and j.status = 'completed' and j.completed_at >= b.debut and j.completed_at < b.fin`, [org, p.du, p.au]);
  return { mois: mois.map((r) => ({ mois: r.mois, moyenne: n(r.moy), nb: n(r.nb) })), moyenne: tot.nb ? Math.round(n(tot.s) / tot.nb) : 0, nb: n(tot.nb) };
}

/** Équipes : jobs créés dans la période (hors supprimés), complétés, revenu (TTC) des complétés. Équipes actives seulement. */
export async function equipes(db: Client, org: string, p: Periode) {
  return (await plusieurs(db, `${BORNES}
    select t.id, t.name, count(j.id)::int nb, count(j.id) filter (where j.status = 'completed')::int faits,
           coalesce(sum(j.total_cents) filter (where j.status = 'completed'), 0)::bigint revenu
      from public.teams t
      left join (select j.* from public.jobs j, b where j.org_id = $1 and j.deleted_at is null and j.created_at >= b.debut and j.created_at < b.fin) j
        on j.team_id = t.id
     where t.org_id = $1 and t.deleted_at is null and t.is_active
     group by t.id, t.name order by revenu desc, t.name`, [org, p.du, p.au]))
    .map((r) => ({ id: r.id, nom: r.name, nb: n(r.nb), faits: n(r.faits), revenu: n(r.revenu) }));
}

/** Valeur à vie d'un client (définition CLV de la base) : max(jobs non brouillon/annulés TTC, factures payées TTC). Tous les clients. */
export async function valeurClients(db: Client, org: string) {
  return (await plusieurs(db, `
    with cs as (select c.id, concat(c.first_name, ' ', c.last_name) nom, count(j.id) nb, coalesce(sum(j.total_cents), 0) rev
                  from public.clients c
                  left join public.jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null and j.status not in ('draft', 'cancelled')
                 where c.org_id = $1 and c.deleted_at is null group by c.id, c.first_name, c.last_name),
         ir as (select i.client_id, sum(i.total_cents) inv from public.invoices i
                 where i.org_id = $1 and i.deleted_at is null and i.status = 'paid' group by 1)
    select cs.id, cs.nom, cs.nb::int, greatest(cs.rev, coalesce(ir.inv, 0))::bigint revenu
      from cs left join ir on ir.client_id = cs.id where cs.nb > 0 order by revenu desc, cs.nom`, [org]))
    .map((r) => ({ id: r.id, nom: r.nom, nb: n(r.nb), revenu: n(r.revenu) }));
}

/** Part récurrente de la valeur des jobs COMPLÉTÉS dans la période (date de complétion locale, comme la valeur moyenne). */
export async function partRecurrente(db: Client, org: string, p: Periode): Promise<number> {
  const r = await un(db, `${BORNES}
    select coalesce(sum(j.total_cents), 0) tot, coalesce(sum(j.total_cents) filter (where j.job_type = 'recurring'), 0) rec
      from public.jobs j, b where j.org_id = $1 and j.deleted_at is null and j.status = 'completed'
       and j.completed_at >= b.debut and j.completed_at < b.fin`, [org, p.du, p.au]);
  return n(r.tot) > 0 ? Math.round((n(r.rec) / n(r.tot)) * 100) : 0;
}

/** Leads : créés (clients qui ont été des leads) et convertis (leads distincts devenus job dans la période). */
export async function conversionLeads(db: Client, org: string, p: Periode) {
  const r = await un(db, `${BORNES}
    select (select count(*) from public.clients l, b where l.org_id = $1 and l.deleted_at is null
              and l.created_at >= b.debut and l.created_at < b.fin
              and (l.status = 'lead' or l.lead_status is not null
                   or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null)))::int crees,
           (select count(distinct j.lead_id) from public.jobs j, b where j.org_id = $1 and j.deleted_at is null and j.lead_id is not null
              and j.created_at >= b.debut and j.created_at < b.fin)::int convertis`, [org, p.du, p.au]);
  const taux = r.crees > 0 ? Math.min(1, Math.round((r.convertis / r.crees) * 10000) / 10000) : 0;
  return { crees: n(r.crees), convertis: n(r.convertis), taux };
}

/** Soumissions créées dans la période : total, approuvées (approved + converted), valeurs TTC. */
export async function soumissions(db: Client, org: string, p: Periode) {
  const r = await un(db, `${BORNES}
    select count(*)::int nb, coalesce(sum(q.total_cents), 0)::bigint valeur,
           count(*) filter (where q.status in ('approved', 'converted'))::int approuvees,
           coalesce(sum(q.total_cents) filter (where q.status in ('approved', 'converted')), 0)::bigint valeur_approuvee
      from public.quotes q, b where q.org_id = $1 and q.deleted_at is null and q.created_at >= b.debut and q.created_at < b.fin`, [org, p.du, p.au]);
  return { nb: n(r.nb), valeur: n(r.valeur), approuvees: n(r.approuvees), valeurApprouvee: n(r.valeur_approuvee) };
}

/**
 * Pipeline : deals créés dans la période, SANS les deals « source = 'job' » (copies du classement,
 * créées gagnées d'office pour chaque job qui a un vendeur — ce ne sont pas des opportunités).
 * Taux = gagnés / (gagnés + perdus) ; délai = won_at − created_at (pas updated_at).
 */
export async function pipeline(db: Client, org: string, p: Periode) {
  const r = await un(db, `${BORNES}
    select count(*) filter (where d.stage = 'closed_won')::int gagnes, count(*) filter (where d.stage = 'closed_lost')::int perdus,
           avg(extract(epoch from (d.won_at - d.created_at)) / 86400.0) filter (where d.stage = 'closed_won' and d.won_at is not null) delai
      from public.pipeline_deals d, b
     where d.org_id = $1 and d.deleted_at is null and coalesce(d.source, '') <> 'job'
       and d.created_at >= b.debut and d.created_at < b.fin`, [org, p.du, p.au]);
  const clos = n(r.gagnes) + n(r.perdus);
  return { gagnes: n(r.gagnes), perdus: n(r.perdus), tauxPct: clos ? Math.round((n(r.gagnes) / clos) * 1000) / 10 : null, delaiJours: r.delai == null ? null : Number(r.delai) };
}

/** À recevoir (toute l'entreprise, sans borne) et nombre en retard au jour local donné. */
export async function aRecevoir(db: Client, org: string, aujourdhui: string) {
  const r = await un(db, `
    select coalesce(sum(i.balance_cents), 0)::bigint solde, count(*) filter (where i.due_date < $2::date)::int en_retard
      from public.invoices i where i.org_id = $1 and i.deleted_at is null and i.status in ('sent', 'partial') and i.balance_cents > 0`, [org, aujourdhui]);
  return { solde: n(r.solde), enRetard: n(r.en_retard) };
}

/** Délai moyen facture → payée (jours), factures payées dans la période locale. */
export async function delaiPaiement(db: Client, org: string, p: Periode): Promise<number | null> {
  const r = await un(db, `${BORNES}
    select avg(extract(epoch from (i.paid_at - i.issued_at)) / 86400.0) j from public.invoices i, b
     where i.org_id = $1 and i.deleted_at is null and i.paid_at is not null and i.issued_at is not null
       and i.paid_at >= b.debut and i.paid_at < b.fin and i.paid_at >= i.issued_at`, [org, p.du, p.au]);
  return r.j == null ? null : Number(r.j);
}

/** Zones : jobs complétés ayant au moins une visite dans la période locale ; un job compte une fois, pour son total TTC. */
export async function zones(db: Client, org: string, p: Periode) {
  const r = await un(db, `${BORNES}
    select coalesce(sum(j.total_cents), 0)::bigint revenu, count(*)::int nb from public.jobs j
     where j.org_id = $1 and j.deleted_at is null and j.status = 'completed'
       and exists (select 1 from public.schedule_events e, b where e.job_id = j.id and e.org_id = $1 and e.deleted_at is null
                     and e.start_at >= b.debut and e.start_at < b.fin)`, [org, p.du, p.au]);
  return { revenu: n(r.revenu), nb: n(r.nb) };
}
