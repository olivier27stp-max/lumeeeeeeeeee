/**
 * Tenant de test DÉTERMINISTE pour l'audit des commissions (2026-09-30).
 *
 * Tout est décrit ici comme une LIGNE DU TEMPS d'événements métier (job créé,
 * facture payée, remboursement, changement de taux…) rejouée dans l'ordre à
 * travers les VRAIES fonctions du moteur (`commission-engine.ts`). Les montants
 * attendus ne sont PAS calculés ici : l'oracle (`oracle.sql`) les recalcule
 * indépendamment, en SQL, à partir des factures et de `oracle_regles`.
 *
 * Ne s'exécute QUE contre une base locale (garde dans `seed.ts`).
 */

// ── Identifiants fixes (préfixe cc…) ────────────────────────────────────────
const hex = (n: number) => n.toString(16).padStart(12, '0');
export const id = (n: number) => `cc000000-0000-4000-8000-${hex(n)}`;

export const ORG = { A: id(0xa1), B: id(0xa2), C: id(0xa3), V: id(0xa4) } as const;
export const TZ = 'America/Toronto';
export const MOT_DE_PASSE = 'Fixture1234!';

export type Mode = 'hourly' | 'commission' | 'both';
export type Role = 'owner' | 'admin' | 'sales_rep' | 'technician';
export interface Membre { id: string; org: string; courriel: string; prenom: string; nom: string; role: Role; mode: Mode; taux_horaire_cents?: number }

export const U = {
  olivia: id(0x101), adam: id(0x102), rita: id(0x103), fred: id(0x104), tina: id(0x105),
  sam: id(0x106), sara: id(0x107), dora: id(0x108), hugo: id(0x109), nora: id(0x10a), theo: id(0x10b),
  bob: id(0x201), bea: id(0x202),
  carl: id(0x301),
  vic: id(0x401),
} as const;

export const MEMBRES: Membre[] = [
  { id: U.olivia, org: ORG.A, courriel: 'olivia@fixture-a.test', prenom: 'Olivia', nom: 'Proprio', role: 'owner', mode: 'hourly' },
  { id: U.adam, org: ORG.A, courriel: 'adam@fixture-a.test', prenom: 'Adam', nom: 'Admin', role: 'admin', mode: 'hourly', taux_horaire_cents: 3000 },
  { id: U.rita, org: ORG.A, courriel: 'rita@fixture-a.test', prenom: 'Rita', nom: 'Pourcent', role: 'sales_rep', mode: 'commission' },
  { id: U.fred, org: ORG.A, courriel: 'fred@fixture-a.test', prenom: 'Fred', nom: 'Forfait', role: 'sales_rep', mode: 'commission' },
  { id: U.tina, org: ORG.A, courriel: 'tina@fixture-a.test', prenom: 'Tina', nom: 'Palier', role: 'sales_rep', mode: 'commission' },
  { id: U.sam, org: ORG.A, courriel: 'sam@fixture-a.test', prenom: 'Sam', nom: 'Duo', role: 'sales_rep', mode: 'commission' },
  { id: U.sara, org: ORG.A, courriel: 'sara@fixture-a.test', prenom: 'Sara', nom: 'Duo', role: 'sales_rep', mode: 'commission' },
  { id: U.dora, org: ORG.A, courriel: 'dora@fixture-a.test', prenom: 'Dora', nom: 'Partie', role: 'sales_rep', mode: 'commission' },
  { id: U.hugo, org: ORG.A, courriel: 'hugo@fixture-a.test', prenom: 'Hugo', nom: 'Horaire', role: 'sales_rep', mode: 'hourly', taux_horaire_cents: 2500 },
  { id: U.nora, org: ORG.A, courriel: 'nora@fixture-a.test', prenom: 'Nora', nom: 'SansPlan', role: 'sales_rep', mode: 'commission' },
  { id: U.theo, org: ORG.A, courriel: 'theo@fixture-a.test', prenom: 'Théo', nom: 'Technicien', role: 'technician', mode: 'hourly', taux_horaire_cents: 2800 },
  { id: U.bob, org: ORG.B, courriel: 'bob@fixture-b.test', prenom: 'Bob', nom: 'AutreTenant', role: 'owner', mode: 'hourly' },
  { id: U.bea, org: ORG.B, courriel: 'bea@fixture-b.test', prenom: 'Béa', nom: 'AutreTenant', role: 'sales_rep', mode: 'commission' },
  { id: U.carl, org: ORG.C, courriel: 'carl@fixture-c.test', prenom: 'Carl', nom: 'Vide', role: 'owner', mode: 'hourly' },
  { id: U.vic, org: ORG.V, courriel: 'vic@fixture-v.test', prenom: 'Vic', nom: 'Volume', role: 'owner', mode: 'hourly' },
];

