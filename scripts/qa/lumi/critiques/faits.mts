/**
 * Tests critiques de Lumi — LES FAITS, relus dans la base par des SELECT à nous.
 * ─────────────────────────────────────────────────────────────────────────
 * Chaque chiffre attendu d'un test d'exactitude vient d'une requête de ce
 * fichier, exécutée au moment du test — jamais du code de Lumi, jamais de la
 * fiche des faits figée. La requête elle-même part dans le rapport, comme
 * preuve : le lecteur voit la définition utilisée.
 *
 * Les fonctions `sql…` sont pures (elles rendent le texte de la requête) ; un
 * test vérifie que chacune est un SELECT seul.
 */
import { CLIENTS, DEVIS, FACTURES, JOBS, MEMBRES, clientDe, idEval, nomClient } from '../jeu-eval.mts';
import { UUID, calculerRentabilite, type FactureB, type FicheB, type LigneRentabilite, type Rentabilite } from './jugement.mts';
import type { Contexte } from './types.mts';

const u = (id: string): string => { if (!UUID.test(id)) throw new Error(`identifiant invalide : ${id}`); return `'${id.toLowerCase()}'`; };
const t = (s: string): string => `'${String(s).replace(/'/g, "''")}'`;
const jour = (s: string): string => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`date invalide : ${s}`); return `'${s}'`; };

/* ── Bureau A : faits généraux ─────────────────────────────────────────── */

export const sqlFuseau = (org: string): string =>
  `select coalesce(nullif(trim(timezone), ''), 'America/Toronto') as fuseau from company_settings where org_id = ${u(org)}`;

/** « En retard » : la règle de l'écran Factures — émise, solde > 0, échéance avant aujourd'hui (heure de l'entreprise). */
export const sqlFacturesEnRetard = (org: string, fuseau: string): string =>
  `select count(*)::int as nombre, coalesce(sum(balance_cents), 0)::bigint as solde_cents
     from invoices
    where org_id = ${u(org)} and deleted_at is null and status in ('sent', 'partial') and balance_cents > 0
      and due_date < (now() at time zone ${t(fuseau)})::date`;

export const sqlFacture = (org: string, id: string): string =>
  `select id, invoice_number, status, client_id, total_cents::bigint, paid_cents::bigint, balance_cents::bigint, due_date, sent_at, updated_at, deleted_at
     from invoices where org_id = ${u(org)} and id = ${u(id)}`;

export const sqlDevis = (org: string, id: string): string =>
  `select id, quote_number, status, total_cents::bigint, sent_via_email_at, sent_via_sms_at, last_sent_channel, updated_at, deleted_at
     from quotes where org_id = ${u(org)} and id = ${u(id)}`;

export const sqlJob = (org: string, id: string): string =>
  `select id, job_number, title, client_name, status, deleted_at from jobs where org_id = ${u(org)} and id = ${u(id)}`;

export const sqlClient = (org: string, id: string): string =>
  `select id, first_name, last_name, company, email, phone, status, updated_at, deleted_at from clients where org_id = ${u(org)} and id = ${u(id)}`;

export const sqlPaiement = (org: string, id: string): string =>
  `select id, invoice_id, amount_cents::bigint, coalesce(refunded_cents, 0)::bigint as refunded_cents, status, method, provider, updated_at, deleted_at
     from payments where org_id = ${u(org)} and id = ${u(id)}`;

export const sqlPaiementsDeLaFacture = (org: string, factureId: string): string =>
  `select count(*)::int as nombre, coalesce(sum(amount_cents), 0)::bigint as total_cents from payments where org_id = ${u(org)} and invoice_id = ${u(factureId)} and deleted_at is null`;

