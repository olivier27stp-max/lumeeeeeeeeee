/**
 * Lumi apprend de l'équipe (2026-09-17).
 * ───────────────────────────────────────
 * Quand un client pose une question que Lumi ne sait pas, un humain répond
 * dans Slack. Avant, cette réponse mourait dans le fil : le prochain client
 * qui posait la même question repassait par l'équipe. Maintenant l'équipe
 * peut la donner à Lumi sans quitter Slack :
 *
 *   - un message de fil qui commence par 📌 (ou « Lumi, retiens : … ») est
 *     RETENU, pas relayé au client ;
 *   - une réponse déjà relayée sur laquelle quelqu'un met la réaction 📌 est
 *     retenue aussi (relevé périodique, conversations.replies renvoie les
 *     réactions).
 *
 * Ce qui est retenu = (la question du client, la réponse de l'équipe, qui,
 * quand), dans support_savoir, et entre dans l'index de search_help comme
 * passage « Réponse de l'équipe Lume — … ». Lumi le trouve comme il trouve
 * la doc, et le prompt lui dit que c'est la vérité la plus à jour (une
 * fonction qui s'en vient, un bug connu, un contournement).
 *
 * Le cache sémantique partagé est vidé à chaque apprentissage : une réponse
 * mémorisée « je ne sais pas » ne doit pas survivre à la réponse de l'équipe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { definirSavoir, type SavoirEquipe } from '../agent/tools-aide';
import { viderSemantique } from '../lumi/cache-semantique';
import { PORTEE_CACHE_SUPPORT_GLOBALE } from './garde-fous';
import { reagirSlack, envoyerMessageSlack } from '../slack';
import { logger } from '../logger';

const RECHARGE_MS = 10 * 60_000;
const MAX_ENTREES = 500;
const MIN_LONGUEUR = 10;

/** Clés « canal:ts » déjà retenues : le relevé n'insère pas deux fois. */
const APPRIS = new Set<string>();

/**
 * Le texte à retenir si ce message de fil s'adresse à Lumi, sinon null.
 *   « 📌 Les rappels de rendez-vous arrivent en octobre. » → « Les rappels… »
 *   « Lumi, retiens : … », « lumi retiens que … », « :pushpin: … » → idem
 * Pur, testé.
 */
export function texteAApprendre(texte: string): string | null {
  const t = texte.trim();
  const m = /^(?:📌|:pushpin:)\s*(?:lumi[, ]+retiens(?:\s+(?:que|ça|ca|ceci))?\s*:?\s*)?(.+)$/is.exec(t)
    || /^@?lumi[, ]+retiens(?:\s+(?:que|ça|ca|ceci))?\s*:?\s*(.+)$/is.exec(t);
  if (!m) return null;
  const corps = m[1].trim();
  return corps.length >= MIN_LONGUEUR ? corps : null;
}

/** La question du client : son premier message, sinon le sujet du ticket. */
export function questionDuTicket(t: { subject: string }, messages: Array<{ author: string; body: string }>): string {
  const premier = messages.find((m) => m.author === 'user')?.body?.trim();
  return (premier || t.subject).replace(/\s+/g, ' ').slice(0, 300);
}

export function dejaAppris(channel: string | undefined, ts: string | undefined): boolean {
  return !!channel && !!ts && APPRIS.has(`${channel}:${ts}`);
}

/** Recharge l'index depuis la base (au démarrage, toutes les dix minutes, après chaque apprentissage). */
export async function chargerSavoir(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('support_savoir')
    .select('question, reponse, auteur, created_at, slack_channel_id, slack_ts')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_ENTREES);
  if (error) throw new Error(`support_savoir select : ${error.message}`);
  const lignes = (data || []) as Array<{ question: string; reponse: string; auteur: string | null; created_at: string; slack_channel_id: string | null; slack_ts: string | null }>;
  APPRIS.clear();
  for (const l of lignes) if (l.slack_channel_id && l.slack_ts) APPRIS.add(`${l.slack_channel_id}:${l.slack_ts}`);
  const savoir: SavoirEquipe[] = lignes.map((l) => ({ question: l.question, reponse: l.reponse, auteur: l.auteur, date: l.created_at }));
  definirSavoir(savoir);
  return savoir.length;
}

export async function apprendre(admin: SupabaseClient, p: { question: string; reponse: string; auteur: string | null; ticketId?: string | null; channel?: string; ts?: string }): Promise<'appris' | 'deja' | 'erreur'> {
  try {
    const { error } = await admin.from('support_savoir').insert({
      question: p.question.slice(0, 300), reponse: p.reponse.slice(0, 4000), auteur: p.auteur, source_ticket_id: p.ticketId ?? null,
      slack_channel_id: p.channel ?? null, slack_ts: p.ts ?? null,
    });
    if (error) {
      if (error.code === '23505') return 'deja';
      throw new Error(error.message);
    }
    if (p.channel && p.ts) APPRIS.add(`${p.channel}:${p.ts}`);
    await chargerSavoir(admin);
    // Une réponse mémorisée avant que l'équipe sache mieux ne doit pas survivre.
    await Promise.all([viderSemantique(PORTEE_CACHE_SUPPORT_GLOBALE('fr')), viderSemantique(PORTEE_CACHE_SUPPORT_GLOBALE('en'))]);
    logger.info('[support/savoir] réponse de l’équipe retenue', { auteur: p.auteur, ticketId: p.ticketId ?? null });
    return 'appris';
  } catch (e: any) {
    logger.error('[support/savoir] apprentissage impossible', { error: e?.message || String(e) });
    return 'erreur';
  }
}

/** 🧠 sur le message retenu (ou une courte réponse sans le scope reactions:write) ; ❌ + une ligne si ça a échoué ; rien pour un doublon. Best-effort, une seule fois. */
export async function accuserApprentissage(channel: string, ts: string, verdict: 'appris' | 'deja' | 'erreur'): Promise<void> {
  if (verdict === 'deja') return;
  const texte = verdict === 'appris'
    ? ':brain: Lumi a retenu cette réponse pour les prochains clients (elle n’est pas envoyée à celui-ci).'
    : ':x: Lumi n’a pas pu retenir ça (voir les journaux).';
  try {
    if (verdict === 'appris') { await reagirSlack(channel, ts, 'brain'); return; }
    await envoyerMessageSlack({ channel, thread_ts: ts, text: texte });
  } catch {
    try { await envoyerMessageSlack({ channel, thread_ts: ts, text: texte }); } catch { /* l'accusé est un confort */ }
  }
}

export function demarrerSavoir(admin: () => SupabaseClient): void {
  const charger = () => chargerSavoir(admin()).then((n) => { if (n) logger.info('[support/savoir] index rechargé', { entrees: n }); }).catch((e: any) => logger.error('[support/savoir] rechargement impossible', { error: e?.message || String(e) }));
  void charger();
  const t = setInterval(charger, RECHARGE_MS);
  t.unref?.();
}
