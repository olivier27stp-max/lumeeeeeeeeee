/* ═══════════════════════════════════════════════════════════════
   Lume Agent — transcription vocale
   ─────────────────────────────────────────────────────────────
   Le navigateur enregistre l'audio (MediaRecorder) et l'envoie au
   serveur ; Gemini reçoit l'audio en ligne (inlineData) et renvoie la
   transcription. Aucune clé ne quitte le serveur, aucun fournisseur
   de plus que celui de l'agent.
   Docs : https://ai.google.dev/gemini-api/docs/audio
   ═══════════════════════════════════════════════════════════════ */

import { geminiApiKey } from '../config';

/* Pro transcrit juste les noms propres et les montants là où Flash se trompe
   (mesuré sur un échantillon québécois : « Côté », « Tremblay », « 8 h 30 »).
   Il prend ~5 s au lieu de ~2 s ; le texte est relu avant l'envoi, la
   justesse compte plus que la vitesse. Surcharge possible par variable d'env. */
import { usageDeReponseGemini, type GeminiUsage } from './gemini';

const TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-pro';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Types audio que les navigateurs produisent avec MediaRecorder. */
export const TRANSCRIBE_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'] as const;
export type TranscribeMimeType = (typeof TRANSCRIBE_MIME_TYPES)[number];

const PROMPT = {
  fr: `Tu transcris un enregistrement vocal. Contexte : la personne dirige une entreprise de services (lavage de vitres, toiture, paysagement, CVAC…) au Québec et parle à son logiciel de gestion. Elle parle en français québécois, parfois avec des mots anglais (job, cash, lead, booké…) : garde-les tels quels.
Vocabulaire fréquent : soumission, devis, facture, client, job, calendrier, horaire, rendez-vous, paie, feuille de temps, relance, rappel, texto, courriel, équipe, tournée, dispatch.
Règles : transcris mot pour mot ce qui est dit, avec la ponctuation, sans rien résumer ni corriger le sens. Écris les nombres en chiffres (« 3 factures », « 1 250 $ », « 8 h 30 »). Ne réponds pas à la personne, ne commente pas, ne traduis pas. Si tu hésites sur un mot, écris ce que tu entends. Si l'audio est vide ou inaudible, renvoie une chaîne vide.`,
  en: `You transcribe a voice recording. Context: the speaker runs a home-service business (window cleaning, roofing, landscaping, HVAC…) in Canada and is talking to their management software. Frequent words: quote, invoice, client, job, calendar, schedule, appointment, payroll, timesheet, follow-up, reminder, text, email, team, route, dispatch.
Rules: transcribe word for word what is said, with punctuation, without summarizing or correcting the meaning. Write numbers as digits ("3 invoices", "$1,250", "8:30"). Do not answer the speaker, do not comment, do not translate. If unsure about a word, write what you hear. If the audio is empty or inaudible, return an empty string.`,
} as const;

/* ── Un enregistrement sans voix n'est pas envoyé au modèle ─────────────────
   Batterie de robustesse du 2026-10-01 : une seconde de silence envoyée à la
   route revenait avec « Ok, affiche-moi la liste des clients qui ont une
   facture en retard. ». Devant un audio vide, le modèle ne renvoie pas la
   chaîne vide que la consigne demande : il invente une phrase plausible à
   partir du contexte du prompt — et cette phrase part dans la boîte de Lumi
   comme une demande de la personne.

   Le micro de l'app envoie du WAV PCM 16 bits (useVoiceInput.ts) : le niveau
   sonore se lit donc ici, sans décodeur. Aucune tranche de 100 ms au-dessus du
   seuil = rien à transcrire, texte vide, aucun appel payé. Le seuil est la
   MOITIÉ de celui du micro (SILENCE_RMS = 0,012) : le rééchantillonnage par
   moyenne baisse un peu le niveau, et un enregistrement que l'app a jugé
   parlé ne doit jamais être écarté ici. Tout ce qui n'est pas un WAV PCM
   16 bits lisible (note vocale reçue par texto, autre format) passe au modèle
   comme avant. */
const SEUIL_VOIX_RMS = 0.006;
const TRANCHE_MS = 100;

/** Vrai si le WAV PCM 16 bits ne contient aucune tranche au-dessus du seuil de voix. */
export function wavSansVoix(audio: Buffer): boolean {
  if (audio.length < 44 || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') return false;
  let format = 0, canaux = 0, taux = 0, bits = 0, debut = -1, taille = 0;
  for (let o = 12; o + 8 <= audio.length;) {
    const id = audio.toString('latin1', o, o + 4);
    const longueur = audio.readUInt32LE(o + 4);
    if (id === 'fmt ' && o + 24 <= audio.length) {
      format = audio.readUInt16LE(o + 8);
      canaux = audio.readUInt16LE(o + 10);
      taux = audio.readUInt32LE(o + 12);
      bits = audio.readUInt16LE(o + 22);
    } else if (id === 'data') {
      debut = o + 8;
      taille = Math.min(longueur, audio.length - debut);
      break;
    }
    o += 8 + longueur + (longueur % 2);
  }
  if (format !== 1 || bits !== 16 || canaux < 1 || taux < 1 || debut < 0) return false;
  const echantillons = Math.floor(taille / 2);
  if (echantillons === 0) return true;
  const parTranche = Math.max(1, Math.round((taux * canaux * TRANCHE_MS) / 1000));
  const seuilCarre = SEUIL_VOIX_RMS * SEUIL_VOIX_RMS;
  for (let i = 0; i < echantillons; i += parTranche) {
    const fin = Math.min(echantillons, i + parTranche);
    let somme = 0;
    for (let j = i; j < fin; j++) {
      const x = audio.readInt16LE(debut + j * 2) / 0x8000;
      somme += x * x;
    }
    if (somme / (fin - i) > seuilCarre) return false;
  }
  return true;
}

export async function transcribeAudio(opts: {
  /** Audio encodé en base64 (sans préfixe data:). */
  base64: string;
  mimeType: TranscribeMimeType;
  language: 'fr' | 'en';
}): Promise<string> {
  return (await transcribeAudioAvecUsage(opts)).text;
}

/** Même transcription, avec les compteurs de tokens Gemini pour la trace (lumi_traces). */
export async function transcribeAudioAvecUsage(opts: {
  base64: string;
  mimeType: TranscribeMimeType;
  language: 'fr' | 'en';
}): Promise<{ text: string; usage: GeminiUsage | null; model: string; requestId: string | null }> {
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  if (opts.mimeType === 'audio/wav' && wavSansVoix(Buffer.from(opts.base64, 'base64'))) {
    return { text: '', usage: null, model: TRANSCRIBE_MODEL, requestId: null };
  }
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: opts.mimeType, data: opts.base64 } },
          { text: PROMPT[opts.language] },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      // Pro exige un budget de réflexion > 0 ; on le garde petit. Flash n'en a
      // pas besoin pour transcrire.
      thinkingConfig: { thinkingBudget: /pro/i.test(TRANSCRIBE_MODEL) ? 512 : 0 },
    },
  };
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(TRANSCRIBE_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let message = `Transcription failed (${res.status}).`;
    try { message = JSON.parse(errText)?.error?.message || message; } catch { /* garder le message par défaut */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: unknown; responseId?: string };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !(p as { thought?: boolean }).thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  // `responseId` : un même appel n'est débité qu'une fois (grand livre des crédits Lumi).
  return { text, usage: usageDeReponseGemini(json), model: TRANSCRIBE_MODEL, requestId: typeof json.responseId === 'string' ? json.responseId : null };
}