// ── Règles ──────────────────────────────────────────────────────────────────
export const R = {
  pct: id(0x501), forfait: id(0x502), palier: id(0x503), duo: id(0x504), dora: id(0x505), bea: id(0x5b1), vol: id(0x5d1),
} as const;

export const REGLES = [
  { id: R.pct, org: ORG.A, name: 'Plan 10 %', base_kind: 'percent', base_percent: 10, assigned_user_ids: [U.rita] },
  { id: R.forfait, org: ORG.A, name: 'Forfait 150 $', base_kind: 'flat', base_value_cents: 15000, assigned_user_ids: [U.fred] },
  {
    id: R.palier, org: ORG.A, name: '5 % + palier 2 500 $', base_kind: 'percent', base_percent: 5, assigned_user_ids: [U.tina],
    performance_tiers: [{ metric: 'revenue_cents', threshold: 250000, modifier_percent: 2, modifier_flat_cents: null }],
  },
  {
    id: R.duo, org: ORG.A, name: 'Duo 8 %', base_kind: 'percent', base_percent: 8, assigned_user_ids: [U.sam],
    attribution: { mode: 'split', splits: [{ user_id: U.sam, pct: 50 }, { user_id: U.sara, pct: 50 }] },
  },
  { id: R.dora, org: ORG.A, name: 'Plan Dora 10 %', base_kind: 'percent', base_percent: 10, assigned_user_ids: [U.dora] },
  { id: R.bea, org: ORG.B, name: 'Plan B 10 %', base_kind: 'percent', base_percent: 10, assigned_user_ids: [U.bea] },
] as const;

// ── Factures ────────────────────────────────────────────────────────────────
// Taxes QC : TPS 5 % + TVQ 9,975 %, arrondies séparément (comme une facture réelle).
export const taxesQc = (baseCents: number) => Math.round(baseCents * 0.05) + Math.round(baseCents * 0.09975);

export interface FactureFixture {
  cle: string;
  id: string;
  org: string;
  rep: string | null;      // jobs.salesperson_id (null = facture sans job)
  job: string | null;      // plusieurs factures peuvent partager un job (récurrent)
  sous_total_cents: number;
  rabais_cents?: number;
  cree_le: string;         // création du job (ISO avec décalage)
  note: string;
}

let n = 0x700;
const inv = (f: Omit<FactureFixture, 'id'>): FactureFixture => ({ ...f, id: id(++n) });
const J = (k: number) => id(0x900 + k);

