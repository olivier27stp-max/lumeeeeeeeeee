/**
 * Le VRAI moteur d'automatisations, démarré dans le processus de test contre
 * staging, pour le bureau de test seulement.
 *
 * Aucune pièce du moteur n'est simulée : bus d'événements, évaluation des
 * conditions, actions, file planifiée, journaux. Seuls les FOURNISSEURS
 * (Twilio, SMTP, HTTP) sont des pièges — et le bureau de test est en bac à
 * sable, donc ses envois s'arrêtent avant eux, dans `envois_simules`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest, NUMERO_A, type BureauTest } from './bureau-test';

export interface AppelPiege { to: string; body: string; from?: string }

/** Chaque appel qui atteint le client Twilio « réel » (le piège). */
export const appelsTwilio: AppelPiege[] = [];

/** Le client Twilio sous le bac à sable : compte et refuse tout. */
export const clientTwilioPiege = {
  messages: {
    create: async (opts: AppelPiege) => {
      appelsTwilio.push(opts);
      throw new Error('PIÈGE : un texto a atteint le fournisseur réel');
    },
  },
};

export function appelsHttpBloques(): Array<{ url: string; quand: string }> {
  return (globalThis as { __appelsBloques?: Array<{ url: string; quand: string }> }).__appelsBloques ?? [];
}

let pret: Promise<BureauTest & { eventBus: typeof import('../../../server/lib/eventBus')['eventBus'] }> | null = null;

/** Démarre (une fois) le moteur et le bureau de test. */
export function demarrerMoteur() {
  pret ??= (async () => {
    const bureau = await assurerBureauTest();
    const { envelopperBacASable, oublierBacASable } = await import('../../../server/lib/bac-a-sable');
    oublierBacASable();
    const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    initAutomationEngine({
      supabase: bureau.admin,
      twilio: { client: envelopperBacASable(clientTwilioPiege)!, phoneNumber: NUMERO_A },
      baseUrl: process.env.PUBLIC_URL || 'https://staging.lume-qa.test',
    } as never);
    return { ...bureau, eventBus };
  })();
  return pret;
}

/** Marque unique d'un test : tout ce qu'il crée la porte, le ménage la cherche. */
export function marque(prefixe: string): string {
  return `[QA-AUTO ${prefixe} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}]`;
}

/** Attend qu'une condition devienne vraie (sondage court, borné). */
export async function attendre<T>(lire: () => Promise<T>, ok: (v: T) => boolean, delaiMs = 15_000, pasMs = 300): Promise<T> {
  const fin = Date.now() + delaiMs;
  let v = await lire();
  while (!ok(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, pasMs));
    v = await lire();
  }
  return v;
}

/** Les envois simulés d'une entreprise depuis un instant donné. */
export async function envoisSimules(admin: SupabaseClient, orgId: string, depuis: string) {
  const { data, error } = await admin.from('envois_simules')
    .select('id, canal, destinataire, sujet, corps, meta, created_at')
    .eq('org_id', orgId).gte('created_at', depuis).order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fait avancer la file planifiée du bureau de test (et d'aucun autre). */
export async function traiterFile(admin: SupabaseClient, orgId: string): Promise<void> {
  const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
  await processScheduledTasks(admin, { orgId });
}