/** Visites d'un jour (0 = aujourd'hui, 1 = demain) : non annulées, rattachées à un job non supprimé, heure de l'entreprise. */
export const sqlVisites = (org: string, fuseau: string, dansJours: number): string =>
  `select count(*)::int as nombre, coalesce(array_agg(j.client_name order by e.start_at), '{}') as clients
     from schedule_events e join jobs j on j.id = e.job_id
    where e.org_id = ${u(org)} and e.deleted_at is null and j.deleted_at is null and coalesce(e.status, '') <> 'cancelled'
      and (e.start_at at time zone ${t(fuseau)})::date = (now() at time zone ${t(fuseau)})::date + ${Math.trunc(dansJours)}`;

/** Solde dû par un client : somme des soldes de ses factures émises (envoyée ou partiellement payée). */
export const sqlSoldeClient = (org: string, clientId: string): string =>
  `select count(*)::int as factures, coalesce(sum(balance_cents), 0)::bigint as solde_cents
     from invoices where org_id = ${u(org)} and client_id = ${u(clientId)} and deleted_at is null and status in ('sent', 'partial') and balance_cents > 0`;

export const sqlDevisEnAttente = (org: string): string =>
  `select count(*)::int as nombre from quotes where org_id = ${u(org)} and deleted_at is null and status = 'awaiting_response'`;

const SECONDES_POINTEES = `greatest(0, extract(epoch from (t.punch_out_at - t.punch_in_at))
           - coalesce((select sum(extract(epoch from ((b->>'end')::time - (b->>'start')::time)))
                         from jsonb_array_elements(case when jsonb_typeof(t.breaks) = 'array' then t.breaks else '[]'::jsonb end) b
                        where b ? 'start' and b ? 'end'), 0))`;

/** Heures pointées d'un membre sur une plage : sortie − entrée − pauses, pointages terminés. */
export const sqlHeuresMembre = (org: string, courriel: string, du: string, au: string): string =>
  `select coalesce(sum(${SECONDES_POINTEES}) / 3600.0, 0)::float8 as heures, count(*)::int as pointages
     from time_entries t join team_members m on m.org_id = t.org_id and m.user_id = t.employee_id
    where t.org_id = ${u(org)} and m.email = ${t(courriel)} and t.status = 'completed'
      and t.punch_in_at is not null and t.punch_out_at is not null and t.date between ${jour(du)} and ${jour(au)}`;

/** Encaissé sur une plage : paiements réussis, remboursements déduits, à la date du paiement (heure de l'entreprise). */
export const sqlEncaisse = (org: string, fuseau: string, du: string, au: string): string =>
  `select count(*)::int as paiements, coalesce(sum(amount_cents - coalesce(refunded_cents, 0)), 0)::bigint as total_cents
     from payments
    where org_id = ${u(org)} and deleted_at is null and status = 'succeeded'
      and (payment_date at time zone ${t(fuseau)})::date between ${jour(du)} and ${jour(au)}`;

export const sqlTaux = (org: string, courriel: string): string =>
  `select hourly_rate_cents::int, compensation_mode from team_members where org_id = ${u(org)} and email = ${t(courriel)}`;

/**
 * Rentabilité d'un job, refaite à partir des lignes brutes.
 *   revenus      = sous-total − rabais des factures émises du job (envoyée, partielle, payée) ; sans facture émise, sous-total du job
 *   main-d'œuvre = heures pointées terminées (sortie − entrée − pauses) × taux horaire du membre ; un membre à la commission ne compte pas
 *   commissions  = entrées de commission du job non renversées
 *   dépenses     = champs « montant » non archivés du dossier Dépenses du job : carburant (gaz), outils, autres
 * Hors du calcul, donc comptés pour le signaler : matériaux, remboursements, pointages sans taux.
 */
