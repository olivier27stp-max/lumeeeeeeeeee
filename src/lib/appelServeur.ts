import { interfaceEnFrancais } from './champs/messages';

/**
 * `fetch`, mais une coupure réseau se dit en mots (audit V2, A-11).
 *
 * Réseau coupé, `fetch` lève un `TypeError` (« Failed to fetch ») : c'est ce
 * texte brut, en anglais, qui finissait dans les toasts de la liste et du
 * bandeau de pause. Rien n'est parti au serveur : on le dit.
 */
export async function appelServeur(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: unknown) {
    if (e instanceof TypeError) {
      throw new Error(interfaceEnFrancais()
        ? 'Connexion perdue — vérifiez votre réseau et réessayez. Rien n’a été modifié.'
        : 'Connection lost — check your network and try again. Nothing was changed.');
    }
    throw e;
  }
}
