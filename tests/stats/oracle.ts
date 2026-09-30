/**
 * ORACLE de l'audit Statistiques — la valeur JUSTE de chaque chiffre de /insights, calculée
 * INDÉPENDAMMENT des fonctions testées : les lignes brutes sont lues en SQL (bornes au minuit du
 * fuseau du tenant), les filtres sont appliqués ici, en TypeScript, d'après leur définition écrite :
 *   équipe      jobs.team_id, ou une visite de cette équipe
 *   technicien  il a pointé sur le job, ou une visite lui est assignée, ou est assignée à une de ses équipes
 *   vendeur     salesperson du job/de la facture/de la soumission, rep du deal, assigned_to du lead
 *   client      client_id (ou lead_id)
 *   service     une ligne de job (incluse) porte le nom du service du catalogue (casse et accents ignorés)
 * Argent en cents entiers ; lignes supprimées (deleted_at) exclues partout.
 */
import type { Client } from 'pg';

export interface Periode { du: string; au: string }
export type Filtres = Partial<Record<'equipe' | 'technicien' | 'vendeur' | 'client' | 'service', string>>;

const n = (v: unknown) => Number(v ?? 0);
const TZ = `coalesce((select timezone from public.company_settings where org_id = $1), 'America/Toronto')`;
const DEBUT = `($2::date)::timestamp at time zone ${TZ}`;
const FIN = `(($3::date) + 1)::timestamp at time zone ${TZ}`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const filtreJobActif = (f: Filtres) => !!(f.equipe || f.technicien || f.service);

/* ── Qui passe les filtres « job » ─────────────────────────────────────────── */
interface InfoJob { id: string; team: string | null; client: string | null; vendeur: string | null; equipesVisites: Set<string>; techs: Set<string>; lignes: string[] }

async function infosJobs(db: Client, org: string): Promise<Map<string, InfoJob>> {
  const jobs = await db.query(`select id, team_id, client_id, salesperson_id from public.jobs where org_id = $1 and deleted_at is null`, [org]);
  const m = new Map<string, InfoJob>();
  for (const j of jobs.rows) m.set(j.id, { id: j.id, team: j.team_id, client: j.client_id, vendeur: j.salesperson_id, equipesVisites: new Set(), techs: new Set(), lignes: [] });
  const ev = await db.query(`select job_id, team_id, assigned_user from public.schedule_events where org_id = $1 and deleted_at is null and job_id is not null`, [org]);
  const equipesDe = await db.query(`
    select user_id, team_id from public.team_assignments where org_id = $1
    union select user_id, team_id from public.memberships where org_id = $1 and team_id is not null
    union select user_id, team_id from public.team_members where org_id = $1 and team_id is not null`, [org]);
  const membresEquipe = new Map<string, Set<string>>();
  for (const r of equipesDe.rows) { if (!membresEquipe.has(r.team_id)) membresEquipe.set(r.team_id, new Set()); membresEquipe.get(r.team_id)!.add(r.user_id); }
  for (const e of ev.rows) {
    const j = m.get(e.job_id); if (!j) continue;
    if (e.team_id) { j.equipesVisites.add(e.team_id); for (const u of membresEquipe.get(e.team_id) ?? []) j.techs.add(u); }
    if (e.assigned_user) j.techs.add(e.assigned_user);
  }
  const te = await db.query(`select job_id, employee_id from public.time_entries where org_id = $1 and job_id is not null`, [org]);
  for (const t of te.rows) m.get(t.job_id)?.techs.add(t.employee_id);
  const li = await db.query(`select job_id, name from public.job_line_items where org_id = $1 and deleted_at is null and coalesce(included, true)`, [org]);
  for (const l of li.rows) m.get(l.job_id)?.lignes.push(norm(l.name));
  return m;
}

async function nomService(db: Client, id: string): Promise<string> {
  return norm((await db.query(`select name from public.predefined_services where id = $1`, [id])).rows[0]?.name ?? '');
}

