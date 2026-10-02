/**
 * File de bascule « Brouillon / Publiée », une par automatisation.
 *
 * Rafba, 2026-09-28 : « même si j'en spam plein, ça ne devrait jamais
 * bugger ». Avant : chaque clic envoyait sa requête tout de suite, calculée
 * sur un état parfois périmé ; les réponses revenaient dans le désordre et
 * l'écran pouvait dire « Publiée » pendant que la base disait « Brouillon ».
 *
 * Ici :
 *   · l'écran suit le DERNIER clic, tout de suite (l'appelant l'affiche) ;
 *   · une seule requête en vol par automatisation ; à son retour, si l'état
 *     voulu a changé entre-temps, on envoie le nouvel état — jamais deux en
 *     parallèle, donc jamais de réponse qui en écrase une plus récente ;
 *   · 15 clics = au plus 2 requêtes (celle en vol + le dernier état voulu) ;
 *   · un échec ramène l'écran au dernier état CONFIRMÉ par le serveur.
 */
export interface OptionsFileBascule {
  /** Ce que l'envoi rend n'est pas lu ici (`changerPublication` rend la version de la règle). */
  envoyer: (id: string, actif: boolean) => Promise<unknown>;
  /** La base a l'état voulu ; plus rien en vol pour cet id. */
  surFin?: (id: string, actif: boolean) => void;
  /** Échec : `retour` est le dernier état confirmé, à réafficher. */
  surEchec?: (id: string, retour: boolean, erreur: unknown) => void;
}

interface Etat { confirme: boolean; voulu: boolean; enVol: boolean }

export function creerFileBascule(options: OptionsFileBascule) {
  const etats = new Map<string, Etat>();

  async function vider(id: string, e: Etat) {
    e.enVol = true;
    try {
      while (e.voulu !== e.confirme) {
        const cible = e.voulu;
        await options.envoyer(id, cible);
        e.confirme = cible;
      }
      e.enVol = false;
      options.surFin?.(id, e.confirme);
    } catch (erreur) {
      e.voulu = e.confirme;
      e.enVol = false;
      options.surEchec?.(id, e.confirme, erreur);
    }
  }

  return {
    /** L'état à AFFICHER : le dernier voulu si une bascule est en cours. */
    etatAffiche(id: string, etatServeur: boolean): boolean {
      const e = etats.get(id);
      return e?.enVol ? e.voulu : etatServeur;
    },
    enCours(id: string): boolean {
      return etats.get(id)?.enVol ?? false;
    },
    /**
     * Inverse l'état et rend le nouvel état voulu (à afficher tout de suite).
     * `etatServeur` = ce que l'écran croit confirmé ; ignoré pendant une
     * bascule en vol (la file fait foi).
     */
    basculer(id: string, etatServeur: boolean): boolean {
      let e = etats.get(id);
      if (!e) { e = { confirme: etatServeur, voulu: etatServeur, enVol: false }; etats.set(id, e); }
      else if (!e.enVol) { e.confirme = etatServeur; e.voulu = etatServeur; }
      e.voulu = !e.voulu;
      if (!e.enVol) void vider(id, e);
      return e.voulu;
    },
  };
}
