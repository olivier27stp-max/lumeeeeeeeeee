/**
 * « Optimiser la journée » — le solveur (audit Agenda, 2026-09-30). 100 % code, zéro LLM.
 *
 * Pour UNE équipe et UN jour : réordonne les visites déplaçables et recalcule
 * leurs heures pour rouler le moins possible, sans jamais :
 *  - toucher une visite fixe (terminée, en cours, confirmée au client, passée) ;
 *  - changer d'équipe ;
 *  - placer une visite dans le passé ou hors des heures de travail ;
 *  - inverser les visites d'une même job (ordre multi-visites) ;
 *  - raccourcir une visite (chaque visite garde sa durée).
 *
 * Déterministe : même entrée → même proposition (égalités départagées par
 * l'identifiant). Exact jusqu'à EXACT_MAX visites déplaçables (toutes les
 * permutations, élaguées) ; au-delà, plus proche voisin + 2-opt, validé contre
 * l'exact dans les tests.
 */
import type { Point, Trajet } from './matrice';

export const EXACT_MAX = 8;
/** Les heures proposées tombent sur un multiple de 5 minutes. */
const PAS_MS = 5 * 60_000;

export type RaisonFixe = 'terminee' | 'en_cours' | 'confirmee_client' | 'passee';

export interface VisiteOpt {
  id: string;
  jobId: string | null;
  titre: string;
  debut: number;          // ms, instant réel
  fin: number;            // ms
  point: Point;
  fixe: RaisonFixe | null;
}

export interface EntreeEquipe {
  teamId: string | null;
  visites: VisiteOpt[];   // toutes les visites géocodées de l'équipe ce jour-là (annulées exclues)
  /** Heures de travail du jour (ms). */
  debutJournee: number;
  finJournee: number;
  /** Rien avant cet instant (maintenant, en cours de journée). */
  pasAvant: number;
  /** Point de départ (position actuelle en cours de journée, sinon le dépôt s'il existe). */
  depart: Point | null;
  /** Point de fin, s'il existe. */
  arrivee: Point | null;
}

export interface Changement { visitId: string; jobId: string | null; titre: string; avantDebut: number; avantFin: number; apresDebut: number; apresFin: number }

export interface ResultatEquipe {
  teamId: string | null;
  avant: { ordre: string[]; secondes: number; metres: number };
  apres: { ordre: string[]; secondes: number; metres: number };
  gainSecondes: number;
  changements: Changement[];
  fixes: Array<{ visitId: string; titre: string; raison: RaisonFixe }>;
  impossibles: string[];
  exact: boolean;
}

type Tr = (a: Point, b: Point) => Trajet;

const arrondirHaut = (ms: number) => Math.ceil(ms / PAS_MS) * PAS_MS;

/** Coût de route d'une suite de points (depuis `depart`, jusqu'à `arrivee`). */
function routeDe(points: Point[], depart: Point | null, arrivee: Point | null, tr: Tr): { secondes: number; metres: number } {
  const chaine = [...(depart ? [depart] : []), ...points, ...(arrivee ? [arrivee] : [])];
  let secondes = 0, metres = 0;
  for (let i = 1; i < chaine.length; i++) { const t = tr(chaine[i - 1], chaine[i]); secondes += t.secondes; metres += t.metres; }
  return { secondes, metres };
}

/**
 * Planifie une séquence : les fixes gardent leur heure ; chaque déplaçable
 * commence dès qu'on peut y arriver (arrondi aux 5 min), jamais avant
 * `pasAvant` ni `debutJournee`. Renvoie null si la séquence est irréalisable
 * (arrivée en retard à une fixe, dépassement de la journée).
 */
function planifier(seq: VisiteOpt[], e: EntreeEquipe, tr: Tr): Map<string, { debut: number; fin: number }> | null {
  const out = new Map<string, { debut: number; fin: number }>();
  let t = Math.max(e.debutJournee, e.pasAvant);
  let ici: Point | null = e.depart;
  for (const v of seq) {
    const route = ici ? tr(ici, v.point).secondes * 1000 : 0;
    const arrivee = t + route;
    if (v.fixe) {
      if (arrivee > v.debut) return null;
      out.set(v.id, { debut: v.debut, fin: v.fin });
      t = v.fin;
    } else {
      const debut = arrondirHaut(Math.max(arrivee, e.debutJournee, e.pasAvant));
      const fin = debut + (v.fin - v.debut);
      if (fin > e.finJournee) return null;
      out.set(v.id, { debut, fin });
      t = fin;
    }
    ici = v.point;
  }
  return out;
}