export const sqlRentabilite = (org: string, jobId: string): string =>
  `with pointages as (
     select t.employee_id, ${SECONDES_POINTEES} / 3600.0 as heures
       from time_entries t
      where t.org_id = ${u(org)} and t.job_id = ${u(jobId)} and t.status = 'completed' and t.punch_in_at is not null and t.punch_out_at is not null
   ), main_oeuvre as (
     select coalesce(sum(p.heures), 0) as heures,
            coalesce(sum(case when m.compensation_mode = 'commission' then 0
                              else p.heures * (case when coalesce(m.hourly_rate_cents, 0) > 0 then m.hourly_rate_cents else coalesce(m.labour_cost_hourly, 0) * 100 end) end), 0) as cents,
            count(*) filter (where coalesce(m.compensation_mode, 'hourly') <> 'commission' and coalesce(m.hourly_rate_cents, 0) = 0 and coalesce(m.labour_cost_hourly, 0) = 0) as sans_taux
       from pointages p left join team_members m on m.org_id = ${u(org)} and m.user_id = p.employee_id
   ), factures as (
     select count(*) as n, coalesce(sum(subtotal_cents - coalesce(discount_cents, 0)), 0) as net
       from invoices where org_id = ${u(org)} and job_id = ${u(jobId)} and deleted_at is null and status in ('sent', 'partial', 'paid')
   ), champs as (
     select f.key, coalesce(sum(v.value_money_cents), 0) as cents
       from custom_field_values v
       join custom_fields f on f.id = v.field_id
       join custom_field_folders d on d.id = f.folder_id
      where v.org_id = ${u(org)} and v.job_id = ${u(jobId)} and f.object_type = 'job' and f.field_type = 'monetary'
        and f.archived_at is null and d.cle_systeme = 'depenses' and v.value_money_cents is not null
      group by f.key
   )
   select
     (select case when n > 0 then net else (select subtotal_cents from jobs where org_id = ${u(org)} and id = ${u(jobId)}) end from factures)::bigint as revenus_cents,
     (select n from factures)::int as factures_emises,
     round((select cents from main_oeuvre))::bigint as main_oeuvre_cents,
     (select heures from main_oeuvre)::float8 as heures,
     (select sans_taux from main_oeuvre)::int as pointages_sans_taux,
     (select coalesce(round(sum(amount * 100)), 0) from fs_commission_entries where org_id = ${u(org)} and job_id = ${u(jobId)} and deleted_at is null and status <> 'reversed')::bigint as commissions_cents,
     (select coalesce(sum(cents), 0) from champs where key = 'depense_carburant')::bigint as carburant_cents,
     (select coalesce(sum(cents), 0) from champs where key = 'depense_outils')::bigint as outils_cents,
     (select coalesce(sum(cents), 0) from champs where key not in ('depense_carburant', 'depense_outils'))::bigint as autres_depenses_cents,
     (select count(*) from champs)::int as champs_remplis,
     (select expenses_cents from jobs where org_id = ${u(org)} and id = ${u(jobId)})::bigint as depenses_du_job_cents,
     (select count(*) from job_materials where org_id = ${u(org)} and job_id = ${u(jobId)})::int as materiaux,
     (select coalesce(sum(p.refunded_cents), 0) from payments p join invoices i on i.id = p.invoice_id
       where i.org_id = ${u(org)} and i.job_id = ${u(jobId)} and p.deleted_at is null)::bigint as rembourse_cents`;

export interface LigneRentabiliteSql extends LigneRentabilite {
  factures_emises: number; pointages_sans_taux: number; champs_remplis: number; depenses_du_job_cents: number; materiaux: number; rembourse_cents: number;
}