/** Le job passe-t-il les filtres demandés (sous-ensemble de clés) ? */
async function testeur(db: Client, org: string, f: Filtres, cles: Array<keyof Filtres> = ['equipe', 'technicien', 'vendeur', 'client', 'service']) {
  const jobs = await infosJobs(db, org);
  const service = f.service ? await nomService(db, f.service) : '';
  return (jobId: string | null): boolean => {
    const j = jobId ? jobs.get(jobId) : undefined;
    if (!j) return false;
    if (cles.includes('equipe') && f.equipe && j.team !== f.equipe && !j.equipesVisites.has(f.equipe)) return false;
    if (cles.includes('technicien') && f.technicien && !j.techs.has(f.technicien)) return false;
    if (cles.includes('vendeur') && f.vendeur && j.vendeur !== f.vendeur) return false;
    if (cles.includes('client') && f.client && j.client !== f.client) return false;
    if (cles.includes('service') && f.service && !j.lignes.includes(service)) return false;
    return true;
  };
}

/* ── Encaissé ──────────────────────────────────────────────────────────────── */
interface Encaissement { mois: string; cents: number; methode: string | null; client: string | null; source: 'paiement' | 'facture'; id: string }

/**
 * ENCAISSÉ : paiements réussis NETS des remboursements (un 'refunded' vaut 0), pourboires exclus,
 * taxes incluses, à la date de paiement locale ; + factures payées SANS aucune ligne de paiement
 * (import Jobber) : paid_cents à paid_at. Filtres : client/vendeur sur le paiement ou sa facture,
 * filtres « job » sur le job du paiement (ou de sa facture).
 */
