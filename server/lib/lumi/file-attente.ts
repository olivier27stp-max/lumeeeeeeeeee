/**
 * Garde de charge de Lumi : un nombre borné de tours d'agent EN MÊME TEMPS,
 * toutes entreprises réunies ; les suivants attendent leur place.
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-10-01, 20 h 36 → 21 h 41 UTC : la base de production n'a plus répondu
 * pendant 65 minutes. Huit conversations Lumi tournaient en même temps (des
 * batteries de test) ; chaque tour d'agent fait des dizaines d'appels à la
 * base — lectures d'outils, réservation et règlement du budget, messages,
 * traces — et la base tient sur une petite machine partagée avec l'API,
 * l'authentification et le temps réel. Quand Lumi déborde, ce n'est pas Lumi
 * qui tombe : c'est tout le CRM.
 *
 * Au-delà de `LUMI_TOURS_SIMULTANES` tours en cours (4 par défaut), un tour
 * attend son tour — premier arrivé, premier servi. S'il attend plus de
 * `LUMI_ATTENTE_PLACE_MS` (20 s), il reçoit un message clair et rien ne part au
 * modèle : mieux vaut un « réessaie dans une minute » qu'une base à genoux.
 * Les réponses sans modèle (aide écrite, raccourcis, actions directes) ne
 * passent pas par ici : elles restent servies.
 *
 * En mémoire, par processus : la prod n'en a qu'un. Un redéploiement remet la
 * file à zéro (les tours en vol sont coupés de toute façon).
 */

function entier(brut: string | undefined, defaut: number, min: number, max: number): number {
  const v = Number(brut);
  if (brut === undefined || brut === '' || !Number.isFinite(v)) return defaut;
  return Math.round(Math.min(max, Math.max(min, v)));
}

/** Tours d'agent menés en même temps. `LUMI_TOURS_SIMULTANES` (1 à 50, défaut 4). */
export function placesSimultanees(env: NodeJS.ProcessEnv = process.env): number {
  return entier(env.LUMI_TOURS_SIMULTANES, 4, 1, 50);
}

/** Attente maximale d'une place. `LUMI_ATTENTE_PLACE_MS` (1 à 120 s, défaut 20 s). */
export function attenteMaxMs(env: NodeJS.ProcessEnv = process.env): number {
  return entier(env.LUMI_ATTENTE_PLACE_MS, 20_000, 1_000, 120_000);
}

/** Aucune place ne s'est libérée à temps. */
export class LumiOccupe extends Error {
  constructor() { super('Lumi est occupé : aucune place libre dans le délai.'); this.name = 'LumiOccupe'; }
}

export interface FileDeTours {
  /** Prend une place (ou l'attend). Rend la fonction qui la libère ; l'appeler deux fois est sans effet. Lève `LumiOccupe` passé le délai. */
  prendre(): Promise<() => void>;
  etat(): { en_cours: number; en_attente: number };
}

export function creerFile(places: () => number, attenteMs: () => number): FileDeTours {
  let enCours = 0;
  const attente: Array<{ donner: () => void }> = [];

  const liberer = (): void => {
    const suivant = attente.shift();
    // La place passe directement au suivant : le compte ne bouge pas.
    if (suivant) suivant.donner();
    else enCours = Math.max(0, enCours - 1);
  };
  const uneFois = (): (() => void) => { let fait = false; return () => { if (fait) return; fait = true; liberer(); }; };

  return {
    prendre() {
      if (enCours < places()) { enCours += 1; return Promise.resolve(uneFois()); }
      return new Promise<() => void>((resoudre, rejeter) => {
        const entree = { donner: () => { clearTimeout(minuteur); resoudre(uneFois()); } };
        const minuteur = setTimeout(() => {
          const i = attente.indexOf(entree);
          if (i >= 0) attente.splice(i, 1);
          rejeter(new LumiOccupe());
        }, attenteMs());
        attente.push(entree);
      });
    },
    etat: () => ({ en_cours: enCours, en_attente: attente.length }),
  };
}

/** La file de la plateforme. */
export const fileLumi: FileDeTours = creerFile(() => placesSimultanees(), () => attenteMaxMs());

/** Gabarit (0 token) quand aucune place ne s'est libérée : rien n'a été fait, la personne peut réessayer. */
export function messageLumiOccupe(langue: 'fr' | 'en'): string {
  return langue === 'fr'
    ? 'Je suis très sollicité en ce moment : je n’ai pas pu prendre ta demande, rien n’a été fait. Réessaie dans une minute. Les actions rapides restent disponibles.'
    : 'I’m very busy right now: I couldn’t take your request, and nothing was done. Try again in a minute. Quick actions are still available.';
}
