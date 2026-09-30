/**
 * Rentabilité — le calculateur (pur : ni réseau, ni base, ni horloge).
 * ─────────────────────────────────────────────────────────────────────────
 * UNE définition pour Lumi, le MCP et l'écran (voir PROFITABILITY_PLAN.md).
 * Le chargeur (charger.ts) lit la base ; ici on ne fait que compter.
 *
 *   revenus      = factures émises non annulées (sous-total − rabais) − part
 *                  avant taxes des remboursements ; sinon prix du job
 *                  (estimation) ; sinon soumission acceptée (estimation)
 *   main-d'œuvre = heures pointées sur le job × taux du membre ; sans aucun
 *                  pointage, durée des visites × technicien assigné
 *                  (estimation). Un taux absent n'est JAMAIS inventé.
 *   commissions  = entrées du job non renversées
 *   dépenses     = champs « montant » du dossier Dépenses + matériaux chiffrés ;
 *                  jobs.expenses_cents seulement si le job n'a aucun champ
 *                  Dépenses rempli (jamais les deux : pas de double compte)
 *   profit       = revenus − coûts ; marge % seulement si revenus > 0
 *
 * Un coût manquant rend la marge « d'au plus X % » : ce qui manque ne peut
 * que la faire baisser.
 */
import { resumer, texteAction } from './resume';

export type GroupePar = 'job' | 'technicien' | 'rep' | 'client' | 'service' | 'mois';
export type Tri = 'revenus_desc' | 'profit_desc' | 'profit_asc' | 'marge_desc' | 'marge_asc';
export type Completude = 'complete' | 'partielle' | 'insuffisante';
export type ModePaie = 'hourly' | 'commission' | 'both';

export interface Filtres {
  jobIds?: string[];
  technicienId?: string;
  repId?: string;
  clientId?: string;
  /** Nom du service (résolu depuis service_id par le chargeur) : les lignes de job n'ont que le nom. */
  serviceNom?: string;
  /** YYYY-MM-DD, fuseau de l'entreprise. null = toute la vie des jobs demandés. */
  du: string | null;
  au: string | null;
  groupePar: GroupePar;
  tri: Tri;
  limite: number;
}

export interface JobBrut {
  id: string;
  numero: string;
  titre: string;
  clientId: string | null;
  clientNom: string | null;
  vendeurId: string | null;
  creeParId: string | null;
  subtotalCents: number;
  depensesJobCents: number;
  /** Jour local de fin (terminé, sinon fin prévue, sinon création) : sert quand le job n'a aucune visite. */
  jourReference: string;
}
export interface VisiteBrute { jobId: string; jour: string; heures: number; assigne: string | null; equipeId: string | null }
export interface FactureBrute { jobId: string; netCents: number; totalCents: number; rembourseCents: number }
export interface SoumissionBrute { jobId: string; netCents: number }
export interface PointageBrut { jobId: string; userId: string | null; nom: string; jour: string; heures: number }
export interface MembreBrut { userId: string; nom: string; tauxCents: number | null; mode: ModePaie; equipeId: string | null }
export interface CommissionBrute { jobId: string; montantCents: number }
export interface DepenseChamp { jobId: string; montantCents: number }
export interface MateriauBrut { jobId: string; nom: string; quantite: number; coutUnitaireCents: number | null }
export interface LigneBrute { jobId: string; nom: string; totalCents: number }

export interface Donnees {
  jobs: JobBrut[];
  visites: VisiteBrute[];
  factures: FactureBrute[];
  soumissions: SoumissionBrute[];
  pointages: PointageBrut[];
  membres: MembreBrut[];
  commissions: CommissionBrute[];
  depensesChamps: DepenseChamp[];
  materiaux: MateriauBrut[];
  lignes: LigneBrute[];
  /** Qui a un plan de commission : règle assignée, ou règle par défaut pour tous. */
  reglesCommission: { parDefaut: boolean; assignes: string[] };
}

export type CodeManquant = 'revenu_inconnu' | 'main_oeuvre_absente' | 'taux_horaire' | 'commission_non_calculee' | 'cout_materiel';
export type CodeInclus = 'factures' | 'prix_job_estime' | 'soumission_estimee' | 'heures_pointees' | 'heures_planifiees'
  | 'commissions' | 'champs_depenses' | 'depenses_job' | 'materiaux';
