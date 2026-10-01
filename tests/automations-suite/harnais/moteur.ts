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
import { assurerBureauTest, type BureauTest } from './bureau-test';

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
    // « En journée » pour les deux bureaux : la suite ne dépend plus de l'heure
    // à laquelle elle tourne (le canari était rouge à 20 h 31 : texto reporté).
    const fuseau = fuseauEnJournee();
    const { error: eFuseau } = await bureau.admin.from('company_settings')
      .update({ timezone: fuseau }).in('org_id', [bureau.orgA, bureau.orgB]);
    if (eFuseau) throw new Error(`fuseau des bureaux de test : ${eFuseau.message}`);
    const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
    viderCacheFuseau();
    const { envelopperBacASable, oublierBacASable } = await import('../../../server/lib/bac-a-sable');
    oublierBacASable();
    const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    initAutomationEngine({
      supabase: bureau.admin,
      // Pas de numéro partagé de plateforme (comme en prod) : un texto doit
      // partir du numéro de l'ENTREPRISE, ou ne pas partir.
      twilio: { client: envelopperBacASable(clientTwilioPiege)!, phoneNumber: '' },
      baseUrl: process.env.PUBLIC_URL || 'https://staging.lume-qa.test',
    } as never);
    return { ...bureau, eventBus };
  })();
  return pret;
}

/**
 * Un fuseau où il est, en ce moment, entre 10 h et 16 h. La fenêtre d'envoi
 * (8 h-20 h, heures calmes) reporte un texto au lendemain : sans ceci, la
 * suite passait le jour et échouait le soir. On change le FUSEAU des bureaux
 * de test, pas le moteur : report, jours locaux et délais suivent le vrai code.
 * Un test qui éprouve la fenêtre elle-même pose son propre fuseau.
 */
export function fuseauEnJournee(maintenant = new Date()): string {
  const heure = (tz: string) =>
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(maintenant)) % 24;
  const candidats = [
    'America/Toronto', 'America/Vancouver', 'Pacific/Honolulu', 'Asia/Tokyo', 'Europe/Paris',
    'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Bangkok', 'Atlantic/Azores',
  ];
  for (const tz of candidats) {
    const h = heure(tz);
    if (h >= 10 && h <= 16) return tz;
  }
  // Aucune ville dans la fenêtre : un décalage fixe qui met 13 h maintenant.
  // « Etc/GMT+5 » = UTC−5 (le signe IANA est inversé).
  const decalage = ((13 - maintenant.getUTCHours() + 36) % 24) - 12;
  return decalage === 0 ? 'Etc/GMT' : `Etc/GMT${decalage > 0 ? '-' : '+'}${Math.abs(decalage)}`;
}

/**
 * Une ligne du journal d'exécution est-elle DÉFINITIVE ? Le moteur écrit
 * « en cours » à la réservation, et « … résultat en attente (l'action
 * continue) » quand une action dépasse 5 s — puis complète la MÊME ligne avec
 * le vrai résultat. Sur un staging lent, un test qui lisait trop tôt prenait
 * l'état provisoire pour le résultat (E-030 rouge dans la suite complète).
 */
export function journalDefinitif(resultError: string | null | undefined): boolean {
  const e = String(resultError ?? '');
  return e !== 'en cours' && !e.includes('résultat en attente');
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

/**
 * De combien l'horloge de CE poste avance sur celle de la base (ms, ≥ 0),
 * marge d'aller-retour comprise. `depuis` est noté à l'heure du poste, mais
 * `created_at` à celle de la base : poste en avance de 300 ms = les envois
 * faits tout de suite après semblaient dater d'AVANT le test (canari rouge
 * le 2026-10-01, 2 envois sur 3 « absents »). Mesurée une fois par fichier.
 */
let avanceDuPoste: Promise<number> | null = null;
function mesurerAvance(admin: SupabaseClient, orgId: string): Promise<number> {
  avanceDuPoste ??= (async () => {
    const t0 = Date.now();
    const { data, error } = await admin.from('envois_simules')
      .insert({ org_id: orgId, canal: 'webhook', destinataire: 'horloge://mesure', meta: { mesure_horloge: true } })
      .select('id, created_at').single();
    const t1 = Date.now();
    if (error || !data) return 2_000; // mesure impossible : marge prudente
    await admin.from('envois_simules').delete().eq('id', data.id);
    const avance = (t0 + t1) / 2 - Date.parse(data.created_at as string);
    return Math.max(0, avance) + (t1 - t0) / 2 + 250;
  })();
  return avanceDuPoste;
}

/** Les envois simulés d'une entreprise depuis un instant donné (heure du poste). */
export async function envoisSimules(admin: SupabaseClient, orgId: string, depuis: string) {
  const borne = new Date(Date.parse(depuis) - (await mesurerAvance(admin, orgId))).toISOString();
  const { data, error } = await admin.from('envois_simules')
    .select('id, canal, destinataire, sujet, corps, meta, created_at')
    .eq('org_id', orgId).gte('created_at', borne).neq('destinataire', 'horloge://mesure').order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fait avancer la file planifiée du bureau de test (et d'aucun autre). */
export async function traiterFile(admin: SupabaseClient, orgId: string): Promise<void> {
  const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
  await processScheduledTasks(admin, { orgId });
}
