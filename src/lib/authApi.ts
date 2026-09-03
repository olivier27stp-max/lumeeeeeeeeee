/**
 * Parcours « mot de passe » — tout passe par NOTRE serveur, pas par le flux
 * intégré de Supabase (lien PKCE inutilisable depuis un autre appareil,
 * 2 courriels/heure sans SMTP dédié, URL de retour absente de la liste
 * blanche en prod). Voir server/routes/auth.ts.
 */
import { supabase } from './supabase';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

export class AuthApiError extends Error {
  status: number;
  /** Code stable renvoyé par le serveur (invalid_link, expired_link, wrong_current…). */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

async function lire<T = Record<string, unknown>>(res: Response): Promise<T> {
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthApiError(String(data?.error || 'Request failed.'), res.status, data?.code);
  return data as T;
}

/** Envoie le lien « choisir un nouveau mot de passe ». Ne révèle jamais si l'adresse existe. */
export async function forgotPassword(email: string): Promise<void> {
  await lire(await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  }));
}

/** Pose le mot de passe depuis le lien reçu par courriel. */
export async function resetPassword(params: { email: string; token: string; password: string }): Promise<void> {
  await lire(await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  }));
}

/**
 * Définit (compte Google sans mot de passe) ou change (mot de passe actuel
 * exigé) le mot de passe de l'utilisateur connecté.
 */
export async function setPassword(params: { currentPassword?: string; newPassword: string }): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  await lire(await fetch('/api/auth/set-password', {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(params),
  }));
}

export interface SignInMethods {
  email: string;
  /** Une identité Google est rattachée au compte. */
  google: boolean;
  /** Le compte peut se connecter par courriel + mot de passe. */
  hasPassword: boolean;
}

/**
 * Moyens de connexion du compte courant. Lit l'utilisateur FRAIS (pas le jeton
 * en cache) : `has_password` est posé dans app_metadata par le serveur et
 * n'apparaît dans le JWT qu'au prochain rafraîchissement.
 */
export async function getSignInMethods(): Promise<SignInMethods> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error(error?.message || 'Not signed in.');
  const providers = (user.identities || []).map((i) => i.provider);
  return {
    email: user.email || '',
    google: providers.includes('google'),
    hasPassword: providers.includes('email') || (user.app_metadata as any)?.has_password === true,
  };
}