export type CodeAction = 'facturer' | 'pointer_heures' | 'saisir_taux' | 'verifier_commissions' | 'cout_materiel';

export interface Inclus { code: CodeInclus; nb_jobs: number; heures?: number; montant_cents?: number }
export interface Manquant { code: CodeManquant; nb_jobs: number; heures?: number; noms?: string[] }

export interface Groupe {
  cle: string;
  nom: string;
  nb_jobs: number;
  revenus_cents: number;
  main_oeuvre_cents: number;
  commissions_cents: number;
  depenses_cents: number;
  couts_cents: number;
  profit_cents: number;
  marge_pct: number | null;
  heures: number;
  completude: Completude;
  marge_est_un_maximum: boolean;
  contient_estimations: boolean;
  /** Regroupement par job seulement : l'écran peut encore modifier l'ancien total de dépenses (aucun champ Dépenses rempli). */
  depenses_saisie_libre?: boolean;
  /** Regroupement par job seulement : le numéro et le client, pour l'écran. */
  numero?: string;
  client?: string | null;
}

export interface Resultat {
  periode: { du: string | null; au: string | null };
  groupe_par: GroupePar;
  filtres_noms: { client?: string; technicien?: string; rep?: string; service?: string; job?: string };
  nb_jobs: number;
  completude: Completude;
  marge_est_un_maximum: boolean;
  contient_estimations: boolean;
  totaux: Omit<Groupe, 'cle' | 'nom' | 'nb_jobs' | 'completude' | 'marge_est_un_maximum' | 'contient_estimations'>;
  inclus: Inclus[];
  manquant: Manquant[];
  groupes: Groupe[];
  total_groupes: number;
  action: { code: CodeAction; fr: string; en: string } | null;
  resume_fr: string;
  resume_en: string;
}

/* ── Calcul par job ─────────────────────────────────────────────────────── */

interface PartTech { cle: string; userId: string | null; nom: string; heures: number; coutCents: number | null }
interface ManquantJob { code: CodeManquant; nom?: string; heures?: number }

export interface CalculJob {
  job: JobBrut;
  fraction: number;
  revenuCents: number | null;
  revenuSource: 'factures' | 'job' | 'soumission' | null;
  techs: PartTech[];
  moSource: 'pointages' | 'planifie' | 'aucune';
  commissionsCents: number;
  depensesChampsCents: number;
  depensesJobCents: number;
  materiauxCents: number;
  /** Le job a au moins un champ du dossier Dépenses rempli (l'ancien total est alors ignoré). */
  aChampsDepenses: boolean;
  manquants: ManquantJob[];
  /** Répartition du job par mois (visites de la période), poids qui somment à 1. */
  mois: Array<{ mois: string; poids: number }>;
}

const dans = (jour: string, du: string | null, au: string | null) => (du == null || jour >= du) && (au == null || jour <= au);
const rond = (n: number) => Math.round(n);
const rond1 = (n: number) => Math.round(n * 10) / 10;
const rond2 = (n: number) => Math.round(n * 100) / 100;

function grouperPar<T extends { jobId: string }>(xs: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const l = m.get(x.jobId); if (l) l.push(x); else m.set(x.jobId, [x]); }
  return m;
}