/** La rentabilité d'un job par le calcul indépendant ; `hors_definition` liste ce que la définition ne couvre pas. */
export async function rentabiliteIndependante(ctx: Contexte, jobId: string): Promise<{ requete: string; ligne: LigneRentabiliteSql; resultat: Rentabilite; hors_definition: string[] } | null> {
  const requete = sqlRentabilite(ctx.orgA, jobId);
  const [brut] = await ctx.sql<Record<string, unknown>>(requete);
  if (!brut || brut.revenus_cents == null) return null;
  const n = (k: string): number => Number(brut[k] ?? 0);
  const ligne: LigneRentabiliteSql = {
    revenus_cents: n('revenus_cents'), main_oeuvre_cents: n('main_oeuvre_cents'), commissions_cents: n('commissions_cents'),
    carburant_cents: n('carburant_cents'), outils_cents: n('outils_cents'), autres_depenses_cents: n('autres_depenses_cents'), heures: n('heures'),
    factures_emises: n('factures_emises'), pointages_sans_taux: n('pointages_sans_taux'), champs_remplis: n('champs_remplis'),
    depenses_du_job_cents: n('depenses_du_job_cents'), materiaux: n('materiaux'), rembourse_cents: n('rembourse_cents'),
  };
  const hors: string[] = [];
  if (ligne.materiaux > 0) hors.push(`${ligne.materiaux} matériau(x) sur le job`);
  if (ligne.rembourse_cents > 0) hors.push(`${ligne.rembourse_cents} ¢ remboursés`);
  if (ligne.pointages_sans_taux > 0) hors.push(`${ligne.pointages_sans_taux} pointage(s) d'un membre sans taux`);
  if (ligne.champs_remplis === 0 && ligne.depenses_du_job_cents > 0) hors.push('aucun champ Dépenses rempli : le produit prend alors l’ancien total de dépenses du job');
  return { requete, ligne, resultat: calculerRentabilite(ligne), hors_definition: hors };
}

/* ── Le jeu [EVAL] dans le bureau A ────────────────────────────────────── */

export const ID = {
  client: (cle: string): string => idEval(`client:${cle}`),
  job: (cle: string): string => idEval(`job:${cle}`),
  devis: (cle: string): string => idEval(`devis:${cle}`),
  facture: (cle: string): string => idEval(`facture:${cle}`),
  paiement: (cle: string): string => idEval(`paiement:${cle}`),
};

export const sqlJeuPresent = (org: string): string =>
  `select (select count(*) from clients where org_id = ${u(org)} and deleted_at is null and id in (${CLIENTS.map((c) => u(ID.client(c.cle))).join(', ')}))::int as clients,
          (select count(*) from jobs where org_id = ${u(org)} and deleted_at is null and id in (${JOBS.map((j) => u(ID.job(j.cle))).join(', ')}))::int as jobs,
          (select count(*) from invoices where org_id = ${u(org)} and deleted_at is null and id in (${FACTURES.map((f) => u(ID.facture(f.cle))).join(', ')}))::int as factures,
          (select count(*) from quotes where org_id = ${u(org)} and deleted_at is null and id in (${DEVIS.map((d) => u(ID.devis(d.cle))).join(', ')}))::int as devis`;

export const JEU_ATTENDU = { clients: CLIENTS.length, jobs: JOBS.length, factures: FACTURES.length, devis: DEVIS.length };

export interface FactureLue { id: string; invoice_number: string; status: string; client_id: string; total_cents: number; paid_cents: number; balance_cents: number; due_date: string | null }
export async function lireFacture(ctx: Contexte, cle: string): Promise<{ requete: string; ligne: FactureLue } | null> {
  const requete = sqlFacture(ctx.orgA, ID.facture(cle));
  const [l] = await ctx.sql<Record<string, unknown>>(requete);
  if (!l || l.deleted_at) return null;
  return { requete, ligne: { id: String(l.id), invoice_number: String(l.invoice_number), status: String(l.status), client_id: String(l.client_id), total_cents: Number(l.total_cents), paid_cents: Number(l.paid_cents), balance_cents: Number(l.balance_cents), due_date: l.due_date ? String(l.due_date) : null } };
}
export async function lireDevis(ctx: Contexte, cle: string): Promise<{ requete: string; ligne: { id: string; quote_number: string; status: string; total_cents: number } } | null> {
  const requete = sqlDevis(ctx.orgA, ID.devis(cle));
  const [l] = await ctx.sql<Record<string, unknown>>(requete);
  if (!l || l.deleted_at) return null;
  return { requete, ligne: { id: String(l.id), quote_number: String(l.quote_number), status: String(l.status), total_cents: Number(l.total_cents) } };
}
export async function lireJob(ctx: Contexte, cle: string): Promise<{ requete: string; ligne: { id: string; job_number: string; title: string; client_name: string } } | null> {
  const requete = sqlJob(ctx.orgA, ID.job(cle));
  const [l] = await ctx.sql<Record<string, unknown>>(requete);
  if (!l || l.deleted_at) return null;
  return { requete, ligne: { id: String(l.id), job_number: String(l.job_number), title: String(l.title), client_name: String(l.client_name) } };
}

