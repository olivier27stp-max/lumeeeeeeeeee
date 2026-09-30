/**
 * Mention obligatoire d'un texto COMMERCIAL (audit V2, L7).
 *
 * La LCAP exige qu'un message électronique commercial identifie son
 * expéditeur et offre un moyen de retrait. Pour un texto, c'est le nom de
 * l'entreprise et « Répondez STOP ». Rien n'était ajouté : tout dépendait du
 * texte saisi dans l'automatisation, et la publication n'exigeait rien.
 *
 * On l'ajoute donc automatiquement, et SEULEMENT aux textos commerciaux :
 * un rappel de rendez-vous ou une confirmation n'en a pas besoin.
 *
 * Longueur : la mention est écrite en caractères GSM-7 seulement (pas de
 * tiret long, pas de guillemets français) — un seul caractère hors GSM-7
 * ferait passer TOUT le texto en UCS-2, où un segment ne tient plus que
 * 70 caractères au lieu de 160 : le coût triplerait pour un tiret.
 */

export type Langue = 'fr' | 'en';

/** La phrase de retrait, sans l'identification. */
export function phraseStop(langue: Langue): string {
  return langue === 'en' ? 'Reply STOP to opt out.' : 'Répondez STOP pour ne plus recevoir.';
}

/** Un nom d'entreprise très long mangerait un segment entier. */
const NOM_MAX = 40;

/**
 * Le texte contient-il déjà une consigne de retrait ? En MAJUSCULES
 * seulement : « stop by our store » n'en est pas une.
 */
function aDejaStop(texte: string): boolean {
  return /\b(STOP|ARR[EÊ]T)\b/.test(texte);
}

/**
 * Le texto tel qu'il part : le corps, puis, sur une nouvelle ligne,
 * « <Entreprise> - Répondez STOP pour ne plus recevoir. ».
 *
 * Ce qui y est déjà n'est pas répété : un corps qui dit déjà STOP ne reçoit
 * pas une deuxième consigne ; un corps qui nomme déjà l'entreprise ne la
 * renomme pas.
 */
export function avecMentionCommerciale(corps: string, nomEntreprise: string | null | undefined, langue: Langue): string {
  const texte = corps.trimEnd();
  let nom = String(nomEntreprise ?? '').replace(/\s+/g, ' ').trim();
  if (nom.length > NOM_MAX) nom = nom.slice(0, NOM_MAX).trimEnd();
  const nomPresent = !nom || texte.toLowerCase().includes(nom.toLowerCase());
  const stopPresent = aDejaStop(texte);
  if (nomPresent && stopPresent) return texte;

  const morceaux: string[] = [];
  if (!nomPresent) morceaux.push(nom);
  if (!stopPresent) morceaux.push(phraseStop(langue));
  return `${texte}\n${morceaux.join(' - ')}`;
}

// ── Segments ────────────────────────────────────────────────

// Le calcul vit dans src/lib/smsSegments.ts : l'éditeur de texto l'affiche
// à l'entrepreneur, le serveur s'en sert pour la mention (même règle).
export { segmentsSms } from '../../../src/lib/smsSegments';
