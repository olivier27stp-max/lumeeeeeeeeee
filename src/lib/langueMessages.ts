/* ═══════════════════════════════════════════════════════════════
   LA LANGUE DES MESSAGES DU BUREAU — une seule source d'état.

   Deux écrans la montrent : le sélecteur « FR / EN » de la liste des
   automatisations (qui la change) et la carte « Langue des messages » des
   Réglages globaux (qui la montre, et renvoie à Paramètres › Entreprise).
   Chacun gardait SON état, lu en base à son affichage. En usage courant
   les deux se suivaient ; mais cliquer « EN » puis ouvrir aussitôt les
   Réglages globaux lisait la base AVANT que l'écriture n'y arrive : la
   carte disait « Français » jusqu'au rechargement de la page, alors que la
   liste — et la base — disaient anglais (mesuré au navigateur,
   `06-reglages-globaux:116`).

   Ici, une valeur partagée :
   · un écran qui s'affiche la relit en base — SAUF si une écriture est en
     vol : il montre alors la langue qu'on vient de choisir, celle que la
     base aura ;
   · l'écriture est optimiste (l'écran suit le clic) et revient en arrière
     si le serveur refuse ;
   · tous les écrans abonnés sont prévenus au même instant.
   ═══════════════════════════════════════════════════════════════ */

import { getAutomationLanguage, setAutomationLanguage } from './automationRulesApi';

export type LangueMessages = 'fr' | 'en';

export interface EtatLangueMessages {
  /** `null` = pas (encore) connue. */
  langue: LangueMessages | null;
  /** La dernière lecture a échoué : on ne prétend ni « Français » ni « English ». */
  illisible: boolean;
  /** Une écriture est en vol. */
  ecriture: boolean;
}

let etat: EtatLangueMessages = { langue: null, illisible: false, ecriture: false };
const abonnes = new Set<() => void>();
/** Seule la DERNIÈRE lecture écrit l'état (deux écrans, un changement de bureau). */
let lectures = 0;

function poser(suivant: Partial<EtatLangueMessages>): void {
  etat = { ...etat, ...suivant };
  for (const prevenir of abonnes) prevenir();
}

export function etatLangueMessages(): EtatLangueMessages {
  return etat;
}

export function sAbonnerLangueMessages(prevenir: () => void): () => void {
  abonnes.add(prevenir);
  return () => { abonnes.delete(prevenir); };
}

/**
 * Relit la langue en base — ce que fait un écran qui s'affiche.
 * Écriture en vol : rien n'est lu (la base n'a pas encore la valeur choisie), l'état garde le choix.
 * `etiquette` : le préfixe du journal de l'écran qui lit (chaque écran garde le sien).
 */
export async function relireLangueMessages(etiquette: string): Promise<void> {
  if (etat.ecriture) return;
  const numero = ++lectures;
  // D'un bureau à l'autre, la langue d'avant ne doit pas rester affichée le temps de la lecture.
  poser({ langue: null, illisible: false });
  try {
    const langue = await getAutomationLanguage();
    if (numero !== lectures || etat.ecriture) return;
    poser({ langue, illisible: false });
  } catch (e: unknown) {
    if (numero !== lectures || etat.ecriture) return;
    console.error(etiquette, e);
    poser({ langue: null, illisible: true });
  }
}

/**
 * Change la langue. L'état suit aussitôt ; il revient en arrière si l'écriture échoue (et l'erreur est
 * relancée : l'écran qui a cliqué dit pourquoi).
 */
export async function changerLangueMessages(langue: LangueMessages): Promise<void> {
  const avant = etat;
  // Une lecture partie avant ce clic ne doit pas écraser le choix.
  lectures += 1;
  poser({ langue, ecriture: true });
  try {
    await setAutomationLanguage(langue);
    // Enregistrée : elle est maintenant connue, même si la lecture avait échoué.
    poser({ langue, illisible: false, ecriture: false });
  } catch (e: unknown) {
    poser({ langue: avant.langue, illisible: avant.illisible, ecriture: false });
    throw e;
  }
}

/** Pour les tests : repart d'un état vierge (l'état vit au niveau du module). */
export function reinitialiserLangueMessages(): void {
  lectures += 1;
  etat = { langue: null, illisible: false, ecriture: false };
}