export const FACTURES: FactureFixture[] = [
  inv({ cle: 'I1', org: ORG.A, rep: U.rita, job: J(1), sous_total_cents: 100000, cree_le: '2026-09-01T09:00:00-04:00', note: 'payée en totalité — base avant taxes' }),
  inv({ cle: 'I2', org: ORG.A, rep: U.rita, job: J(2), sous_total_cents: 50000, cree_le: '2026-09-02T09:00:00-04:00', note: 'paiement partiel seulement' }),
  inv({ cle: 'I3', org: ORG.A, rep: U.rita, job: J(3), sous_total_cents: 80000, cree_le: '2026-09-05T09:00:00-04:00', note: 'vendue à 10 %, payée après le passage à 12 %' }),
  inv({ cle: 'I4', org: ORG.A, rep: U.rita, job: J(4), sous_total_cents: 40000, cree_le: '2026-09-06T09:00:00-04:00', note: 'remboursée AVANT le versement de la commission' }),
  inv({ cle: 'I5', org: ORG.A, rep: U.rita, job: J(5), sous_total_cents: 60000, cree_le: '2026-08-10T09:00:00-04:00', note: 'août, commission versée, remboursée en septembre' }),
  inv({ cle: 'I6', org: ORG.A, rep: U.rita, job: J(6), sous_total_cents: 30000, cree_le: '2026-08-20T09:00:00-04:00', note: 'payée le 31 août 23 h 30 heure de Toronto' }),
  inv({ cle: 'I7', org: ORG.A, rep: U.rita, job: J(7), sous_total_cents: 20000, cree_le: '2026-09-07T09:00:00-04:00', note: 'annulée (void) sans paiement' }),
  inv({ cle: 'I8', org: ORG.A, rep: U.rita, job: J(8), sous_total_cents: 100000, rabais_cents: 10000, cree_le: '2026-09-08T09:00:00-04:00', note: 'rabais 100 $' }),
  inv({ cle: 'I9', org: ORG.A, rep: U.fred, job: J(9), sous_total_cents: 25000, cree_le: '2026-09-01T10:00:00-04:00', note: 'forfait' }),
  inv({ cle: 'R1', org: ORG.A, rep: U.fred, job: J(10), sous_total_cents: 10000, cree_le: '2026-07-01T10:00:00-04:00', note: 'récurrent — 1re facture' }),
  inv({ cle: 'R2', org: ORG.A, rep: U.fred, job: J(27), sous_total_cents: 10000, cree_le: '2026-08-01T10:00:00-04:00', note: 'récurrent — 2e occurrence (job de la série)' }),
  inv({ cle: 'R3', org: ORG.A, rep: U.fred, job: J(28), sous_total_cents: 10000, cree_le: '2026-09-01T10:00:00-04:00', note: 'récurrent — 3e occurrence (job de la série)' }),
  inv({ cle: 'RF1', org: ORG.A, rep: U.fred, job: J(31), sous_total_cents: 20000, cree_le: '2026-09-10T10:00:00-04:00', note: 'payée, remboursée, annulée…' }),
  inv({ cle: 'RF2', org: ORG.A, rep: U.fred, job: J(31), sous_total_cents: 20000, cree_le: '2026-09-15T09:00:00-04:00', note: '…puis refaite sur le même job et payée' }),
  inv({ cle: 'S1', org: ORG.A, rep: U.sam, job: J(11), sous_total_cents: 100063, cree_le: '2026-09-03T10:00:00-04:00', note: 'split 50/50 sur un montant impair' }),
  inv({ cle: 'T1', org: ORG.A, rep: U.tina, job: J(12), sous_total_cents: 150000, cree_le: '2026-09-02T10:00:00-04:00', note: 'palier : 1 500 $' }),
  inv({ cle: 'T2', org: ORG.A, rep: U.tina, job: J(13), sous_total_cents: 80000, cree_le: '2026-09-10T10:00:00-04:00', note: 'palier : cumul 2 300 $ avant taxes (< seuil)' }),
  inv({ cle: 'T3', org: ORG.A, rep: U.tina, job: J(14), sous_total_cents: 30000, cree_le: '2026-09-20T10:00:00-04:00', note: 'palier : cumul 2 600 $ (≥ seuil)' }),
  inv({ cle: 'T5', org: ORG.A, rep: U.tina, job: J(15), sous_total_cents: 20000, cree_le: '2026-09-25T10:00:00-04:00', note: 'palier : payée le 30 sept. 23 h 30 Toronto (= 1er oct. UTC)' }),
  inv({ cle: 'T4', org: ORG.A, rep: U.tina, job: J(16), sous_total_cents: 30000, cree_le: '2026-09-26T10:00:00-04:00', note: 'palier : 1er oct. 00 h 30 Toronto, nouveau mois' }),
  inv({ cle: 'D1', org: ORG.A, rep: U.dora, job: J(17), sous_total_cents: 50000, cree_le: '2026-07-05T10:00:00-04:00', note: 'Dora active — historique versé' }),
  inv({ cle: 'D2', org: ORG.A, rep: U.dora, job: J(18), sous_total_cents: 40000, cree_le: '2026-07-20T10:00:00-04:00', note: 'vendue par Dora, payée après sa désactivation' }),
  inv({ cle: 'H1', org: ORG.A, rep: U.hugo, job: J(19), sous_total_cents: 50000, cree_le: '2026-09-04T10:00:00-04:00', note: 'membre à l’heure' }),
  inv({ cle: 'N1', org: ORG.A, rep: U.nora, job: J(20), sous_total_cents: 50000, cree_le: '2026-09-04T10:00:00-04:00', note: 'mode commission sans plan' }),
  inv({ cle: 'X1', org: ORG.A, rep: null, job: null, sous_total_cents: 30000, cree_le: '2026-09-04T10:00:00-04:00', note: 'facture sans job' }),
  inv({ cle: 'Y1', org: ORG.A, rep: U.rita, job: J(21), sous_total_cents: 10000, cree_le: '2025-12-20T10:00:00-05:00', note: '31 déc. 23 h 30 Toronto' }),
  inv({ cle: 'Y2', org: ORG.A, rep: U.rita, job: J(22), sous_total_cents: 10000, cree_le: '2025-12-20T10:00:00-05:00', note: '1er janv. 00 h 15 Toronto' }),
  inv({ cle: 'H0', org: ORG.A, rep: U.rita, job: J(23), sous_total_cents: 10000, cree_le: '2026-03-01T10:00:00-05:00', note: 'passage à l’heure d’été (8 mars 03 h 30 HAE)' }),
  inv({ cle: 'H2', org: ORG.A, rep: U.rita, job: J(24), sous_total_cents: 10000, cree_le: '2026-10-20T10:00:00-04:00', note: '31 oct. 23 h 45 HAE (veille du retour à l’heure normale)' }),
  inv({ cle: 'H3', org: ORG.A, rep: U.rita, job: J(25), sous_total_cents: 10000, cree_le: '2026-10-20T10:00:00-04:00', note: '1er nov. 01 h 30 HNE (heure répétée)' }),
  inv({ cle: 'Q1', org: ORG.A, rep: U.adam, job: J(26), sous_total_cents: 70000, cree_le: '2026-09-09T10:00:00-04:00', note: 'job créé par Adam, devis vendu par Rita' }),
  inv({ cle: 'B1', org: ORG.B, rep: U.bea, job: J(40), sous_total_cents: 70000, cree_le: '2026-09-01T10:00:00-04:00', note: 'autre tenant — ne doit jamais apparaître dans A' }),
];
export const f = (cle: string) => { const x = FACTURES.find((y) => y.cle === cle); if (!x) throw new Error(cle); return x; };
export const JOB_ESTIMATION_SEULE = { id: J(30), rep: U.rita, sous_total_cents: 45000, cree_le: '2026-09-15T10:00:00-04:00' };
export const DEVIS_Q1 = { id: id(0xa01), salesperson: U.rita };