export function calculerJobs(d: Donnees, f: Pick<Filtres, 'du' | 'au'>): CalculJob[] {
  const visites = grouperPar(d.visites);
  const factures = grouperPar(d.factures);
  const soumissions = grouperPar(d.soumissions);
  const pointages = grouperPar(d.pointages);
  const commissions = grouperPar(d.commissions);
  const champs = grouperPar(d.depensesChamps);
  const materiaux = grouperPar(d.materiaux);
  const membres = new Map(d.membres.map((m) => [m.userId, m]));
  const aUnPlan = (userId: string) => d.reglesCommission.parDefaut || d.reglesCommission.assignes.includes(userId);

  const sortie: CalculJob[] = [];
  for (const job of d.jobs) {
    // 1. Part du job qui tombe dans la période
    const vs = (visites.get(job.id) ?? []).slice().sort((a, b) => a.jour.localeCompare(b.jour));
    const vsPeriode = vs.filter((v) => dans(v.jour, f.du, f.au));
    let fraction: number;
    if (vs.length >= 2) fraction = vsPeriode.length / vs.length;
    else if (vs.length === 1) fraction = vsPeriode.length;
    else fraction = dans(job.jourReference, f.du, f.au) ? 1 : 0;
    if (fraction <= 0) continue;
    const multiVisites = vs.length >= 2 && f.du != null;
    const mois = vsPeriode.length
      ? Object.entries(vsPeriode.reduce<Record<string, number>>((acc, v) => { const k = v.jour.slice(0, 7); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}))
        .map(([k, n]) => ({ mois: k, poids: n / vsPeriode.length }))
      : [{ mois: job.jourReference.slice(0, 7), poids: 1 }];

    const manquants: ManquantJob[] = [];

    // 2. Revenus
    const fs = factures.get(job.id) ?? [];
    let revenuCents: number | null = null;
    let revenuSource: CalculJob['revenuSource'] = null;
    if (fs.length) {
      revenuCents = fs.reduce((s, x) => {
        const rembourse = Math.min(Math.max(x.rembourseCents, 0), Math.max(x.totalCents, 0));
        const partHt = x.totalCents > 0 ? rembourse * (x.netCents / x.totalCents) : 0;
        return s + x.netCents - partHt;
      }, 0) * fraction;
      revenuSource = 'factures';
    } else if (job.subtotalCents > 0) {
      revenuCents = job.subtotalCents * fraction;
      revenuSource = 'job';
    } else {
      const q = (soumissions.get(job.id) ?? []).reduce((m, x) => Math.max(m, x.netCents), 0);
      if (q > 0) { revenuCents = q * fraction; revenuSource = 'soumission'; }
    }
    if (revenuCents == null) manquants.push({ code: 'revenu_inconnu' });

    // 3. Main-d'œuvre : pointages d'abord, visites planifiées sinon
    const tousPointages = pointages.get(job.id) ?? [];
    const ps = multiVisites ? tousPointages.filter((p) => dans(p.jour, f.du, f.au)) : tousPointages;
    const techs = new Map<string, PartTech>();
    const ajouter = (userId: string | null, nomBrut: string, heures: number) => {
      if (heures <= 0) return;
      const cle = userId ?? `nom:${nomBrut}`;
      const t = techs.get(cle) ?? { cle, userId, nom: nomBrut, heures: 0, coutCents: 0 };
      t.heures += heures;
      techs.set(cle, t);
    };
    let moSource: CalculJob['moSource'] = 'aucune';
    if (tousPointages.length) {
      moSource = 'pointages';
      for (const p of ps) ajouter(p.userId, (p.userId && membres.get(p.userId)?.nom) || p.nom || '—', p.heures);
    } else {
      const vsCompte = multiVisites ? vsPeriode : vs;
      let sansTech = 0;
      for (const v of vsCompte) {
        const qui = v.assigne ? [v.assigne] : v.equipeId ? d.membres.filter((m) => m.equipeId === v.equipeId).map((m) => m.userId) : [];
        if (!qui.length) { sansTech += 1; continue; }
        for (const u of qui) ajouter(u, membres.get(u)?.nom ?? '—', v.heures);
      }
      if (techs.size) moSource = 'planifie';
      if (!techs.size || sansTech > 0) manquants.push({ code: 'main_oeuvre_absente' });
    }
    for (const t of techs.values()) {
      const m = t.userId ? membres.get(t.userId) : undefined;
      if (m?.mode === 'commission') { t.coutCents = 0; continue; } // payé à la commission : son coût est la commission
      if (m && m.tauxCents != null && m.tauxCents > 0) { t.coutCents = t.heures * m.tauxCents; continue; }
      t.coutCents = null;
      manquants.push({ code: 'taux_horaire', nom: t.nom, heures: t.heures });
    }

    // 4. Commissions
    const cs = commissions.get(job.id) ?? [];
    const commissionsCents = cs.reduce((s, x) => s + x.montantCents, 0) * fraction;
    const rep = job.vendeurId ?? job.creeParId;
    const repMembre = rep ? membres.get(rep) : undefined;
    if (!cs.length && rep && repMembre && repMembre.mode !== 'hourly' && aUnPlan(rep) && revenuSource === 'factures') {
      manquants.push({ code: 'commission_non_calculee', nom: repMembre.nom });
    }

    // 5. Dépenses : champs Dépenses, sinon l'ancien total du job ; matériaux en plus
    const ch = champs.get(job.id) ?? [];
    const depensesChampsCents = ch.reduce((s, x) => s + x.montantCents, 0) * fraction;
    const depensesJobCents = ch.length ? 0 : job.depensesJobCents * fraction;
    let materiauxCents = 0;
    for (const m of materiaux.get(job.id) ?? []) {
      if (m.coutUnitaireCents == null) { manquants.push({ code: 'cout_materiel', nom: m.nom }); continue; }
      materiauxCents += m.quantite * m.coutUnitaireCents * fraction;
    }

    sortie.push({
      job, fraction, revenuCents, revenuSource, techs: [...techs.values()], moSource,
      commissionsCents, depensesChampsCents, depensesJobCents, materiauxCents, aChampsDepenses: ch.length > 0, manquants, mois,
    });
  }
  return sortie;
}

