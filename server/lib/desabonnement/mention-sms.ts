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

const GSM7_BASE =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENSION = '^{}\\[~]|€\f';

/**
 * Nombre de segments facturés pour un texto (GSM-7 : 160, puis 153 par
 * segment ; UCS-2 : 70, puis 67). Sert à vérifier que la mention ne fait pas
 * basculer l'encodage.
 */
export function segmentsSms(texte: string): { encodage: 'GSM-7' | 'UCS-2'; unites: number; segments: number } {
  let unites = 0;
  let gsm = true;
  for (const c of texte) {
    if (GSM7_BASE.includes(c)) unites += 1;
    else if (GSM7_EXTENSION.includes(c)) unites += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encodage: 'GSM-7', unites, segments: unites <= 160 ? 1 : Math.ceil(unites / 153) };
  const u = texte.length; // unités UTF-16
  return { encodage: 'UCS-2', unites: u, segments: u <= 70 ? 1 : Math.ceil(u / 67) };
}
