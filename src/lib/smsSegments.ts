/* ═══════════════════════════════════════════════════════════════
   Combien de SMS un texto est-il facturé ?

   Twilio facture par SEGMENT, et la taille d'un segment dépend des
   caractères : 160 (puis 153 par segment) tant que tout tient dans
   l'alphabet GSM-7 ; 70 (puis 67) dès qu'UN SEUL caractère en sort.
   En français ça arrive vite : « ê », « ç », « ô », « ’ » et les émojis
   n'y sont pas. « Bonjour, à bientôt » compte donc par tranches de 70.

   Diviser la longueur par 160 annonçait « 2 SMS » pour un texte facturé 3.

   Même calcul que `segmentsSms` côté serveur
   (server/lib/desabonnement/mention-sms.ts) — `src/` ne peut pas importer
   `server/`, la parité est tenue par un test.
   ═══════════════════════════════════════════════════════════════ */

const GSM7_BASE =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENSION = '^{}\\[~]|€\f';

export interface SegmentsSms {
  encodage: 'GSM-7' | 'UCS-2';
  /** Unités comptées par l'opérateur (un caractère étendu en vaut deux). */
  unites: number;
  /** Nombre de SMS facturés. */
  segments: number;
}

export function segmentsSms(texte: string): SegmentsSms {
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

/**
 * « 2 SMS », à afficher à côté du compteur — `null` tant qu'un seul SMS part.
 * La liste et l'éditeur plein écran passent tous deux par ici : le même texte
 * ne peut pas coûter « 2 SMS » sur un écran et rien sur l'autre.
 */
export function libelleSegments(texte: string, fr: boolean): string | null {
  const { encodage, segments } = segmentsSms(texte);
  if (segments <= 1) return null;
  if (encodage === 'GSM-7') return `${segments} SMS`;
  return fr
    ? `${segments} SMS (accent spécial ou émoji : 67 caractères par SMS)`
    : `${segments} SMS (special accent or emoji: 67 characters per SMS)`;
}
