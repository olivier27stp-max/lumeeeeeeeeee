/**
 * Trace unifiée des agents — une ligne par tour (table lumi_traces).
 * ─────────────────────────────────────────────────────────────────
 * Ce que ai_usage (tokens par appel API), agent_actions (écritures, 24 h)
 * et lumi_messages (texte) ne disent pas pour UN tour : d'où vient le
 * message, quel étage a répondu, quels outils ont tourné, combien ça a
 * coûté, en combien de temps. C'est la mesure qui manque à COST_AUDIT.md
 * (part de trafic sans modèle, coût par entrée d'interface, calibrage du
 * routeur) et l'audit demandé par R10 (qui, quoi, quand, quel résultat).
 *
 * Règles :
 * - org_id et user_id viennent TOUJOURS du contexte serveur (jamais du
 *   modèle, jamais du corps de la requête). La page publique n'a pas de
 *   tenant : org_id NULL.
 * - L'écriture ne bloque jamais un tour : `void journaliserTrace(...)`,
 *   toute erreur est journalisée, jamais relancée. Si la table n'existe
 *   pas encore (migration 20260913000000 non appliquée : R9), un seul
 *   avertissement par processus, puis silence.
 * - Aucun coût inventé : sans grille tarifaire (Gemini), cost_cents est
 *   NULL, les tokens sont stockés tels quels.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { normaliser } from './normaliser';
import type { UsageTokens } from './tarifs';

export type CanalTrace = 'lumi' | 'public' | 'agent' | 'transcription' | 'migration';
export type OrigineTrace = 'texte' | 'suggestion' | 'voix' | 'carte' | 'repli' | 'lien' | 'api';
export type ResultatTrace = 'ok' | 'refus' | 'erreur' | 'proposition';
export const ORIGINES_TRACE: readonly OrigineTrace[] = ['texte', 'suggestion', 'voix', 'carte', 'repli', 'lien', 'api'];

/** Étages de la couche zéro-appel (AGENTFORCE_GAP.md B3). */
export const ETAGE = {
  interface: 0, enonceExact: 1, raccourci: 2, cacheReponse: 3, cacheSemantique: 4, routeur: 5, agent: 6,
} as const;

export interface Trace {
  orgId: string | null;
  userId: string | null;
  conversationId?: string | null;
  canal: CanalTrace;
  origine: OrigineTrace;
  /** Texte de l'utilisateur, normalisé ici (jamais stocké brut : lumi_messages s'en charge). */
  enonce?: string | null;
  etage?: number | null;
  topic?: string | null;
  action?: string | null;
  params?: Record<string, unknown> | null;
  outils?: string[];
  resultat: ResultatTrace;
  model?: string | null;
  promptVersion?: string | null;
  usage?: UsageAgrege | null;
  /** NULL = tarif inconnu (jamais 0 par défaut pour un appel facturé). */
  costCents?: number | null;
  dureeMs?: number | null;
}

/** Tokens d'un tour, tous appels confondus, écritures en cache séparées 5 min / 1 h. */
export interface UsageAgrege {
  input_tokens: number;
  cache_5m: number;
  cache_1h: number;
  cache_lu: number;
  output_tokens: number;
}

export function usageVide(): UsageAgrege {
  return { input_tokens: 0, cache_5m: 0, cache_1h: 0, cache_lu: 0, output_tokens: 0 };
}

/**
 * Ajoute l'usage d'un appel Anthropic à l'agrégat du tour. Sans le détail
 * `cache_creation`, toute l'écriture est comptée en 1 h (c'est le TTL des
 * points de cache de l'orchestrateur ; le point glissant 5 min est petit).
 */
export function ajouterUsage(total: UsageAgrege, u: UsageTokens): UsageAgrege {
  const ecrit1h = u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens : (u.cache_creation_input_tokens ?? 0);
  const ecrit5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens : 0;
  return {
    input_tokens: total.input_tokens + (u.input_tokens ?? 0),
    cache_5m: total.cache_5m + (ecrit5m ?? 0),
    cache_1h: total.cache_1h + (ecrit1h ?? 0),
    cache_lu: total.cache_lu + (u.cache_read_input_tokens ?? 0),
    output_tokens: total.output_tokens + (u.output_tokens ?? 0),
  };
}

/** Usage d'une réponse Gemini (`usageMetadata`), dans le même agrégat. Les tokens de réflexion sont de la sortie. */
export function usageGemini(u: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number } | null | undefined): UsageAgrege | null {
  if (!u) return null;
  const cache = u.cachedContentTokenCount ?? 0;
  return {
    input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - cache),
    cache_5m: 0,
    cache_1h: 0,
    cache_lu: cache,
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

/** Énoncé tel qu'il sera comparé aux énoncés exacts : normalisé, borné à 200 caractères. */
export function normaliserEnonce(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const n = normaliser(texte).join(' ').slice(0, 200);
  return n || null;
}

let tableAbsenteSignalee = false;

/** Écrit la trace. Ne lève jamais : un tour ne dépend pas de sa mesure. */
export async function journaliserTrace(admin: SupabaseClient, t: Trace): Promise<void> {
  const u = t.usage ?? usageVide();
  const ligne = {
    org_id: t.orgId,
    user_id: t.userId,
    conversation_id: t.conversationId ?? null,
    canal: t.canal,
    origine: t.origine,
    // Normalisé ICI quoi que fasse l'appelant : jamais de texte brut dans cette table (lumi_messages s'en charge).
    enonce_normalise: normaliserEnonce(t.enonce),
    etage: t.etage ?? null,
    topic: t.topic ?? null,
    action: t.action ?? null,
    params: t.params ?? null,
    outils: t.outils ?? [],
    resultat: t.resultat,
    model: t.model ?? null,
    prompt_version: t.promptVersion ?? null,
    input_tokens: u.input_tokens,
    cache_5m: u.cache_5m,
    cache_1h: u.cache_1h,
    cache_lu: u.cache_lu,
    output_tokens: u.output_tokens,
    cost_cents: t.costCents ?? null,
    duree_ms: t.dureeMs ?? null,
  };
  try {
    const { error } = await admin.from('lumi_traces').insert(ligne);
    if (!error) return;
    // 42P01 = la table n'existe pas encore (migration à appliquer par un humain).
    if ((error as any).code === '42P01' || /lumi_traces/.test(error.message) && /does not exist|not find/i.test(error.message)) {
      if (!tableAbsenteSignalee) {
        tableAbsenteSignalee = true;
        logger.warn('[lumi/traces] table lumi_traces absente : appliquer supabase/migrations/20260913000000_lumi_traces.sql (aucune trace écrite d ici là)');
      }
      return;
    }
    logger.error('[lumi/traces] trace non écrite', { error: error.message, canal: t.canal, orgId: t.orgId });
  } catch (err: any) {
    logger.error('[lumi/traces] trace non écrite', { error: err?.message || String(err), canal: t.canal, orgId: t.orgId });
  }
}

/** Pour les tests : oublie l'avertissement « table absente » déjà émis. */
export function reinitialiserTraces(): void {
  tableAbsenteSignalee = false;
}
