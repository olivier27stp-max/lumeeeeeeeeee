import { useEffect, useSyncExternalStore } from 'react';
import {
  changerLangueMessages, etatLangueMessages, relireLangueMessages, sAbonnerLangueMessages,
  type EtatLangueMessages, type LangueMessages,
} from '../lib/langueMessages';

/**
 * La langue des messages du bureau, PARTAGÉE entre les écrans qui la montrent (voir `lib/langueMessages.ts`).
 * L'écran qui s'affiche la relit ; `etiquette` est le préfixe de son journal en cas d'échec de lecture.
 */
export function useLangueMessages(etiquette: string): EtatLangueMessages & { changer: (langue: LangueMessages) => Promise<void> } {
  const etat = useSyncExternalStore(sAbonnerLangueMessages, etatLangueMessages, etatLangueMessages);
  useEffect(() => { void relireLangueMessages(etiquette); }, [etiquette]);
  return { ...etat, changer: changerLangueMessages };
}
