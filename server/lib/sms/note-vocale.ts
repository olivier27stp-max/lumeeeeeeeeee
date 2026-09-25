/**
 * Notes vocales reçues par texto.
 * ───────────────────────────────
 * Un entrepreneur au volant n'écrit pas : il appuie sur le micro et parle.
 * Twilio livre alors un message dont le corps est VIDE et qui porte un
 * fichier audio (`NumMedia` > 0, `MediaUrl0`). Le webhook rejetait tout
 * message sans texte : ces vocaux disparaissaient sans trace.
 *
 * Ce module ne fait qu'une chose : reconnaître un vocal, aller chercher
 * l'audio chez Twilio et le rendre en texte, avec la transcription qui sert
 * déjà au micro de l'app (Gemini, prompt calibré sur le parler québécois des
 * métiers de service — « booké », « job », « cash » restent tels quels).
 *
 * Il ne décide RIEN de ce qu'on fait du texte : c'est l'appelant qui choisit
 * de le traiter comme un message de client ou comme une demande à Lumi.
 */
import { transcribeAudio, TRANSCRIBE_MIME_TYPES, type TranscribeMimeType } from '../agent/transcribe';
import { logger } from '../logger';

/** Au-delà, on ne télécharge pas : un vocal de patron fait quelques centaines de Ko. */
export const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;

/** Plafond de durée implicite : Twilio coupe déjà, c'est une ceinture de plus. */
export const SECONDES_MAX = 300;

export interface MediaEntrant {
  url: string;
  contentType: string;
}

/**
 * Les fichiers audio d'un message Twilio, dans l'ordre où ils arrivent.
 *
 * Twilio numérote ses médias (`MediaUrl0`, `MediaContentType0`, `MediaUrl1`…) ;
 * `NumMedia` arrive en texte, jamais en nombre.
 */
export function mediasAudio(corps: Record<string, any> | null | undefined): MediaEntrant[] {
  const n = Number.parseInt(String(corps?.NumMedia ?? '0'), 10);
  if (!Number.isFinite(n) || n <= 0) return [];

  const out: MediaEntrant[] = [];
  for (let i = 0; i < Math.min(n, 10); i += 1) {
    const url = corps?.[`MediaUrl${i}`];
    const contentType = String(corps?.[`MediaContentType${i}`] ?? '').toLowerCase().split(';')[0].trim();
    if (typeof url === 'string' && url.startsWith('https://') && contentType.startsWith('audio/')) {
      out.push({ url, contentType });
    }
  }
  return out;
}

/** true si ce message est une note vocale (audio, et rien d'utile écrit à côté). */
export function estNoteVocale(corps: Record<string, any> | null | undefined): boolean {
  return mediasAudio(corps).length > 0;
}

/**
 * Le type MIME que le transcripteur accepte, ou `null`.
 *
 * Twilio livre surtout de l'`audio/ogg` (Android) et de l'`audio/mp4`/`amr`
 * (iOS, MMS opérateur). L'AMR n'est PAS transcriptible tel quel : plutôt que
 * d'embarquer un convertisseur, on le déclare non pris en charge et on le dit
 * à la personne — un message clair vaut mieux qu'un silence.
 */
export function typeTranscriptible(contentType: string): TranscribeMimeType | null {
  const t = contentType.toLowerCase().split(';')[0].trim();
  // `audio/x-m4a` et `audio/m4a` sont du MP4 sous un autre nom.
  const alias: Record<string, TranscribeMimeType> = {
    'audio/m4a': 'audio/mp4',
    'audio/x-m4a': 'audio/mp4',
    'audio/mp3': 'audio/mpeg',
    'audio/vnd.wave': 'audio/wav',
    'audio/x-wav': 'audio/wav',
  };
  if (alias[t]) return alias[t];
  return (TRANSCRIBE_MIME_TYPES as readonly string[]).includes(t) ? (t as TranscribeMimeType) : null;
}

export type ResultatVocal =
  | { ok: true; texte: string; secondes: number | null }
  | { ok: false; raison: 'format_non_supporte' | 'trop_gros' | 'telechargement' | 'transcription' | 'vide' };

/**
 * Télécharge le média Twilio et le transcrit.
 *
 * Les URL de média sont protégées par l'authentification du compte Twilio :
 * sans en-tête Basic, on reçoit un 401 — et un 401 renvoie une page HTML, pas
 * de l'audio, d'où la vérification du type reçu.
 */
export async function transcrireMediaTwilio(
  media: MediaEntrant,
  opts: { accountSid: string; authToken: string; langue: 'fr' | 'en' },
): Promise<ResultatVocal> {
  const type = typeTranscriptible(media.contentType);
  if (!type) {
    logger.info('[sms/vocal] format audio non pris en charge', { contentType: media.contentType });
    return { ok: false, raison: 'format_non_supporte' };
  }

  let octets: ArrayBuffer;
  try {
    const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
    const rep = await fetch(media.url, { headers: { Authorization: `Basic ${auth}` } });
    if (!rep.ok) {
      logger.error('[sms/vocal] média illisible chez Twilio', { status: rep.status });
      return { ok: false, raison: 'telechargement' };
    }
    const taille = Number(rep.headers.get('content-length') ?? '0');
    if (taille > TAILLE_MAX_OCTETS) return { ok: false, raison: 'trop_gros' };

    octets = await rep.arrayBuffer();
    // `content-length` peut manquer : on revérifie sur ce qu'on a vraiment reçu.
    if (octets.byteLength > TAILLE_MAX_OCTETS) return { ok: false, raison: 'trop_gros' };
  } catch (e: any) {
    logger.error('[sms/vocal] téléchargement du média en échec', { error: e?.message || String(e) });
    return { ok: false, raison: 'telechargement' };
  }

  try {
    const texte = (await transcribeAudio({
      base64: Buffer.from(octets).toString('base64'),
      mimeType: type,
      language: opts.langue,
    })).trim();
    if (!texte) return { ok: false, raison: 'vide' };
    return { ok: true, texte, secondes: null };
  } catch (e: any) {
    logger.error('[sms/vocal] transcription en échec', { error: e?.message || String(e) });
    return { ok: false, raison: 'transcription' };
  }
}

/**
 * Ce qu'on répond quand un vocal n'a pas pu être lu.
 *
 * Toujours quelque chose : un silence, l'expéditeur le lit comme « il m'a
 * ignoré ». Et jamais de terme technique — c'est la règle de présentation de
 * Lumi, elle vaut aussi ici.
 */
export function messageEchecVocal(raison: Exclude<ResultatVocal, { ok: true }>['raison'], langue: 'fr' | 'en'): string {
  const fr = langue !== 'en';
  switch (raison) {
    case 'format_non_supporte':
      return fr
        ? "Je n'arrive pas à lire ce message vocal. Réessaie en l'écrivant, ou envoie-le depuis l'application."
        : "I can't read that voice message. Try writing it, or send it from the app.";
    case 'trop_gros':
      return fr
        ? 'Ton message vocal est trop long pour moi. Envoie-m\'en un plus court, ou écris-le.'
        : 'That voice message is too long for me. Send a shorter one, or write it out.';
    case 'vide':
      return fr
        ? "Je n'ai rien entendu dans ton message. Réessaie ?"
        : "I didn't hear anything in your message. Try again?";
    default:
      return fr
        ? "Je n'ai pas réussi à écouter ton message. Réessaie dans un instant, ou écris-le-moi."
        : "I couldn't listen to your message. Try again shortly, or write it to me.";
  }
}
