// Signalement des erreurs du mobile.
//
// Le web envoie les siennes à Sentry; le mobile n'avait rien, donc une panne
// chez un employé n'était connue de personne. Brancher @sentry/react-native
// demanderait de lier un module natif, ce que la chaîne de build ne permet pas
// ici — alors on poste au serveur, qui a déjà Sentry (POST /api/client-errors).
//
// Règle absolue : signaler ne doit JAMAIS provoquer une seconde erreur, ni
// bloquer l'utilisateur. Tout est en « au mieux », sans await côté appelant.

import { supabase } from './supabase';

const BASE = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') ?? '';

/** Pannes réseau ordinaires : les signaler noierait le vrai signal. */
const BRUIT = [
  'network request failed',
  'aborted',
  'timeout',
  'failed to fetch',
  'load failed',
];

// Une même erreur qui se répète (écran qui reboucle) ne part qu'une fois.
const dejaVues = new Set<string>();

function estDuBruit(message: string): boolean {
  const m = message.toLowerCase();
  return BRUIT.some((b) => m.includes(b));
}

export async function signalerErreur(
  erreur: unknown,
  contexte?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!BASE) return;
    const err = erreur instanceof Error ? erreur : new Error(String(erreur));
    const message = (err.message ?? '').trim();
    if (!message || estDuBruit(message)) return;

    const empreinte = `${message}::${contexte?.source ?? ''}`;
    if (dejaVues.has(empreinte)) return;
    dejaVues.add(empreinte);
    if (dejaVues.size > 200) dejaVues.clear();

    const { data } = await supabase.auth.getSession();
    const jeton = data.session?.access_token;
    if (!jeton) return; // la route exige une session

    await fetch(`${BASE}/api/client-errors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack: err.stack ?? null, contexte: contexte ?? {} }),
    });
  } catch {
    // Silence volontaire : un échec de signalement n'est pas un incident.
  }
}

/** Branche le gestionnaire global de React Native : tout ce qui remonte
 *  jusqu'à l'exécution (plantage d'écran, promesse non gérée) est signalé. */
export function installerGestionnaireGlobal(): void {
  const g = globalThis as any;
  if (!g.ErrorUtils?.setGlobalHandler || g.__lumeGestionnaireErreurs) return;
  g.__lumeGestionnaireErreurs = true;

  const precedent = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((erreur: unknown, fatale?: boolean) => {
    void signalerErreur(erreur, { source: 'global', fatale: !!fatale });
    precedent?.(erreur, fatale);
  });
}