export async function encaissements(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<Encaissement[]> {
  const r = await db.query(`
    select to_char(p.payment_date at time zone ${TZ}, 'YYYY-MM') mois, (p.amount_cents - coalesce(p.refunded_cents, 0)) cents, p.method,
           coalesce(p.client_id, i.client_id) client, coalesce(i.salesperson_id, j.salesperson_id) vendeur, j.id job, 'paiement' source, p.id
      from public.payments p left join public.invoices i on i.id = p.invoice_id
      left join public.jobs j on j.id = coalesce(p.job_id, i.job_id) and j.deleted_at is null
     where p.org_id = $1 and p.deleted_at is null and p.status in ('succeeded', 'refunded')
       and p.payment_date >= ${DEBUT} and p.payment_date < ${FIN}
    union all
    select to_char(coalesce(i.paid_at, i.issued_at) at time zone ${TZ}, 'YYYY-MM'), i.paid_cents, null, i.client_id, coalesce(i.salesperson_id, j.salesperson_id), j.id, 'facture', i.id
      from public.invoices i left join public.jobs j on j.id = i.job_id and j.deleted_at is null
     where i.org_id = $1 and i.deleted_at is null and i.status in ('paid', 'partial') and i.paid_cents > 0
       and not exists (select 1 from public.payments p where p.invoice_id = i.id and p.deleted_at is null)
       and coalesce(i.paid_at, i.issued_at) >= ${DEBUT} and coalesce(i.paid_at, i.issued_at) < ${FIN}`, [org, p.du, p.au]);
  const passe = await testeur(db, org, f, ['equipe', 'technicien', 'service']);
  return r.rows
    .filter((x) => (!f.client || x.client === f.client) && (!f.vendeur || x.vendeur === f.vendeur) && (!filtreJobActif(f) || passe(x.job)))
    .map((x) => ({ mois: x.mois, cents: n(x.cents), methode: x.method, client: x.client, source: x.source, id: x.id }));
}

export async function encaisseParMois(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<Array<{ mois: string; cents: number }>> {
  const e = await encaissements(db, org, p, f);
  return moisDe(p).map((mois) => ({ mois, cents: e.filter((x) => x.mois === mois).reduce((s, x) => s + x.cents, 0) }));
}

/** Encaissé par mode (paiements seulement), nets des remboursements. */
export async function encaisseParMode(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<Array<{ mode: string; cents: number }>> {
  const par = new Map<string, number>();
  for (const x of await encaissements(db, org, p, f)) if (x.source === 'paiement') par.set(x.methode ?? 'other', (par.get(x.methode ?? 'other') ?? 0) + x.cents);
  return [...par.entries()].filter(([, c]) => c !== 0).map(([mode, cents]) => ({ mode, cents })).sort((a, b) => b.cents - a.cents || a.mode.localeCompare(b.mode));
}

/** Top clients : encaissé par client sur la période. */
export async function topClients(db: Client, org: string, p: Periode, f: Filtres = {}, limite = 5) {
  const par = new Map<string, number>();
  for (const x of await encaissements(db, org, p, f)) if (x.client) par.set(x.client, (par.get(x.client) ?? 0) + x.cents);
  const noms = await db.query(`select id, coalesce(nullif(btrim(concat_ws(' ', first_name, last_name)), ''), company, '—') nom from public.clients where org_id = $1`, [org]);
  const nom = new Map(noms.rows.map((r) => [r.id, r.nom]));
  return [...par.entries()].filter(([, c]) => c > 0).map(([id, cents]) => ({ id, nom: String(nom.get(id) ?? '—'), cents }))
    .sort((a, b) => b.cents - a.cents || a.nom.localeCompare(b.nom)).slice(0, limite);
}

/** FACTURÉ : total TTC des factures émises (envoyée, partielle, payée), à la date d'émission locale. */
export async function factureParMois(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<Array<{ mois: string; cents: number }>> {
  const r = await db.query(`
    select to_char(coalesce(i.issued_at, i.created_at) at time zone ${TZ}, 'YYYY-MM') mois, i.total_cents, i.client_id, coalesce(i.salesperson_id, j.salesperson_id) vendeur, j.id job
      from public.invoices i left join public.jobs j on j.id = i.job_id and j.deleted_at is null
     where i.org_id = $1 and i.deleted_at is null and i.status in ('sent', 'partial', 'paid')
       and coalesce(i.issued_at, i.created_at) >= ${DEBUT} and coalesce(i.issued_at, i.created_at) < ${FIN}`, [org, p.du, p.au]);
  const passe = await testeur(db, org, f, ['equipe', 'technicien', 'service']);
  const ok = r.rows.filter((x) => (!f.client || x.client_id === f.client) && (!f.vendeur || x.vendeur === f.vendeur) && (!filtreJobActif(f) || passe(x.job)));
  return moisDe(p).map((mois) => ({ mois, cents: ok.filter((x) => x.mois === mois).reduce((s, x) => s + n(x.total_cents), 0) }));
}

/* ── Jobs ──────────────────────────────────────────────────────────────────── */
async function jobsCompletesBruts(db: Client, org: string, p: Periode) {
  return (await db.query(`
    select id, to_char(completed_at at time zone ${TZ}, 'YYYY-MM') mois, total_cents, subtotal_cents, job_type from public.jobs
     where org_id = $1 and deleted_at is null and status = 'completed' and completed_at >= ${DEBUT} and completed_at < ${FIN}`, [org, p.du, p.au])).rows;
}

/** Revenu par service : lignes (incluses) des jobs complétés, avant taxes ; nom du catalogue si la ligne le porte ; job sans ligne → « (sans détail) ». */
export async function revenuParService(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<Array<{ nom: string; cents: number }>> {
  const passe = await testeur(db, org, f, ['equipe', 'technicien', 'vendeur', 'client']);
  const jobs = (await jobsCompletesBruts(db, org, p)).filter((j) => passe(j.id));
  const cat = (await db.query(`select id, name from public.predefined_services where org_id = $1 order by is_active desc, created_at`, [org])).rows;
  const nomCatalogue = new Map<string, { nom: string; id: string }>();
  for (const s of cat) if (!nomCatalogue.has(norm(s.name))) nomCatalogue.set(norm(s.name), { nom: s.name, id: s.id });
  const lignes = (await db.query(`select job_id, name, total_cents from public.job_line_items where org_id = $1 and deleted_at is null and coalesce(included, true)`, [org])).rows;
  const par = new Map<string, number>();
  for (const j of jobs) {
    const ls = lignes.filter((l) => l.job_id === j.id);
    if (ls.length === 0) { if (!f.service) par.set('(sans détail)', (par.get('(sans détail)') ?? 0) + n(j.subtotal_cents)); continue; }
    for (const l of ls) {
      const c = nomCatalogue.get(norm(l.name));
      if (f.service && c?.id !== f.service) continue;
      const nom = c?.nom ?? String(l.name).trim();
      par.set(nom, (par.get(nom) ?? 0) + n(l.total_cents));
    }
  }
  return [...par.entries()].filter(([, c]) => c !== 0).map(([nom, cents]) => ({ nom, cents })).sort((a, b) => b.cents - a.cents || a.nom.localeCompare(b.nom));
}

/** Jobs complétés dans la période : valeur moyenne (TTC, somme / nombre), par mois, part récurrente. */
export async function jobsCompletes(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const passe = await testeur(db, org, f);
  const jobs = (await jobsCompletesBruts(db, org, p)).filter((j) => passe(j.id));
  const tot = jobs.reduce((s, j) => s + n(j.total_cents), 0);
  const rec = jobs.filter((j) => j.job_type === 'recurring').reduce((s, j) => s + n(j.total_cents), 0);
  const mois = [...new Set(jobs.map((j) => String(j.mois)))].sort().map((m) => {
    const js = jobs.filter((j) => j.mois === m);
    return { mois: m, nombre: js.length, totalCents: js.reduce((s, j) => s + n(j.total_cents), 0) };
  });
  return { mois, nombre: jobs.length, moyenneCents: jobs.length ? Math.round(tot / jobs.length) : 0, partRecurrentePct: tot > 0 ? Math.round((rec / tot) * 100) : 0, ids: jobs.map((j) => String(j.id)) };
}

/** Équipes actives : jobs créés dans la période (filtres hors « équipe »), complétés, revenu TTC des complétés. */
export async function equipes(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const passe = await testeur(db, org, f, ['technicien', 'vendeur', 'client', 'service']);
  const teams = (await db.query(`select id, name from public.teams where org_id = $1 and deleted_at is null and is_active order by name`, [org])).rows
    .filter((t) => !f.equipe || t.id === f.equipe);
  const jobs = (await db.query(`select id, team_id, status, total_cents from public.jobs where org_id = $1 and deleted_at is null and created_at >= ${DEBUT} and created_at < ${FIN}`, [org, p.du, p.au])).rows
    .filter((j) => passe(j.id));
  return teams.map((t) => {
    const js = jobs.filter((j) => j.team_id === t.id);
    const faits = js.filter((j) => j.status === 'completed');
    return { id: String(t.id), nom: String(t.name), jobs: js.length, completes: faits.length, revenuCents: faits.reduce((s, j) => s + n(j.total_cents), 0) };
  });
}

/** Valeur vie moyenne (à vie) : max(jobs non brouillon/annulés retenus TTC, factures payées TTC) par client ayant un job retenu. */
export async function valeurVieMoyenne(db: Client, org: string, f: Filtres = {}) {
  const passe = await testeur(db, org, f);
  const jobs = (await db.query(`select id, client_id, total_cents from public.jobs where org_id = $1 and deleted_at is null and status not in ('draft', 'cancelled') and client_id is not null
                                  and client_id in (select id from public.clients where org_id = $1 and deleted_at is null)`, [org])).rows.filter((j) => passe(j.id));
  const factures = filtreJobActif(f) ? [] : (await db.query(`select client_id, total_cents, salesperson_id from public.invoices where org_id = $1 and deleted_at is null and status = 'paid'`, [org])).rows
    .filter((i) => !f.vendeur || i.salesperson_id === f.vendeur);
  const clients = [...new Set(jobs.map((j) => j.client_id))];
  const valeurs = clients.map((c) => Math.max(jobs.filter((j) => j.client_id === c).reduce((s, j) => s + n(j.total_cents), 0), factures.filter((i) => i.client_id === c).reduce((s, i) => s + n(i.total_cents), 0)));
  return { clients: clients.length, moyenneCents: valeurs.length ? Math.round(valeurs.reduce((s, v) => s + v, 0) / valeurs.length) : 0 };
}

/* ── Ventes ────────────────────────────────────────────────────────────────── */
/** Cohorte : leads créés dans la période → ayant une soumission OU un job → devenus un job. */
export async function entonnoir(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const leads = (await db.query(`
    select l.id, l.created_at, l.assigned_to from public.clients l where l.org_id = $1 and l.deleted_at is null and l.created_at >= ${DEBUT} and l.created_at < ${FIN}
       and (l.status = 'lead' or l.lead_status is not null or exists (select 1 from public.jobs j where j.org_id = l.org_id and j.lead_id = l.id and j.deleted_at is null))`, [org, p.du, p.au])).rows
    .filter((l) => (!f.vendeur || l.assigned_to === f.vendeur) && (!f.client || l.id === f.client));
  const quotes = (await db.query(`select lead_id, client_id from public.quotes where org_id = $1 and deleted_at is null`, [org])).rows;
  const jobs = (await db.query(`select lead_id, client_id, created_at from public.jobs where org_id = $1 and deleted_at is null`, [org])).rows;
  let avec = 0; let conv = 0; const delais: number[] = [];
  for (const l of leads) {
    const jl = jobs.filter((j) => j.lead_id === l.id || j.client_id === l.id);
    const soumis = quotes.some((q) => q.lead_id === l.id || q.client_id === l.id);
    if (soumis || jl.length) avec += 1;
    if (jl.length) { conv += 1; delais.push((Math.min(...jl.map((j) => new Date(j.created_at).getTime())) - new Date(l.created_at).getTime()) / 86_400_000); }
  }
  return { crees: leads.length, avecSoumission: avec, convertis: conv, tauxPct: leads.length ? Math.round((conv / leads.length) * 100) : 0,
    joursMoyens: delais.length ? Math.round((delais.reduce((s, d) => s + d, 0) / delais.length) * 10) / 10 : null };
}

/** Soumissions créées dans la période (valeur TTC, approuvées = approved + converted). */
export async function soumissions(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const q = (await db.query(`select id, total_cents, status, coalesce(client_id, lead_id) c, salesperson_id from public.quotes
                               where org_id = $1 and deleted_at is null and created_at >= ${DEBUT} and created_at < ${FIN}`, [org, p.du, p.au])).rows;
  const liees = f.service ? new Set((await db.query(`select quote_id from public.quote_line_items where source_service_id = $1`, [f.service])).rows.map((r) => r.quote_id)) : null;
  const ok = q.filter((x) => (!f.client || x.c === f.client) && (!f.vendeur || x.salesperson_id === f.vendeur) && (!liees || liees.has(x.id)));
  const app = ok.filter((x) => ['approved', 'converted'].includes(x.status));
  return { nombre: ok.length, valeurCents: ok.reduce((s, x) => s + n(x.total_cents), 0), approuvees: app.length, valeurApprouveeCents: app.reduce((s, x) => s + n(x.total_cents), 0) };
}

/** Deals créés dans la période, SANS les copies du classement (source = 'job') ; taux = gagnés / (gagnés + perdus). */
export async function pipeline(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const d = (await db.query(`select stage, rep_id, coalesce(client_id, lead_id) c from public.pipeline_deals where org_id = $1 and deleted_at is null and coalesce(source, '') <> 'job'
                               and created_at >= ${DEBUT} and created_at < ${FIN}`, [org, p.du, p.au])).rows
    .filter((x) => (!f.vendeur || x.rep_id === f.vendeur) && (!f.client || x.c === f.client));
  const g = d.filter((x) => x.stage === 'closed_won').length; const pe = d.filter((x) => x.stage === 'closed_lost').length;
  return { gagnes: g, perdus: pe, tauxPct: g + pe ? Math.round((g / (g + pe)) * 1000) / 10 : null };
}

/* ── Trésorerie ────────────────────────────────────────────────────────────── */
async function facturesFiltrees(db: Client, org: string, f: Filtres) {
  const r = await db.query(`select i.*, coalesce(i.salesperson_id, j.salesperson_id) vendeur, j.id job from public.invoices i left join public.jobs j on j.id = i.job_id and j.deleted_at is null
                             where i.org_id = $1 and i.deleted_at is null`, [org]);
  const passe = await testeur(db, org, f, ['equipe', 'technicien', 'service']);
  return r.rows.filter((x) => (!f.client || x.client_id === f.client) && (!f.vendeur || x.vendeur === f.vendeur) && (!filtreJobActif(f) || passe(x.job)));
}
const jourIso = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
/** À recevoir (à ce jour) et nombre en retard au jour local donné. */
export async function aRecevoir(db: Client, org: string, aujourdhui: string, f: Filtres = {}) {
  const ouvertes = (await facturesFiltrees(db, org, f)).filter((i) => ['sent', 'partial'].includes(i.status) && n(i.balance_cents) > 0);
  return { solde: ouvertes.reduce((s, i) => s + n(i.balance_cents), 0), enRetard: ouvertes.filter((i) => i.due_date && jourIso(i.due_date) < aujourdhui).length };
}
/** Délai moyen émise → payée (jours), factures payées dans la période locale. */
export async function delaiPaiement(db: Client, org: string, p: Periode, f: Filtres = {}): Promise<number | null> {
  const bornes = (await db.query(`select ${DEBUT} d, ${FIN} f`, [org, p.du, p.au])).rows[0];
  const ok = (await facturesFiltrees(db, org, f)).filter((i) => i.paid_at && i.issued_at && i.paid_at >= bornes.d && i.paid_at < bornes.f && i.paid_at >= i.issued_at);
  return ok.length ? ok.reduce((s, i) => s + (i.paid_at.getTime() - i.issued_at.getTime()) / 86_400_000, 0) / ok.length : null;
}

/** Zones : jobs complétés géolocalisés ayant une visite dans la période, comptés une fois, TTC. */
export async function zones(db: Client, org: string, p: Periode, f: Filtres = {}) {
  const passe = await testeur(db, org, f);
  const r = (await db.query(`
    select j.id, j.total_cents from public.jobs j where j.org_id = $1 and j.deleted_at is null and j.status = 'completed'
       and j.latitude is not null and j.longitude is not null and not (j.latitude = 0 and j.longitude = 0)
       and exists (select 1 from public.schedule_events e where e.job_id = j.id and e.org_id = $1 and e.deleted_at is null and e.start_at >= ${DEBUT} and e.start_at < ${FIN})`, [org, p.du, p.au])).rows
    .filter((j) => passe(j.id));
  return { revenu: r.reduce((s, j) => s + n(j.total_cents), 0), nb: r.length, ids: r.map((j) => String(j.id)) };
}

/** Mois « YYYY-MM » couverts par la période. */
export function moisDe(p: Periode): string[] {
  const out: string[] = [];
  let y = Number(p.du.slice(0, 4)); let m = Number(p.du.slice(5, 7));
  const ey = Number(p.au.slice(0, 4)); const em = Number(p.au.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