/** Les visites d'une même job gardent leur ordre relatif. */
function respecteMultiVisites(seq: VisiteOpt[], ordreInitial: Map<string, number>): boolean {
  const dernier = new Map<string, number>();
  for (const v of seq) {
    if (!v.jobId) continue;
    const r = ordreInitial.get(v.id)!;
    if ((dernier.get(v.jobId) ?? -1) > r) return false;
    dernier.set(v.jobId, r);
  }
  return true;
}

/** Les fixes restent dans l'ordre chronologique (leurs heures ne bougent pas). */
function fixesEnOrdre(seq: VisiteOpt[]): boolean {
  let t = -Infinity;
  for (const v of seq) if (v.fixe) { if (v.debut < t) return false; t = v.debut; }
  return true;
}

interface Candidat { seq: VisiteOpt[]; secondes: number; metres: number; finDerniere: number; cle: string }

function evaluer(seq: VisiteOpt[], e: EntreeEquipe, tr: Tr, ordreInitial: Map<string, number>): Candidat | null {
  if (!fixesEnOrdre(seq) || !respecteMultiVisites(seq, ordreInitial)) return null;
  const plan = planifier(seq, e, tr);
  if (!plan) return null;
  const r = routeDe(seq.map((v) => v.point), e.depart, e.arrivee, tr);
  const finDerniere = Math.max(...seq.map((v) => plan.get(v.id)!.fin));
  return { seq, ...r, finDerniere, cle: seq.map((v) => v.id).join('|') };
}

/** Meilleur = moins de route, puis journée finie plus tôt, puis identifiants (déterminisme). */
function meilleur(a: Candidat | null, b: Candidat | null): Candidat | null {
  if (!a) return b;
  if (!b) return a;
  if (a.secondes !== b.secondes) return a.secondes < b.secondes ? a : b;
  if (a.finDerniere !== b.finDerniere) return a.finDerniere < b.finDerniere ? a : b;
  return a.cle <= b.cle ? a : b;
}

function exact(visites: VisiteOpt[], e: EntreeEquipe, tr: Tr, ordreInitial: Map<string, number>): Candidat | null {
  const tries = [...visites].sort((a, b) => a.id.localeCompare(b.id));
  let best: Candidat | null = null;
  const seq: VisiteOpt[] = [];
  const pris = new Array(tries.length).fill(false);
  const rec = (routeS: number) => {
    if (best && routeS > best.secondes) return; // élagage : déjà pire
    if (seq.length === tries.length) { best = meilleur(best, evaluer([...seq], e, tr, ordreInitial)); return; }
    for (let i = 0; i < tries.length; i++) {
      if (pris[i]) continue;
      // Une fixe ne passe qu'à son tour (ordre chronologique) ; une visite
      // multi-visites seulement après les visites antérieures de sa job.
      const v = tries[i];
      const doitAttendre = tries.some((w, k) => !pris[k] && k !== i && ordreInitial.get(w.id)! < ordreInitial.get(v.id)!
        && ((v.fixe && w.fixe) || (v.jobId && w.jobId === v.jobId)));
      if (doitAttendre) continue;
      const prec = seq.length ? seq[seq.length - 1].point : e.depart;
      const ajout = prec ? tr(prec, tries[i].point).secondes : 0;
      pris[i] = true; seq.push(tries[i]);
      rec(routeS + ajout);
      seq.pop(); pris[i] = false;
    }
  };
  rec(0);
  return best;
}

