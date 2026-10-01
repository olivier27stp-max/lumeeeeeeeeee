/**
 * La fiche des faits (`evals/lumi/fixture.json`) : ce que les cas d'évaluation
 * ont besoin de savoir du bureau de test — noms, numéros, montants, totaux.
 *
 * Deux états :
 *  - « previsionnel » : calculé à partir du PLAN (jeu-eval.mts), sans base. Les
 *    numéros attribués par la base (job, devis, facture) sont inconnus (null) et
 *    les mesures ne portent que sur le jeu. Sert au validateur, hors ligne.
 *  - « reel » : relu dans la base par le seed, après écriture. Les numéros sont
 *    ceux de la base et les mesures portent sur TOUT le bureau (Lumi voit tout,
 *    pas seulement les fiches du jeu).
 *
 * Unité d'une valeur, lue dans le nom de sa clé (le correcteur s'en sert) :
 *  `*_cents` = argent en cents · `*_heures` = heures décimales · `*_pct` = pourcentage ·
 *  `nombre` / `*_nombre` = entier.
 */
import {
  CLIENTS, DEVIS, EQUIPES, FACTURES, JOBS, MEMBRES, MODELES_COURRIEL, PREFIXE_DEFAUT, TACHES, VALABLE_JUSQU_AU,
  adresseClient, clientDe, courrielEval, heuresPointage, idEval, jourDe, membreDe, nomClient, sousTotal, taxesQc, ajouterJours,
} from './jeu-eval.mts';

/** Ce qui change d'un bureau d'évaluation à l'autre : le préfixe des courriels des membres et les comptes qui posent les demandes. */
export interface VarianteBureau { prefixe: string; comptes: { proprietaire: string; technicien: string } }
export const VARIANTE_DEFAUT: VarianteBureau = { prefixe: PREFIXE_DEFAUT, comptes: { proprietaire: 'qa.map.owner@lume.test', technicien: 'qa.lumi.tech@lume.test' } };

export interface FaitClient { id: string; nom: string; prenom: string; nom_famille: string; entreprise: string | null; courriel: string | null; telephone: string; ville: string; adresse: string; statut: string }
export interface FaitMembre { nom: string; prenom: string; nom_famille: string; role: string; courriel: string; taux_horaire_cents: number }
export interface FaitJob { numero: string | null; titre: string; client: string; ville: string; statut: string; jour: string | null; sous_total_cents: number; taxes_cents: number; total_cents: number }
export interface FaitDevis { numero: string | null; titre: string; client: string; statut: string; sous_total_cents: number; taxes_cents: number; total_cents: number }
export interface FaitFacture { numero: string | null; client: string; sujet: string; statut: string; echeance: string | null; sous_total_cents: number; taxes_cents: number; total_cents: number; paye_cents: number; solde_cents: number }
export interface FaitPaiement { client: string; facture: string; montant_cents: number; methode: string; jour: string }
export interface FaitRentabilite { revenus_cents: number; main_oeuvre_cents: number; commissions_cents: number; depenses_cents: number; couts_cents: number; profit_cents: number; marge_pct: number | null; total_heures: number }
export interface MesureVisites { nombre: number; clients: string[] }

export interface Fixture {
  etat: 'previsionnel' | 'reel';
  genere_le: string;
  /** Le jour auquel les visites relatives (aujourd'hui, demain…) sont accrochées. */
  ancre: string;
  valable_jusqu_au: string;
  org: { id: string; nom: string | null };
  comptes: { proprietaire: string; technicien: string };
  clients: Record<string, FaitClient>;
  homonymes: { nom: string; ville_a: string; ville_b: string };
  equipe: Record<string, FaitMembre>;
  equipes: Record<string, { nom: string }>;
  jobs: Record<string, FaitJob>;
  devis: Record<string, FaitDevis>;
  factures: Record<string, FaitFacture>;
  paiements: Record<string, FaitPaiement>;
  taches: Record<string, { titre: string; statut: string; echeance: string }>;
  modeles_courriel: Record<string, { nom: string; type: string; par_defaut: boolean }>;
  /** Rentabilité des jobs terminées, recalculée à partir des lignes brutes (pas par le code de Lumi). */
  rentabilite: Record<string, FaitRentabilite>;
  mesures: {
    portee: 'jeu_seul' | 'bureau_entier';
    factures_en_retard: { nombre: number; solde_cents: number };
    factures_impayees: { nombre: number; solde_cents: number };
    factures_brouillon: { nombre: number };
    encaisse_septembre_2026: { nombre: number; total_cents: number };
    heures_septembre_2026: Record<string, number>;
    visites: { aujourd_hui: MesureVisites; demain: MesureVisites; sept_jours: MesureVisites };
    devis: { brouillon_nombre: number; en_attente_nombre: number; acceptes_nombre: number; refuses_nombre: number };
    clients: { nombre: number };
    prospects: { nombre: number };
  };
  /** Écarts entre le plan et la base, relevés à la relecture (vide = la base dit ce que le plan prévoyait). */
  ecarts: string[];
}