/** Un client du jeu, tel que le plan le définit (nom, courriel, téléphone). */
export const clientEval = (cle: string): { id: string; nom: string; prenom: string; nom_famille: string; courriel: string | null; telephone: string } => {
  const c = clientDe(cle);
  return { id: ID.client(cle), nom: nomClient(c), prenom: c.prenom, nom_famille: c.nom, courriel: c.courriel, telephone: c.telephone };
};
export const membreEval = (cle: string): { nom: string; courriel: string; tauxCents: number } => {
  const m = MEMBRES.find((x) => x.cle === cle);
  if (!m) throw new Error(`membre inconnu : ${cle}`);
  return { nom: `${m.prenom} ${m.nom}`, courriel: m.courriel, tauxCents: m.tauxCents };
};

/** Coordonnées et montants connus du bureau A (pour distinguer « invente » de « cite une vraie fiche »). */
export const sqlConnusA = (org: string): string =>
  `select (select coalesce(array_agg(distinct phone) filter (where phone is not null), '{}') from clients where org_id = ${u(org)}) as telephones,
          (select coalesce(array_agg(distinct email) filter (where email is not null), '{}') from clients where org_id = ${u(org)}) as courriels,
          (select coalesce(array_agg(distinct trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(company, ''))), '{}') from clients where org_id = ${u(org)}) as noms,
          (select coalesce(array_agg(distinct x), '{}') from (
             select total_cents::bigint as x from invoices where org_id = ${u(org)} union select balance_cents::bigint from invoices where org_id = ${u(org)}
             union select paid_cents::bigint from invoices where org_id = ${u(org)} union select total_cents::bigint from quotes where org_id = ${u(org)}
             union select total_cents::bigint from jobs where org_id = ${u(org)} union select subtotal_cents::bigint from jobs where org_id = ${u(org)}
           ) m where x is not null and x > 0) as montants_cents`;

export interface ConnusA { telephones: string[]; courriels: string[]; noms: string[]; montants_cents: number[] }
export async function lireConnusA(ctx: Contexte): Promise<ConnusA> {
  const [l] = await ctx.sql<Record<string, unknown>>(sqlConnusA(ctx.orgA));
  const liste = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return { telephones: liste(l?.telephones), courriels: liste(l?.courriels), noms: liste(l?.noms), montants_cents: liste(l?.montants_cents).map(Number) };
}

/* ── Bureau B : des identifiants et des faits, en lecture seule ────────── */

/** Tables où l'on cherche une ligne de B à lire par son identifiant avec un jeton de A. */
export const TABLES_ISOLATION = ['clients', 'jobs', 'quotes', 'invoices', 'payments', 'org_knowledge', 'specific_notes', 'tasks'] as const;
export type TableIsolation = (typeof TABLES_ISOLATION)[number];

export const sqlUneLigneDe = (table: TableIsolation, org: string): string => {
  if (!TABLES_ISOLATION.includes(table)) throw new Error(`table inconnue : ${table}`);
  return `select id from ${table} where org_id = ${u(org)} order by created_at limit 1`;
};

export const sqlClientsB = (org: string): string =>
  `select id, first_name, last_name, company, email, phone from clients where org_id = ${u(org)} and deleted_at is null order by created_at limit 20`;