/** Aucun coût connu du tout (ni heures, ni commission, ni dépense) : la marge ne veut rien dire. */
const sansAucunCout = (c: CalculJob) => c.techs.length === 0 && c.commissionsCents === 0
  && c.depensesChampsCents === 0 && c.depensesJobCents === 0 && c.materiauxCents === 0;

export function completudeJob(c: CalculJob): { completude: Completude; maximum: boolean; estime: boolean } {
  const estime = c.revenuSource === 'job' || c.revenuSource === 'soumission' || c.moSource === 'planifie';
  const coutManquant = c.manquants.some((m) => m.code !== 'revenu_inconnu');
  if (c.revenuCents == null || sansAucunCout(c)) return { completude: 'insuffisante', maximum: true, estime };
  if (coutManquant || estime) return { completude: 'partielle', maximum: coutManquant, estime };
  return { completude: 'complete', maximum: false, estime: false };
}

/* ── Contributions : la part d'un job qui revient à un groupe ──────────── */

interface Contribution {
  cle: string;
  nom: string;
  calc: CalculJob;
  revenus: number;
  mo: number;
  commissions: number;
  depenses: number;
  heures: number;
}

const normNom = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

function contributions(c: CalculJob, f: Filtres, lignesParJob: Map<string, LigneBrute[]>, nomMembre: (id: string) => string): Contribution[] {
  const moTotal = c.techs.reduce((s, t) => s + (t.coutCents ?? 0), 0);
  const heuresTotal = c.techs.reduce((s, t) => s + t.heures, 0);
  const depenses = c.depensesChampsCents + c.depensesJobCents + c.materiauxCents;
  const base = (poids: number, cle: string, nom: string): Contribution => ({
    cle, nom, calc: c,
    revenus: (c.revenuCents ?? 0) * poids,
    mo: moTotal * poids,
    commissions: c.commissionsCents * poids,
    depenses: depenses * poids,
    heures: heuresTotal * poids,
  });

  // Filtres qui ne gardent qu'une PART du job : technicien (ses heures), service (sa ligne)
  let parts: Array<{ poids: number; tech?: PartTech }> = [{ poids: 1 }];
  if (f.technicienId) {
    const t = c.techs.find((x) => x.userId === f.technicienId);
    if (!t || heuresTotal <= 0) return [];
    parts = [{ poids: t.heures / heuresTotal, tech: t }];
  }
  if (f.serviceNom) {
    const ls = lignesParJob.get(c.job.id) ?? [];
    const tot = ls.reduce((s, l) => s + Math.max(l.totalCents, 0), 0);
    const cible = normNom(f.serviceNom);
    const poidsService = tot > 0 ? ls.filter((l) => normNom(l.nom) === cible).reduce((s, l) => s + Math.max(l.totalCents, 0), 0) / tot : 0;
    if (poidsService <= 0) return [];
    parts = parts.map((p) => ({ ...p, poids: p.poids * poidsService }));
  }
  const avecPart = (p: { poids: number; tech?: PartTech }, cle: string, nom: string): Contribution => {
    const x = base(p.poids, cle, nom);
    if (p.tech) {
      // La main-d'œuvre d'un technicien, c'est SON coût (pas sa part du total),
      // multiplié seulement par les autres découpages (service, mois).
      const autres = p.poids / (p.tech.heures / heuresTotal);
      x.mo = (p.tech.coutCents ?? 0) * autres;
      x.heures = p.tech.heures * autres;
    }
    return x;
  };

  const sortie: Contribution[] = [];
  for (const p of parts) {
    switch (f.groupePar) {
      case 'job':
        sortie.push(avecPart(p, c.job.id, `#${c.job.numero} · ${c.job.titre}${c.job.clientNom ? ` (${c.job.clientNom})` : ''}`));
        break;
      case 'client':
        sortie.push(avecPart(p, c.job.clientId ?? 'sans_client', c.job.clientNom ?? 'Sans client'));
        break;
      case 'rep':
        sortie.push(avecPart(p, c.job.vendeurId ?? 'sans_vendeur', c.job.vendeurId ? nomMembre(c.job.vendeurId) : 'Sans vendeur'));
        break;
      case 'mois':
        for (const m of c.mois) sortie.push(avecPart({ ...p, poids: p.poids * m.poids }, m.mois, m.mois));
        break;
      case 'service': {
        const ls = lignesParJob.get(c.job.id) ?? [];
        const tot = ls.reduce((s, l) => s + Math.max(l.totalCents, 0), 0);
        if (tot <= 0) { sortie.push(avecPart(p, 'sans_service', 'Sans service')); break; }
        const parNom = new Map<string, { nom: string; cents: number }>();
        for (const l of ls) {
          const k = normNom(l.nom);
          const e = parNom.get(k) ?? { nom: l.nom.trim(), cents: 0 };
          e.cents += Math.max(l.totalCents, 0);
          parNom.set(k, e);
        }
        for (const [k, e] of parNom) {
          if (f.serviceNom && k !== normNom(f.serviceNom)) continue;
          // Avec un filtre service, p.poids porte déjà la part du service.
          sortie.push(avecPart({ ...p, poids: f.serviceNom ? p.poids : p.poids * (e.cents / tot) }, `service:${k}`, e.nom));
        }
        break;
      }
      case 'technicien': {
        if (p.tech) { sortie.push(avecPart(p, p.tech.cle, p.tech.nom)); break; }
        if (heuresTotal <= 0) { sortie.push(avecPart(p, 'non_attribue', 'Non attribué')); break; }
        for (const t of c.techs) sortie.push(avecPart({ poids: p.poids * (t.heures / heuresTotal), tech: t }, t.cle, t.nom));
        break;
      }
    }
  }
  return sortie;
}