/** Marge en % à une décimale (null sans revenus). */
export const margePct = (profit: number, revenus: number): number | null => (revenus > 0 ? Math.round((profit / revenus) * 1000) / 10 : null);

export function rentabiliteDe(p: { revenus: number; mainOeuvre: number; commissions: number; depenses: number; heures: number }): FaitRentabilite {
  const couts = p.mainOeuvre + p.commissions + p.depenses;
  const profit = p.revenus - couts;
  return {
    revenus_cents: p.revenus, main_oeuvre_cents: p.mainOeuvre, commissions_cents: p.commissions, depenses_cents: p.depenses,
    couts_cents: couts, profit_cents: profit, marge_pct: margePct(profit, p.revenus), total_heures: Math.round(p.heures * 100) / 100,
  };
}

/** La fiche des faits telle que le PLAN la prévoit (aucune base). */
export function fixturePrevisionnelle(ancre: string, orgId: string, variante: VarianteBureau = VARIANTE_DEFAUT): Fixture {
  const clients: Fixture['clients'] = {};
  for (const c of CLIENTS) {
    clients[c.cle] = {
      id: idEval(`client:${c.cle}`, orgId), nom: nomClient(c), prenom: c.prenom, nom_famille: c.nom, entreprise: c.entreprise ?? null, courriel: c.courriel,
      telephone: c.telephone, ville: c.ville, adresse: adresseClient(c), statut: c.statut,
    };
  }
  const equipe: Fixture['equipe'] = {};
  for (const m of MEMBRES) equipe[m.cle] = { nom: `${m.prenom} ${m.nom}`, prenom: m.prenom, nom_famille: m.nom, role: m.role, courriel: courrielEval(m.courriel, variante.prefixe), taux_horaire_cents: m.tauxCents };

  const jobs: Fixture['jobs'] = {};
  for (const j of JOBS) {
    const st = sousTotal(j.lignes);
    const taxes = taxesQc(st).total;
    jobs[j.cle] = {
      numero: null, titre: j.titre, client: nomClient(clientDe(j.client)), ville: clientDe(j.client).ville, statut: j.statut,
      jour: j.visite ? jourDe(j.visite.quand, ancre) : null, sous_total_cents: st, taxes_cents: taxes, total_cents: st + taxes,
    };
  }
  const devis: Fixture['devis'] = {};
  for (const d of DEVIS) {
    const st = sousTotal(d.lignes);
    const taxes = taxesQc(st).total;
    devis[d.cle] = { numero: null, titre: d.titre, client: nomClient(clientDe(d.client)), statut: d.statut, sous_total_cents: st, taxes_cents: taxes, total_cents: st + taxes };
  }
  const factures: Fixture['factures'] = {};
  const paiements: Fixture['paiements'] = {};
  for (const f of FACTURES) {
    const st = sousTotal(f.lignes);
    const taxes = taxesQc(st).total;
    const paye = (f.paiements ?? []).reduce((s, p) => s + p.montantCents, 0);
    const total = st + taxes;
    factures[f.cle] = {
      numero: null, client: nomClient(clientDe(f.client)), sujet: f.sujet,
      statut: !f.emise ? 'draft' : paye >= total ? 'paid' : paye > 0 ? 'partial' : 'sent',
      echeance: f.echeance ?? null, sous_total_cents: st, taxes_cents: taxes, total_cents: total, paye_cents: paye, solde_cents: total - paye,
    };
    for (const p of f.paiements ?? []) paiements[p.cle] = { client: nomClient(clientDe(f.client)), facture: f.cle, montant_cents: p.montantCents, methode: p.methode, jour: p.date };
  }

  // Rentabilité des jobs terminées : la même définition que l'écran (PROFITABILITY_PLAN.md),
  // refaite ici à la main — revenus avant taxes de la facture émise (sinon prix du job),
  // heures pointées × taux, commissions, champs du dossier Dépenses.
  const rentabilite: Fixture['rentabilite'] = {};
  for (const j of JOBS.filter((x) => x.statut === 'completed')) {
    const facture = FACTURES.find((f) => f.job === j.cle && f.emise);
    const heures = (j.pointages ?? []).reduce((s, p) => s + heuresPointage(p), 0);
    const mainOeuvre = (j.pointages ?? []).reduce((s, p) => s + (membreDe(p.membre).mode === 'commission' ? 0 : Math.round(heuresPointage(p) * membreDe(p.membre).tauxCents)), 0);
    rentabilite[j.cle] = rentabiliteDe({
      revenus: sousTotal(facture ? facture.lignes : j.lignes), mainOeuvre, commissions: j.commissionCents ?? 0,
      depenses: (j.depenses?.carburant ?? 0) + (j.depenses?.outils ?? 0), heures,
    });
  }

  const emises = Object.values(factures).filter((f) => f.statut === 'sent' || f.statut === 'partial');
  const enRetard = emises.filter((f) => f.solde_cents > 0 && f.echeance != null && f.echeance < ancre);
  const paiementsSept = Object.values(paiements).filter((p) => p.jour >= '2026-09-01' && p.jour <= '2026-09-30');
  const heures: Record<string, number> = { total_heures: 0 };
  for (const j of JOBS) {
    for (const p of j.pointages ?? []) {
      if (!j.visite || !('fixe' in j.visite.quand) || !j.visite.quand.fixe.startsWith('2026-09')) continue;
      heures[`${p.membre}_heures`] = (heures[`${p.membre}_heures`] ?? 0) + heuresPointage(p);
      heures.total_heures += heuresPointage(p);
    }
  }
  const visitesLe = (du: string, au: string): MesureVisites => {
    const vs = JOBS.filter((j) => j.visite && jourDe(j.visite.quand, ancre) >= du && jourDe(j.visite.quand, ancre) <= au);
    return { nombre: vs.length, clients: vs.map((j) => nomClient(clientDe(j.client))) };
  };
  const nbDevis = (s: string) => DEVIS.filter((d) => d.statut === s).length;

  return {
    etat: 'previsionnel',
    genere_le: new Date().toISOString(),
    ancre,
    valable_jusqu_au: VALABLE_JUSQU_AU,
    org: { id: orgId, nom: null },
    comptes: { ...variante.comptes },
    clients,
    homonymes: { nom: nomClient(clientDe('roy_longueuil')), ville_a: clientDe('roy_longueuil').ville, ville_b: clientDe('roy_brossard').ville },
    equipe,
    equipes: Object.fromEntries(EQUIPES.map((e) => [e.cle, { nom: e.nom }])),
    jobs, devis, factures, paiements,
    taches: Object.fromEntries(TACHES.map((t) => [t.cle.replace(/^tache_/, ''), { titre: t.titre, statut: t.statut, echeance: t.echeance }])),
    modeles_courriel: Object.fromEntries(MODELES_COURRIEL.map((m) => [m.cle.replace(/^modele_/, ''), { nom: m.nom, type: m.type, par_defaut: m.parDefaut }])),
    rentabilite,
    mesures: {
      portee: 'jeu_seul',
      factures_en_retard: { nombre: enRetard.length, solde_cents: enRetard.reduce((s, f) => s + f.solde_cents, 0) },
      factures_impayees: { nombre: emises.filter((f) => f.solde_cents > 0).length, solde_cents: emises.reduce((s, f) => s + f.solde_cents, 0) },
      factures_brouillon: { nombre: Object.values(factures).filter((f) => f.statut === 'draft').length },
      encaisse_septembre_2026: { nombre: paiementsSept.length, total_cents: paiementsSept.reduce((s, p) => s + p.montant_cents, 0) },
      heures_septembre_2026: heures,
      visites: { aujourd_hui: visitesLe(ancre, ancre), demain: visitesLe(ajouterJours(ancre, 1), ajouterJours(ancre, 1)), sept_jours: visitesLe(ancre, ajouterJours(ancre, 6)) },
      devis: { brouillon_nombre: nbDevis('draft'), en_attente_nombre: nbDevis('awaiting_response'), acceptes_nombre: nbDevis('approved'), refuses_nombre: nbDevis('declined') },
      clients: { nombre: CLIENTS.filter((c) => c.statut === 'active').length },
      prospects: { nombre: CLIENTS.filter((c) => c.statut === 'lead').length },
    },
    ecarts: [],
  };
}

/** Lit « a.b.c » dans la fiche ; `undefined` si le chemin n'existe pas. */
export function lireChemin(racine: unknown, chemin: string): unknown {
  let o: unknown = racine;
  for (const k of chemin.split('.')) {
    if (o == null || typeof o !== 'object') return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}