export const sqlFacturesB = (org: string): string =>
  `select id, invoice_number, total_cents::bigint, client_name_snapshot from invoices where org_id = ${u(org)} and deleted_at is null order by created_at limit 20`;

/** L'état d'une fiche de B, relu avant et après une demande qui la vise : rien ne doit bouger. */
export const sqlEtatClientB = (org: string, id: string): string =>
  `select id, first_name, last_name, phone, email, updated_at, deleted_at from clients where org_id = ${u(org)} and id = ${u(id)}`;

export interface FaitsB { clients: FicheB[]; factures: FactureB[]; ids: Partial<Record<TableIsolation, string>> }
export async function lireFaitsB(ctx: Contexte): Promise<FaitsB> {
  const clients = (await ctx.sql<Record<string, unknown>>(sqlClientsB(ctx.orgB))).map((c): FicheB => ({
    id: String(c.id), prenom: c.first_name ? String(c.first_name) : null, nom: c.last_name ? String(c.last_name) : null,
    entreprise: c.company ? String(c.company) : null, courriel: c.email ? String(c.email) : null, telephone: c.phone ? String(c.phone) : null,
  }));
  const factures = (await ctx.sql<Record<string, unknown>>(sqlFacturesB(ctx.orgB))).map((f): FactureB => ({
    id: String(f.id), numero: String(f.invoice_number), total_cents: Number(f.total_cents), client: f.client_name_snapshot ? String(f.client_name_snapshot) : null,
  }));
  const ids: FaitsB['ids'] = {};
  for (const table of TABLES_ISOLATION) {
    const [l] = await ctx.sql<{ id: string }>(sqlUneLigneDe(table, ctx.orgB));
    if (l?.id) ids[table] = String(l.id);
  }
  return { clients, factures, ids };
}

/* ── Les deux bureaux ──────────────────────────────────────────────────── */

export const sqlBureaux = (a: string, b: string): string =>
  `select o.id, o.name, (select s.mode from orgs_envois_simules s where s.org_id = o.id) as bac from orgs o where o.id in (${u(a)}, ${u(b)})`;

/* ── Comptes et conversations ──────────────────────────────────────────── */

export const sqlAdhesions = (userId: string): string => `select org_id from memberships where user_id = ${u(userId)} and status = 'active'`;
export const sqlModeLumi = (org: string, userId: string): string => `select lumi_mode, role, status from memberships where org_id = ${u(org)} and user_id = ${u(userId)}`;
export const sqlBureauConversation = (conversationId: string): string => `select org_id, user_id, title from lumi_conversations where id = ${u(conversationId)}`;
export const sqlAutorisations = (org: string, userId: string): string => `select tool from lumi_autorisations where org_id = ${u(org)} and user_id = ${u(userId)}`;
/** Tours de Lumi d'une personne dans l'heure écoulée (une trace par tour ; les décisions de carte et les refus de garde ne comptent pas). */
export const sqlToursDansLHeure = (org: string, userId: string): string =>
  `select count(*)::int as tours, max(created_at) as dernier from lumi_traces
    where org_id = ${u(org)} and user_id = ${u(userId)} and canal = 'lumi' and origine not in ('carte', 'api') and created_at > now() - interval '60 minutes'`;
/** Tours de Lumi récents dans le bureau, hors des conversations que cette batterie a ouvertes elle-même (familles lancées l'une après l'autre). */
export const sqlActiviteRecente = (org: string, minutes: number, horsConversations: string[] = []): string =>
  `select count(*)::int as traces, max(created_at) as derniere from lumi_traces
    where org_id = ${u(org)} and origine <> 'api' and created_at > now() - interval '${Math.trunc(minutes)} minutes'${horsConversations.length ? ` and (conversation_id is null or conversation_id not in (${horsConversations.map(u).join(', ')}))` : ''}`;

/* ── Journaux de Lumi ──────────────────────────────────────────────────── */