/* ── Agrégation ─────────────────────────────────────────────────────────── */

function agreger(cle: string, nom: string, cs: Contribution[]): Groupe {
  const connus = cs.filter((c) => c.calc.revenuCents != null);
  const somme = (k: 'revenus' | 'mo' | 'commissions' | 'depenses' | 'heures') => connus.reduce((s, c) => s + c[k], 0);
  const revenus = rond(somme('revenus'));
  const mo = rond(somme('mo'));
  const commissions = rond(somme('commissions'));
  const depenses = rond(somme('depenses'));
  const couts = mo + commissions + depenses;
  const profit = revenus - couts;
  const jobs = new Set(cs.map((c) => c.calc.job.id));
  const etats = [...new Map(cs.map((c) => [c.calc.job.id, completudeJob(c.calc)])).values()];
  const completude: Completude = etats.every((e) => e.completude === 'insuffisante') ? 'insuffisante'
    : etats.every((e) => e.completude === 'complete') ? 'complete' : 'partielle';
  return {
    cle, nom, nb_jobs: jobs.size,
    revenus_cents: revenus, main_oeuvre_cents: mo, commissions_cents: commissions, depenses_cents: depenses,
    couts_cents: couts, profit_cents: profit,
    marge_pct: revenus > 0 ? rond1((profit / revenus) * 100) : null,
    heures: rond2(somme('heures')),
    completude,
    marge_est_un_maximum: etats.some((e) => e.maximum),
    contient_estimations: etats.some((e) => e.estime),
  };
}

