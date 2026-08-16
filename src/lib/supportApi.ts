import { supabase } from './supabase';

export type SupportCategory = 'question' | 'bug' | 'billing' | 'feature' | 'other';

export interface SupportRequestInput {
  subject: string;
  message: string;
  category?: SupportCategory;
}

/** Délai de première réponse, dérivé du forfait côté serveur. */
export type SlaKey = '4h' | '1d' | '2d';

export interface SupportRequestResult {
  ok: true;
  priority: 'priority' | 'normal';
  /** Libellé anglais, destiné à l'email interne. Préférer `slaKey` à l'écran. */
  sla: string;
  /** Absent des serveurs antérieurs à l'ajout de la clé — traiter comme optionnel. */
  slaKey?: SlaKey;
}

/** Erreur enrichie : `code` permet de traduire, `supportEmail` d'offrir un repli. */
export interface SupportRequestError extends Error {
  code?: 'mailer_unconfigured' | 'send_failed';
  supportEmail?: string;
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

export async function submitSupportRequest(input: SupportRequestInput): Promise<SupportRequestResult> {
  const response = await fetch('/api/support', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Le message du serveur est anglais : on transporte `code` et
    // `supportEmail` pour que l'appelant le reformule dans la langue de l'UI.
    const err = new Error(data.error || 'Could not send your support request.') as SupportRequestError;
    err.code = data.code;
    err.supportEmail = data.supportEmail;
    throw err;
  }
  return data as SupportRequestResult;
}
