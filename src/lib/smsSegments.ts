/**
 * Encodage et nombre de segments FACTURÉS d'un texto.
 *
 * GSM-7 : 160 caractères, puis 153 par segment ; UCS-2 : 70, puis 67. Un
 * seul caractère hors GSM-7 (ê â î ô û ç ë ï, ’, « ») fait passer TOUT le
 * texto en UCS-2 — le coût peut doubler ou tripler pour un accent.
 * Partagé : l'éditeur de texto (MessageEditor) et le serveur (mention STOP).
 */
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