const TRIS: Record<Tri, (a: Groupe, b: Groupe) => number> = {
  revenus_desc: (a, b) => b.revenus_cents - a.revenus_cents,
  profit_desc: (a, b) => b.profit_cents - a.profit_cents,
  profit_asc: (a, b) => a.profit_cents - b.profit_cents,
  marge_desc: (a, b) => (b.marge_pct ?? -Infinity) - (a.marge_pct ?? -Infinity),
  marge_asc: (a, b) => (a.marge_pct ?? Infinity) - (b.marge_pct ?? Infinity),
};

/* ── Point d'entrée ─────────────────────────────────────────────────────── */

export function analyser(d: Donnees, f: Filtres): Resultat {
  const nomsMembres = new Map(d.membres.map((m) => [m.userId, m.nom]));
  const nomMembre = (id: string) => nomsMembres.get(id) ?? 'Membre retiré';

  // Filtres « job entier » (le chargeur les applique déjà ; on les réapplique : le calculateur ne fait confiance à personne)
  const jobsGardes = d.jobs.filter((j) => (!f.jobIds?.length || f.jobIds.includes(j.id))
    && (!f.clientId || j.clientId === f.clientId)
    && (!f.repId || j.vendeurId === f.repId));
  const calculs = calculerJobs({ ...d, jobs: jobsGardes }, f);
  const lignesParJob = grouperPar(d.lignes);
  const contribs = calculs.flatMap((c) => contributions(c, f, lignesParJob, nomMembre));
  const calculsRetenus = [...new Map(contribs.map((c) => [c.calc.job.id, c.calc])).values()];

  // Groupes
  const parCle = new Map<string, { nom: string; cs: Contribution[] }>();
  for (const c of contribs) {
    const g = parCle.get(c.cle) ?? { nom: c.nom, cs: [] };
    g.cs.push(c);
    parCle.set(c.cle, g);
  }
  const groupes = [...parCle.entries()].map(([cle, g]) => {
    const x = agreger(cle, g.nom, g.cs);
    if (f.groupePar === 'job') {
      const j = g.cs[0].calc.job;
      Object.assign(x, { depenses_saisie_libre: !g.cs[0].calc.aChampsDepenses, numero: j.numero, client: j.clientNom });
    }
    return x;
  }).sort(TRIS[f.tri]);
  const t = agreger('total', 'Total', contribs);

  // Ce qui est inclus
  const nb = (p: (c: CalculJob) => boolean) => calculsRetenus.filter(p).length;
  const heuresSelon = (src: CalculJob['moSource']) => rond2(contribs.filter((c) => c.calc.moSource === src).reduce((s, c) => s + c.heures, 0));
  const somme = (k: 'depensesChampsCents' | 'depensesJobCents' | 'materiauxCents' | 'commissionsCents') => rond(calculsRetenus.reduce((s, c) => s + c[k], 0));
  const inclus: Inclus[] = ([
    { code: 'factures', nb_jobs: nb((c) => c.revenuSource === 'factures') },
    { code: 'prix_job_estime', nb_jobs: nb((c) => c.revenuSource === 'job') },
    { code: 'soumission_estimee', nb_jobs: nb((c) => c.revenuSource === 'soumission') },
    { code: 'heures_pointees', nb_jobs: nb((c) => c.moSource === 'pointages' && c.techs.length > 0), heures: heuresSelon('pointages') },
    { code: 'heures_planifiees', nb_jobs: nb((c) => c.moSource === 'planifie'), heures: heuresSelon('planifie') },
    { code: 'commissions', nb_jobs: nb((c) => c.commissionsCents > 0), montant_cents: somme('commissionsCents') },
    { code: 'champs_depenses', nb_jobs: nb((c) => c.depensesChampsCents > 0), montant_cents: somme('depensesChampsCents') },
    { code: 'depenses_job', nb_jobs: nb((c) => c.depensesJobCents > 0), montant_cents: somme('depensesJobCents') },
    { code: 'materiaux', nb_jobs: nb((c) => c.materiauxCents > 0), montant_cents: somme('materiauxCents') },
  ] as Inclus[]).filter((i) => i.nb_jobs > 0);

  // Ce qui manque (regroupé par type ; les noms servent l'action concrète)
  const manquant: Manquant[] = [];
  for (const code of ['revenu_inconnu', 'main_oeuvre_absente', 'taux_horaire', 'commission_non_calculee', 'cout_materiel'] as CodeManquant[]) {
    const touches = calculsRetenus.filter((c) => c.manquants.some((m) => m.code === code));
    if (!touches.length) continue;
    const m: Manquant = { code, nb_jobs: touches.length };
    if (code === 'taux_horaire') {
      const parNom = new Map<string, number>();
      for (const c of touches) for (const x of c.manquants) if (x.code === code && x.nom) parNom.set(x.nom, (parNom.get(x.nom) ?? 0) + (x.heures ?? 0));
      const tries = [...parNom.entries()].sort((a, b) => b[1] - a[1]);
      m.noms = tries.map(([n]) => n);
      m.heures = rond2(tries.reduce((s, [, h]) => s + h, 0));
    } else if (code === 'commission_non_calculee' || code === 'cout_materiel') {
      m.noms = [...new Set(touches.flatMap((c) => c.manquants.filter((x) => x.code === code && x.nom).map((x) => x.nom!)))];
    }
    manquant.push(m);
  }

  // UNE action concrète : celle qui touche le plus de jobs
  const PRIORITE: Record<CodeManquant, number> = { revenu_inconnu: 0, main_oeuvre_absente: 1, taux_horaire: 2, commission_non_calculee: 3, cout_materiel: 4 };
  const ACTION: Record<CodeManquant, CodeAction> = { revenu_inconnu: 'facturer', main_oeuvre_absente: 'pointer_heures', taux_horaire: 'saisir_taux', commission_non_calculee: 'verifier_commissions', cout_materiel: 'cout_materiel' };
  const principal = manquant.slice().sort((a, b) => b.nb_jobs - a.nb_jobs || PRIORITE[a.code] - PRIORITE[b.code])[0];
  const action = principal
    ? { code: ACTION[principal.code], fr: texteAction(principal, 'fr'), en: texteAction(principal, 'en') }
    : null;

  // Noms des filtres, pour la phrase
  const filtres_noms: Resultat['filtres_noms'] = {};
  if (f.clientId) filtres_noms.client = d.jobs.find((j) => j.clientId === f.clientId)?.clientNom ?? undefined;
  if (f.technicienId) filtres_noms.technicien = nomsMembres.get(f.technicienId);
  if (f.repId) filtres_noms.rep = nomsMembres.get(f.repId);
  if (f.serviceNom) filtres_noms.service = f.serviceNom;
  if (f.jobIds?.length === 1) {
    const j = d.jobs.find((x) => x.id === f.jobIds![0]);
    if (j) filtres_noms.job = `#${j.numero} · ${j.titre}${j.clientNom ? ` (${j.clientNom})` : ''}`;
  }

  const { cle: _c, nom: _n, nb_jobs: _nb, completude: _co, marge_est_un_maximum: _m, contient_estimations: _e, ...totaux } = t;
  const aucunJob = calculsRetenus.length === 0;
  const resultat: Omit<Resultat, 'resume_fr' | 'resume_en'> = {
    periode: { du: f.du, au: f.au },
    groupe_par: f.groupePar,
    filtres_noms,
    nb_jobs: calculsRetenus.length,
    completude: aucunJob ? 'insuffisante' : t.completude,
    marge_est_un_maximum: !aucunJob && t.marge_est_un_maximum,
    contient_estimations: !aucunJob && t.contient_estimations,
    totaux,
    inclus,
    manquant,
    groupes: groupes.slice(0, Math.max(1, f.limite)),
    total_groupes: groupes.length,
    action,
  };
  return { ...resultat, resume_fr: resumer(resultat, 'fr', groupes), resume_en: resumer(resultat, 'en', groupes) };
}