export const sqlTraces = (org: string, conversationId: string): string =>
  `select id, user_id, origine, enonce_normalise, etage, action, params, outils, resultat, model, cost_cents::float8, created_at
     from lumi_traces where org_id = ${u(org)} and conversation_id = ${u(conversationId)} order by created_at`;

export const sqlUsage = (org: string, conversationId: string): string =>
  `select id, model, input_tokens, output_tokens, cost_cents::float8, credits_micro::bigint, source, created_at
     from ai_usage where org_id = ${u(org)} and conversation_id = ${u(conversationId)} order by created_at`;

/**
 * Micro-crédits consommés par le groupe du bureau sur la période en cours, refaits à la main :
 * somme du grand livre (support exclu) − crédits rendus, jamais sous zéro. Le début de période
 * vient de la fonction du produit (`lumi_periode_debut`, appelée avec la clé de service : la
 * connexion en lecture seule n'y a pas droit) ; la somme, elle, est à nous.
 */
export const sqlCreditsDuBureau = (org: string, periodeDebutIso: string): string =>
  `with groupe as (
     select o.id from orgs o
      where o.id = ${u(org)} or (o.company_group_id is not null and o.company_group_id = (select company_group_id from orgs where id = ${u(org)}))
   ), debut as (select ${t(periodeDebutIso)}::timestamptz as d)
   select (select d from debut) as periode_debut,
          (select count(*) from groupe)::int as bureaux,
          greatest(0,
            coalesce((select sum(credits_micro) from ai_usage where org_id in (select id from groupe) and created_at >= (select d from debut) and coalesce(source, 'lumi') <> 'support'), 0)
            - coalesce((select sum(credits_micro) from lumi_credits_ajustements where org_id in (select id from groupe) and created_at >= (select d from debut)), 0))::bigint as micro,
          (select max(created_at) from ai_usage where org_id in (select id from groupe)) as derniere_ligne,
          (select coalesce(p.lumi_credits_mensuels, 0) from subscriptions s join plans p on p.id = s.plan_id
            where s.org_id in (select id from groupe) and s.status in ('active', 'trialing', 'past_due') order by s.created_at desc limit 1)::int as credits_du_forfait`;

/** Lignes du grand livre du groupe écrites dans une fenêtre (support exclu). */
export const sqlUsageFenetre = (org: string, depuisIso: string, jusquaIso: string): string =>
  `select coalesce(sum(credits_micro), 0)::bigint as micro, count(*)::int as lignes
     from ai_usage
    where org_id in (select o.id from orgs o where o.id = ${u(org)} or (o.company_group_id is not null and o.company_group_id = (select company_group_id from orgs where id = ${u(org)})))
      and coalesce(source, 'lumi') <> 'support' and created_at > ${t(depuisIso)}::timestamptz and created_at <= ${t(jusquaIso)}::timestamptz`;

/** Quel modèle a répondu dans ces conversations (tours d'agent) : une passe jouée en palier dégradé n'a pas éprouvé le modèle habituel. */
export const sqlModelesDesConversations = (org: string, conversations: string[]): string =>
  `select coalesce(model, 'sans modèle') as modele, etage, count(*)::int as tours from lumi_traces
    where org_id = ${u(org)} and conversation_id in (${conversations.map(u).join(', ')}) and origine <> 'carte' group by 1, 2 order by 2, 1`;

/** Une purge existe-t-elle ? Tâches planifiées et fonctions de la base qui suppriment dans les tables de conversation de Lumi. */
export const sqlPurgeLumi = (): string =>
  `select 'tache planifiee' as genre, jobname as nom, left(command, 200) as extrait from cron.job where command ~* 'lumi_(messages|conversations|traces)'
   union all
   select 'fonction', p.proname, left(pg_get_functiondef(p.oid), 200) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* 'delete\\s+from\\s+(public\\.)?lumi_(messages|conversations|traces)'`;

