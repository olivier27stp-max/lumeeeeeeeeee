/**
 * Rentabilité — le chargeur : lit la base, rend des lignes normalisées pour
 * calcul.ts. L'org vient TOUJOURS de la session serveur (paramètre orgId,
 * jamais d'un argument de l'utilisateur) et chaque requête est filtrée dessus.
 *
 * Client utilisé : celui de l'utilisateur (RLS : il ne voit que les jobs de
 * sa portée). Seule exception, les commissions : leur RLS ne les montre
 * qu'aux propriétaires/admins, alors que la permission finance
 * (financial.view_margins, vérifiée AVANT d'arriver ici) couvre aussi un
 * gestionnaire. On les lit au service, restreintes à l'org ET aux jobs que
 * l'utilisateur voit déjà — sinon la rentabilité d'un gestionnaire oublierait
 * les commissions sans le dire.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { computeEntryHours } from '../payroll';
import type {
  Donnees, Filtres, JobBrut, VisiteBrute, FactureBrute, SoumissionBrute, PointageBrut,
  MembreBrut, CommissionBrute, DepenseChamp, MateriauBrut, LigneBrute, ModePaie,
} from './calcul';

export const FUSEAU_DEFAUT = 'America/Toronto';
const PAGE = 1000;
const LOT = 150; // taille des listes .in() (URL PostgREST)

/** Jour local YYYY-MM-DD d'un horodatage. */
export function jourDans(iso: string, fuseau: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}
/** Bornes UTC larges d'une période locale (±1 jour) : le tri fin se fait au jour local, dans le calcul. */
function bornesLarges(du: string, au: string): { debut: string; fin: string } {
  const d = new Date(`${du}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  const f = new Date(`${au}T00:00:00Z`); f.setUTCDate(f.getUTCDate() + 2);
  return { debut: d.toISOString(), fin: f.toISOString() };
}

function lots<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += LOT) out.push(xs.slice(i, i + LOT));
  return out;
}

/** Lit toutes les pages d'une requête (PostgREST plafonne à 1000 lignes). Une erreur remonte : pas de rentabilité à moitié lue. */
async function toutLire<T>(requete: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const sortie: T[] = [];
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await requete(de, de + PAGE - 1);
    if (error) throw new Error(`rentabilité : lecture impossible (${error.message ?? error})`);
    sortie.push(...(data ?? []));
    if (!data || data.length < PAGE) return sortie;
  }
}
async function parLots<T>(ids: string[], requete: (lot: string[]) => (de: number, a: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const res = await Promise.all(lots(ids).map((l) => toutLire(requete(l))));
  return res.flat();
}

const cents = (v: unknown) => Math.round(Number(v) || 0);
const nomMembre = (m: { first_name?: string | null; last_name?: string | null; email?: string | null }) =>
  [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email || '—';

export async function chargerDonnees(opts: {
  client: SupabaseClient;
  orgId: string;
  filtres: Filtres;
  fuseau?: string;
}): Promise<Donnees> {
  const { client, orgId, filtres: f } = opts;
  const fuseau = opts.fuseau ?? FUSEAU_DEFAUT;

  // 1. Jobs candidats
  let ids: string[];
  if (f.jobIds?.length) {
    ids = [...new Set(f.jobIds)];
  } else {
    const { debut, fin } = bornesLarges(f.du!, f.au!);
    const [parVisites, termines] = await Promise.all([
      toutLire<{ job_id: string }>((de, a) => client.from('schedule_events').select('job_id')
        .eq('org_id', orgId).is('deleted_at', null).not('job_id', 'is', null)
        .gte('start_at', debut).lt('start_at', fin).order('id').range(de, a)),
      toutLire<{ id: string }>((de, a) => client.from('jobs').select('id')
        .eq('org_id', orgId).is('deleted_at', null).eq('status', 'completed')
        .or(`and(completed_at.gte.${debut},completed_at.lt.${fin}),and(completed_at.is.null,created_at.gte.${debut},created_at.lt.${fin})`)
        .order('id').range(de, a)),
    ]);
    ids = [...new Set([...parVisites.map((x) => x.job_id), ...termines.map((x) => x.id)])];
  }

  const jobsLus = await parLots<any>(ids, (lot) => (de, a) => {
    let q = client.from('jobs')
      .select('id, job_number, title, client_id, client_name, salesperson_id, created_by, status, subtotal_cents, expenses_cents, completed_at, end_at, scheduled_at, created_at')
      .eq('org_id', orgId).is('deleted_at', null).in('id', lot);
    if (!f.jobIds?.length) q = q.in('status', ['scheduled', 'in_progress', 'completed']);
    if (f.clientId) q = q.eq('client_id', f.clientId);
    if (f.repId) q = q.eq('salesperson_id', f.repId);
    return q.order('id').range(de, a);
  });
  const jobs: JobBrut[] = jobsLus.map((j) => ({
    id: j.id,
    numero: String(j.job_number ?? ''),
    titre: String(j.title ?? ''),
    clientId: j.client_id ?? null,
    clientNom: j.client_name ?? null,
    vendeurId: j.salesperson_id ?? null,
    creeParId: j.created_by ?? null,
    subtotalCents: cents(j.subtotal_cents),
    depensesJobCents: cents(j.expenses_cents),
    jourReference: jourDans(j.completed_at ?? j.end_at ?? j.scheduled_at ?? j.created_at, fuseau),
  }));
  const jobIds = jobs.map((j) => j.id);
  const sc = getServiceClient();

  // 2. Tout ce qui se rattache à ces jobs, en parallèle
  const [visitesL, facturesL, soumissionsL, pointagesL, commissionsL, materiauxL, lignesL, membresL, dossiers, reglesL, reglages] = await Promise.all([
    parLots<any>(jobIds, (lot) => (de, a) => client.from('schedule_events')
      .select('job_id, start_at, start_time, end_at, end_time, assigned_user, team_id, status')
      .eq('org_id', orgId).is('deleted_at', null).in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => client.from('invoices')
      .select('id, job_id, subtotal_cents, discount_cents, total_cents')
      .eq('org_id', orgId).is('deleted_at', null).in('status', ['sent', 'partial', 'paid']).in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => client.from('quotes')
      .select('job_id, subtotal_cents, discount_cents')
      .eq('org_id', orgId).is('deleted_at', null).in('status', ['approved', 'converted']).in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => client.from('time_entries')
      .select('job_id, employee_id, employee_name, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks')
      .eq('org_id', orgId).eq('status', 'completed').in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => sc.from('fs_commission_entries')
      .select('job_id, amount')
      .eq('org_id', orgId).is('deleted_at', null).neq('status', 'reversed').in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => client.from('job_materials')
      .select('job_id, name, quantity, unit_cost_cents')
      .eq('org_id', orgId).in('job_id', lot).order('id').range(de, a)),
    parLots<any>(jobIds, (lot) => (de, a) => client.from('job_line_items')
      .select('job_id, name, total_cents, included')
      .eq('org_id', orgId).is('deleted_at', null).in('job_id', lot).order('id').range(de, a)),
    // Client service : les taux ne sont pas lisibles par le jeton de l'utilisateur (grants par
    // colonne) ; financial.view_margins a été vérifiée avant d'arriver ici, et org_id vient de la session.
    toutLire<any>((de, a) => sc.from('team_members')
      .select('user_id, first_name, last_name, email, hourly_rate_cents, labour_cost_hourly, compensation_mode, team_id')
      .eq('org_id', orgId).not('user_id', 'is', null).order('id').range(de, a)),
    toutLire<any>((de, a) => client.from('custom_field_folders')
      .select('id').eq('org_id', orgId).eq('object_type', 'job').eq('cle_systeme', 'depenses').order('id').range(de, a)),
    toutLire<any>((de, a) => sc.from('fs_commission_rules')
      .select('id, assigned_user_ids').eq('org_id', orgId).eq('is_active', true).is('deleted_at', null).order('id').range(de, a)),
    sc.from('commission_settings').select('default_rule_id').eq('org_id', orgId).maybeSingle(),
  ]);

  // Remboursements : sur les paiements des factures retenues
  const factureIds = facturesL.map((x) => x.id);
  const paiementsL = await parLots<any>(factureIds, (lot) => (de, a) => client.from('payments')
    .select('invoice_id, refunded_cents')
    .eq('org_id', orgId).is('deleted_at', null).gt('refunded_cents', 0).in('invoice_id', lot).order('id').range(de, a));
  const rembourse = new Map<string, number>();
  for (const p of paiementsL) rembourse.set(p.invoice_id, (rembourse.get(p.invoice_id) ?? 0) + cents(p.refunded_cents));

  // Champs « montant » du dossier Dépenses (dossier système, clé stable)
  let depensesChamps: DepenseChamp[] = [];
  if (dossiers.length) {
    const champsL = await toutLire<any>((de, a) => client.from('custom_fields')
      .select('id').eq('org_id', orgId).eq('object_type', 'job').eq('field_type', 'monetary')
      .is('archived_at', null).in('folder_id', dossiers.map((x) => x.id)).order('id').range(de, a));
    if (champsL.length) {
      const valeurs = await parLots<any>(jobIds, (lot) => (de, a) => client.from('custom_field_values')
        .select('job_id, value_money_cents')
        .eq('org_id', orgId).in('field_id', champsL.map((c) => c.id)).in('job_id', lot).not('value_money_cents', 'is', null)
        .order('id').range(de, a));
      depensesChamps = valeurs.map((v) => ({ jobId: v.job_id, montantCents: cents(v.value_money_cents) }));
    }
  }

  const visites: VisiteBrute[] = visitesL
    .filter((v) => v.status !== 'cancelled' && (v.start_at ?? v.start_time))
    .map((v) => {
      const debut = v.start_at ?? v.start_time;
      const fin = v.end_at ?? v.end_time;
      const h = fin ? Math.max(0, (Date.parse(fin) - Date.parse(debut)) / 3_600_000) : 0;
      return { jobId: v.job_id, jour: jourDans(debut, fuseau), heures: Number.isFinite(h) ? h : 0, assigne: v.assigned_user ?? null, equipeId: v.team_id ?? null };
    });

  const factures: FactureBrute[] = facturesL.map((x) => ({
    jobId: x.job_id,
    netCents: cents(x.subtotal_cents) - cents(x.discount_cents),
    totalCents: cents(x.total_cents),
    rembourseCents: rembourse.get(x.id) ?? 0,
  }));
  const soumissions: SoumissionBrute[] = soumissionsL.map((x) => ({ jobId: x.job_id, netCents: cents(x.subtotal_cents) - cents(x.discount_cents) }));

  // Heures nettes : même règle que la paie (pauses déduites, deux formats de pause)
  const pointages: PointageBrut[] = pointagesL.map((t) => {
    const debut = t.punch_in_at ?? (t.date && t.punch_in ? `${t.date}T${t.punch_in}Z` : null);
    let fin = t.punch_out_at ?? (t.date && t.punch_out ? `${t.date}T${t.punch_out}Z` : null);
    if (!t.punch_out_at && fin && debut && Date.parse(fin) <= Date.parse(debut)) fin = new Date(Date.parse(fin) + 86_400_000).toISOString();
    const heures = computeEntryHours({ punch_in_at: debut, punch_out_at: fin, breaks: Array.isArray(t.breaks) ? t.breaks : [] });
    return { jobId: t.job_id, userId: t.employee_id ?? null, nom: t.employee_name ?? '—', jour: debut ? jourDans(debut, fuseau) : String(t.date ?? ''), heures };
  });

  const membres: MembreBrut[] = membresL.map((m) => {
    const taux = cents(m.hourly_rate_cents) > 0 ? cents(m.hourly_rate_cents) : m.labour_cost_hourly != null ? cents(Number(m.labour_cost_hourly) * 100) : 0;
    const mode: ModePaie = m.compensation_mode === 'commission' || m.compensation_mode === 'both' ? m.compensation_mode : 'hourly';
    return { userId: m.user_id, nom: nomMembre(m), tauxCents: taux > 0 ? taux : null, mode, equipeId: m.team_id ?? null };
  });

  // Le montant des commissions est en DOLLARS (numeric) en base
  const commissions: CommissionBrute[] = commissionsL.map((c) => ({ jobId: c.job_id, montantCents: cents(Number(c.amount) * 100) }));
  const materiaux: MateriauBrut[] = materiauxL.map((m) => ({
    jobId: m.job_id, nom: String(m.name ?? '—'), quantite: Number(m.quantity) || 0,
    coutUnitaireCents: m.unit_cost_cents == null ? null : cents(m.unit_cost_cents),
  }));
  const lignes: LigneBrute[] = lignesL.filter((l) => l.included !== false).map((l) => ({ jobId: l.job_id, nom: String(l.name ?? ''), totalCents: cents(l.total_cents) }));

  const defaut = (reglages as any)?.data?.default_rule_id ?? null;
  const reglesCommission = {
    parDefaut: Boolean(defaut && reglesL.some((r) => r.id === defaut)),
    assignes: [...new Set(reglesL.flatMap((r) => (Array.isArray(r.assigned_user_ids) ? r.assigned_user_ids : [])))],
  };

  return { jobs, visites, factures, soumissions, pointages, membres, commissions, depensesChamps, materiaux, lignes, reglesCommission };
}
