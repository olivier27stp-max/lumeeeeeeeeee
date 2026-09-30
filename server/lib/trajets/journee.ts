/**
 * Les trajets de l'horaire, tels qu'ils sont PLANIFIÉS (audit Agenda, 2026-09-30).
 *
 * Pur : reçoit les visites et une matrice de trajets, rend pour chaque jour
 * (au fuseau de l'entreprise) et chaque équipe la suite des arrêts dans
 * l'ORDRE CHRONOLOGIQUE — le parcours réel du technicien, pas un ordre
 * « optimisé » qu'il ne suivra pas — avec deux alertes :
 *
 *  - chevauchement : une visite commence avant la fin de la précédente ;
 *  - trajet impossible : la route entre deux visites prend plus de temps que
 *    le battement entre la fin de l'une et le début de l'autre.
 *
 * Exclues du trajet : visites annulées. Sans coordonnées utilisables : listées
 * dans « adresses à corriger », jamais placées à 0,0 ni ignorées en silence.
 */
import type { Point, Trajet } from './matrice';

export interface VisiteTrajet {
  visitId: string;
  jobId: string | null;
  teamId: string | null;
  debut: string;            // ISO, instant réel
  fin: string;              // ISO, instant réel
  statut: string;           // statut de la visite
  titre: string;
  client: string | null;
  adresse: string | null;
  point: Point | null;
}

export type Alerte = 'chevauchement' | 'trajet_impossible';

export interface Arret extends Omit<VisiteTrajet, 'point'> {
  ordre: number;
  lat: number;
  lng: number;
  /** Route depuis l'arrêt précédent de l'équipe ce jour-là (null pour le premier). */
  depuisPrecedent: Trajet | null;
  alertes: Alerte[];
}

export interface TrajetEquipe {
  teamId: string | null;
  arrets: Arret[];
  totalMetres: number;
  totalSecondes: number;
  /** Au moins un tronçon est une estimation (OSRM indisponible). */
  estime: boolean;
  alertes: number;
}

export interface JourTrajets {
  jour: string;             // AAAA-MM-JJ au fuseau de l'entreprise
  equipes: TrajetEquipe[];
  aCorriger: Array<Omit<VisiteTrajet, 'point'>>;
}

const STATUTS_EXCLUS = new Set(['cancelled', 'canceled', 'annulee', 'annulée']);

export function jourDans(iso: string, fuseau: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Ordre chronologique stable : début, puis fin, puis identifiant. */
export function ordreChronologique<T extends { debut: string; fin: string; visitId: string }>(a: T, b: T): number {
  return new Date(a.debut).getTime() - new Date(b.debut).getTime()
    || new Date(a.fin).getTime() - new Date(b.fin).getTime()
    || a.visitId.localeCompare(b.visitId);
}

/**
 * @param trajet renvoie la route entre deux points (lue dans la matrice en cache).
 */
export function trajetsParJour(
  visites: VisiteTrajet[],
  fuseau: string,
  trajet: (a: Point, b: Point) => Trajet,
): JourTrajets[] {
  const jours = new Map<string, Map<string, VisiteTrajet[]>>();
  for (const v of visites) {
    if (STATUTS_EXCLUS.has(String(v.statut || '').toLowerCase())) continue;
    const jour = jourDans(v.debut, fuseau);
    const parEquipe = jours.get(jour) ?? new Map<string, VisiteTrajet[]>();
    const k = v.teamId ?? '';
    parEquipe.set(k, [...(parEquipe.get(k) ?? []), v]);
    jours.set(jour, parEquipe);
  }

  return [...jours.keys()].sort().map((jour) => {
    const aCorriger: JourTrajets['aCorriger'] = [];
    const equipes = [...jours.get(jour)!.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([k, liste]): TrajetEquipe => {
        const tries = [...liste].sort(ordreChronologique);
        const arrets: Arret[] = [];
        let precedente: VisiteTrajet | null = null;     // précédente visite (géocodée ou non) : chevauchements
        let precedentArret: Arret | null = null;         // précédent arrêt géocodé : route
        let totalMetres = 0, totalSecondes = 0, estime = false, alertes = 0;
        for (const v of tries) {
          const { point, ...reste } = v;
          const chevauche = !!precedente && new Date(v.debut).getTime() < new Date(precedente.fin).getTime();
          if (!point) {
            aCorriger.push(reste);
            // Le chevauchement reste signalé sur la visite suivante via `precedente`.
            precedente = v;
            continue;
          }
          const depuis = precedentArret ? trajet({ lat: precedentArret.lat, lng: precedentArret.lng }, point) : null;
          const alertesArret: Alerte[] = [];
          if (chevauche) alertesArret.push('chevauchement');
          if (depuis && precedentArret && !chevauche) {
            const battementS = (new Date(v.debut).getTime() - new Date(precedentArret.fin).getTime()) / 1000;
            if (depuis.secondes > battementS) alertesArret.push('trajet_impossible');
          }
          if (depuis) { totalMetres += depuis.metres; totalSecondes += depuis.secondes; estime = estime || depuis.estime; }
          alertes += alertesArret.length;
          const arret: Arret = { ...reste, ordre: arrets.length + 1, lat: point.lat, lng: point.lng, depuisPrecedent: depuis, alertes: alertesArret };
          arrets.push(arret);
          precedentArret = arret;
          precedente = v;
        }
        return { teamId: k || null, arrets, totalMetres, totalSecondes, estime, alertes };
      })
      .filter((e) => e.arrets.length > 0);
    return { jour, equipes, aCorriger };
  });
}