// ── Ligne du temps ──────────────────────────────────────────────────────────
export type Evenement =
  | { t: string; type: 'job'; cle: string }                          // création du job (+ estimation)
  | { t: string; type: 'job_estimation_seule' }
  | { t: string; type: 'facture_envoyee'; cle: string }
  | { t: string; type: 'paiement'; cle: string; cents?: number }     // défaut = total
  | { t: string; type: 'remboursement_total'; cle: string }          // POST /payments/refund
  | { t: string; type: 'void'; cle: string }
  | { t: string; type: 'supprimer'; cle: string }                   // suppression douce de la facture
  | { t: string; type: 'taux'; regle: string; pourcent: number }
  | { t: string; type: 'verser'; cles: string[] }                    // « Verser » sur la page
  | { t: string; type: 'paie_payee'; user: string; debut: string; fin: string }
  | { t: string; type: 'desactiver'; user: string };

const jobsUniques = [...new Set(FACTURES.filter((x) => x.job).map((x) => x.job))];
const premiereFactureDuJob = (job: string) => FACTURES.find((x) => x.job === job)!;

export const LIGNE_DU_TEMPS: Evenement[] = [
  ...jobsUniques.map((j) => { const x = premiereFactureDuJob(j!); return { t: x.cree_le, type: 'job' as const, cle: x.cle }; }),
  { t: JOB_ESTIMATION_SEULE.cree_le, type: 'job_estimation_seule' },
  ...FACTURES.map((x) => ({ t: x.cree_le, type: 'facture_envoyee' as const, cle: x.cle })),
  // juillet
  { t: '2026-07-05T12:00:00-04:00', type: 'paiement', cle: 'R1' },
  { t: '2026-07-10T12:00:00-04:00', type: 'paiement', cle: 'D1' },
  { t: '2026-07-31T17:00:00-04:00', type: 'verser', cles: ['D1'] },
  { t: '2026-08-01T09:00:00-04:00', type: 'desactiver', user: U.dora },
  // août
  { t: '2026-08-05T12:00:00-04:00', type: 'paiement', cle: 'R2' },
  { t: '2026-08-14T12:00:00-04:00', type: 'paiement', cle: 'I5' },
  { t: '2026-08-31T23:30:00-04:00', type: 'paiement', cle: 'I6' },
  { t: '2026-09-02T10:00:00-04:00', type: 'verser', cles: ['I5', 'I6'] },
  { t: '2026-09-02T10:05:00-04:00', type: 'paie_payee', user: U.rita, debut: '2026-08-01', fin: '2026-08-31' },
  // septembre
  { t: '2026-09-03T12:00:00-04:00', type: 'paiement', cle: 'I9' },
  { t: '2026-09-04T12:00:00-04:00', type: 'paiement', cle: 'H1' },
  { t: '2026-09-04T12:05:00-04:00', type: 'paiement', cle: 'N1' },
  { t: '2026-09-04T12:10:00-04:00', type: 'paiement', cle: 'X1' },
  { t: '2026-09-05T12:00:00-04:00', type: 'paiement', cle: 'R3' },
  { t: '2026-09-06T12:00:00-04:00', type: 'paiement', cle: 'S1' },
  { t: '2026-09-08T12:00:00-04:00', type: 'paiement', cle: 'T1' },
  { t: '2026-09-09T12:00:00-04:00', type: 'paiement', cle: 'D2' },
  { t: '2026-09-09T13:00:00-04:00', type: 'paiement', cle: 'Q1' },
  { t: '2026-09-10T12:00:00-04:00', type: 'paiement', cle: 'I1' },
  { t: '2026-09-10T12:00:00-04:00', type: 'paiement', cle: 'B1' },
  { t: '2026-09-11T12:00:00-04:00', type: 'void', cle: 'I7' },
  { t: '2026-09-12T12:00:00-04:00', type: 'paiement', cle: 'I2', cents: 20000 },
  { t: '2026-09-12T13:00:00-04:00', type: 'paiement', cle: 'I8' },
  { t: '2026-09-13T12:00:00-04:00', type: 'paiement', cle: 'RF1' },
  { t: '2026-09-14T12:00:00-04:00', type: 'remboursement_total', cle: 'RF1' },
  { t: '2026-09-14T12:30:00-04:00', type: 'void', cle: 'RF1' },
  { t: '2026-09-14T12:35:00-04:00', type: 'supprimer', cle: 'RF1' },
  { t: '2026-09-15T08:00:00-04:00', type: 'taux', regle: R.pct, pourcent: 12 },
  { t: '2026-09-16T12:00:00-04:00', type: 'paiement', cle: 'RF2' },
  { t: '2026-09-18T12:00:00-04:00', type: 'paiement', cle: 'T2' },
  { t: '2026-09-20T12:00:00-04:00', type: 'paiement', cle: 'I3' },
  { t: '2026-09-21T12:00:00-04:00', type: 'paiement', cle: 'I4' },
  { t: '2026-09-22T12:00:00-04:00', type: 'remboursement_total', cle: 'I4' },
  { t: '2026-09-23T12:00:00-04:00', type: 'remboursement_total', cle: 'I5' },
  { t: '2026-09-25T12:00:00-04:00', type: 'paiement', cle: 'T3' },
  { t: '2026-09-30T23:30:00-04:00', type: 'paiement', cle: 'T5' },
  { t: '2026-10-01T00:30:00-04:00', type: 'paiement', cle: 'T4' },
  // frontières du calendrier
  { t: '2025-12-31T23:30:00-05:00', type: 'paiement', cle: 'Y1' },
  { t: '2026-01-01T00:15:00-05:00', type: 'paiement', cle: 'Y2' },
  { t: '2026-03-08T03:30:00-04:00', type: 'paiement', cle: 'H0' },
  { t: '2026-10-31T23:45:00-04:00', type: 'paiement', cle: 'H2' },
  { t: '2026-11-01T01:30:00-05:00', type: 'paiement', cle: 'H3' },
];

export const ordonner = (evts: Evenement[]) =>
  [...evts].map((e, i) => ({ e, i })).sort((a, b) => Date.parse(a.e.t) - Date.parse(b.e.t) || a.i - b.i).map((x) => x.e);

/** Règles telles qu'à chaque instant (il n'y a PAS d'historique des règles en base). */
export const HISTORIQUE_TAUX = [
  { regle: R.pct, depuis: '2000-01-01T00:00:00Z', pourcent: 10 },
  { regle: R.pct, depuis: '2026-09-15T12:00:00Z', pourcent: 12 },
];