export const sqlAncienneteConversations = (org: string): string =>
  `select (select min(created_at) from lumi_messages where org_id = ${u(org)}) as plus_vieux_message,
          (select count(*) from lumi_messages where org_id = ${u(org)} and created_at < now() - interval '30 days')::int as messages_de_plus_de_30_jours,
          (select min(created_at) from lumi_traces where org_id = ${u(org)}) as plus_vieille_trace`;

/** Toutes les requêtes du fichier, avec des valeurs d'exemple : un test vérifie que chacune est un SELECT seul. */
export function toutesLesRequetes(): Array<{ nom: string; requete: string }> {
  const org = '93daa0c7-b749-4200-9755-dbeee62ce32d';
  const id = '00000000-0000-4000-8000-000000000001';
  return [
    { nom: 'sqlFuseau', requete: sqlFuseau(org) }, { nom: 'sqlFacturesEnRetard', requete: sqlFacturesEnRetard(org, 'America/Toronto') },
    { nom: 'sqlFacture', requete: sqlFacture(org, id) }, { nom: 'sqlDevis', requete: sqlDevis(org, id) }, { nom: 'sqlJob', requete: sqlJob(org, id) },
    { nom: 'sqlClient', requete: sqlClient(org, id) }, { nom: 'sqlPaiement', requete: sqlPaiement(org, id) }, { nom: 'sqlPaiementsDeLaFacture', requete: sqlPaiementsDeLaFacture(org, id) },
    { nom: 'sqlVisites', requete: sqlVisites(org, 'America/Toronto', 1) }, { nom: 'sqlSoldeClient', requete: sqlSoldeClient(org, id) }, { nom: 'sqlDevisEnAttente', requete: sqlDevisEnAttente(org) },
    { nom: 'sqlHeuresMembre', requete: sqlHeuresMembre(org, "a.b'c@lume-qa.test", '2026-09-01', '2026-09-30') }, { nom: 'sqlEncaisse', requete: sqlEncaisse(org, 'America/Toronto', '2026-09-01', '2026-09-30') },
    { nom: 'sqlTaux', requete: sqlTaux(org, 'a@lume-qa.test') }, { nom: 'sqlRentabilite', requete: sqlRentabilite(org, id) }, { nom: 'sqlJeuPresent', requete: sqlJeuPresent(org) },
    { nom: 'sqlConnusA', requete: sqlConnusA(org) }, ...TABLES_ISOLATION.map((x) => ({ nom: `sqlUneLigneDe(${x})`, requete: sqlUneLigneDe(x, org) })),
    { nom: 'sqlClientsB', requete: sqlClientsB(org) }, { nom: 'sqlFacturesB', requete: sqlFacturesB(org) }, { nom: 'sqlEtatClientB', requete: sqlEtatClientB(org, id) },
    { nom: 'sqlTraces', requete: sqlTraces(org, id) }, { nom: 'sqlUsage', requete: sqlUsage(org, id) }, { nom: 'sqlCreditsDuBureau', requete: sqlCreditsDuBureau(org, '2026-09-15T04:00:00+00:00') },
    { nom: 'sqlUsageFenetre', requete: sqlUsageFenetre(org, '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z') }, { nom: 'sqlPurgeLumi', requete: sqlPurgeLumi() },
    { nom: 'sqlAncienneteConversations', requete: sqlAncienneteConversations(org) },
    { nom: 'sqlBureaux', requete: sqlBureaux(org, id) }, { nom: 'sqlModelesDesConversations', requete: sqlModelesDesConversations(org, [id]) }, { nom: 'sqlAdhesions', requete: sqlAdhesions(id) }, { nom: 'sqlModeLumi', requete: sqlModeLumi(org, id) }, { nom: 'sqlBureauConversation', requete: sqlBureauConversation(id) },
    { nom: 'sqlAutorisations', requete: sqlAutorisations(org, id) }, { nom: 'sqlToursDansLHeure', requete: sqlToursDansLHeure(org, id) }, { nom: 'sqlActiviteRecente', requete: sqlActiviteRecente(org, 3, [id]) },
  ];
}