function heuristique(visites: VisiteOpt[], e: EntreeEquipe, tr: Tr, ordreInitial: Map<string, number>, initial: VisiteOpt[]): Candidat | null {
  // Plus proche voisin depuis le départ, égalités par identifiant.
  const restants = [...visites].sort((a, b) => a.id.localeCompare(b.id));
  const seq: VisiteOpt[] = [];
  let ici = e.depart ?? restants[0]?.point ?? null;
  while (restants.length) {
    let k = 0, meilleurS = Infinity;
    restants.forEach((v, i) => { const s = ici ? tr(ici, v.point).secondes : 0; if (s < meilleurS) { meilleurS = s; k = i; } });
    const [v] = restants.splice(k, 1); seq.push(v); ici = v.point;
  }
  let best = meilleur(evaluer(initial, e, tr, ordreInitial), evaluer(seq, e, tr, ordreInitial));
  // 2-opt, départ du meilleur réalisable connu.
  let courant = best?.seq ?? initial;
  let ameliore = true;
  for (let tour = 0; ameliore && tour < 50; tour++) {
    ameliore = false;
    for (let i = 0; i < courant.length - 1; i++) {
      for (let j = i + 1; j < courant.length; j++) {
        const essai = [...courant.slice(0, i), ...courant.slice(i, j + 1).reverse(), ...courant.slice(j + 1)];
        const c = evaluer(essai, e, tr, ordreInitial);
        const m = meilleur(best, c);
        if (c && m === c && c !== best) { best = c; courant = essai; ameliore = true; }
      }
    }
  }
  return best;
}

export function optimiserEquipe(e: EntreeEquipe, tr: Tr): ResultatEquipe {
  const toutes = [...e.visites].sort((a, b) => a.debut - b.debut || a.id.localeCompare(b.id));
  // En cours de journée : ce qui est déjà fini n'entre pas dans le calcul —
  // on repart de la position et de l'heure actuelles (`depart`, `pasAvant`).
  const finies = toutes.filter((v) => v.fin <= e.pasAvant);
  const initial = toutes.filter((v) => v.fin > e.pasAvant);
  const ordreInitial = new Map(initial.map((v, i) => [v.id, i]));
  const routeAvant = routeDe(initial.map((v) => v.point), e.depart, e.arrivee, tr);
  const fixes = [
    ...finies.map((v) => ({ visitId: v.id, titre: v.titre, raison: (v.fixe ?? 'passee') as RaisonFixe })),
    ...initial.filter((v) => v.fixe).map((v) => ({ visitId: v.id, titre: v.titre, raison: v.fixe as RaisonFixe })),
  ];
  const deplacables = initial.filter((v) => !v.fixe);
  const impossibles: string[] = [];

  const base = { teamId: e.teamId, avant: { ordre: initial.map((v) => v.id), ...routeAvant }, fixes, exact: deplacables.length <= EXACT_MAX };
  const inchange = (): ResultatEquipe => ({ ...base, apres: base.avant, gainSecondes: 0, changements: [], impossibles });

  if (deplacables.length < 2) return inchange();
  if (!planifier(initial, e, tr)) impossibles.push('L’horaire actuel ne se tient déjà pas (trajets plus longs que les battements) : la proposition part des contraintes réelles.');

  const trouve = deplacables.length <= EXACT_MAX ? exact(initial, e, tr, ordreInitial) : heuristique(initial, e, tr, ordreInitial, initial);
  if (!trouve) {
    impossibles.push('Aucun ordre ne respecte à la fois les visites fixes, les heures de travail et les temps de route.');
    return inchange();
  }
  const plan = planifier(trouve.seq, e, tr)!;
  const changements: Changement[] = [];
  for (const v of trouve.seq) {
    if (v.fixe) continue;
    const p = plan.get(v.id)!;
    if (p.debut !== v.debut || p.fin !== v.fin) changements.push({ visitId: v.id, jobId: v.jobId, titre: v.titre, avantDebut: v.debut, avantFin: v.fin, apresDebut: p.debut, apresFin: p.fin });
  }
  return {
    ...base,
    apres: { ordre: trouve.seq.map((v) => v.id), secondes: trouve.secondes, metres: trouve.metres },
    gainSecondes: Math.max(0, routeAvant.secondes - trouve.secondes),
    changements,
    impossibles,
  };
}
