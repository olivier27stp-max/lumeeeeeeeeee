/**
 * Le contexte d'un tour de Lumi, porté jusqu'aux outils sans changer leur signature.
 * ─────────────────────────────────────────────────────────────────────────
 * Un outil reçoit `(args, ctx)` : le client, l'entreprise, la personne. Il ne
 * sait ni dans QUELLE conversation il tourne, ni dans quelle langue on parle à
 * l'utilisateur. Deux défauts en sortaient (mission finale, F-02 et A-05) :
 *
 *  · `create_automation_from_text` lance une génération (un appel au modèle,
 *    jusqu'à 3,25 ¢) : elle était journalisée SANS conversation, donc invisible
 *    de la trace du tour et du plafond par conversation — 28 % du coût du
 *    clavardage d'automatisations échappait à la mesure ;
 *  · le résultat d'un outil (le résumé de ce qui est enregistré, le reçu) était
 *    rédigé en français quelle que soit la langue de la conversation.
 *
 * `AsyncLocalStorage` : la route ouvre le contexte autour du tour, tout ce qui
 * s'exécute dedans (orchestrateur, garde, handler, génération imbriquée) le lit.
 * Hors d'un tour (MCP, tests, scripts) : `null`, et chacun garde son défaut.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { ajouterUsage, usageVide, type UsageAgrege } from './traces';
import type { UsageTokens } from './tarifs';

export interface ContexteAppelLumi {
  /** La conversation du clavardage, s'il y en a une. */
  conversationId: string | null;
  /** La langue dans laquelle Lumi parle à l'utilisateur. */
  langue: 'fr' | 'en';
  /** Ce que les appels au modèle lancés PAR des outils ont coûté pendant ce tour (génération d'un parcours). */
  imbrique: { cout_cents: number; appels: number; usage: UsageAgrege; model: string | null };
}

const stockage = new AsyncLocalStorage<ContexteAppelLumi>();

export function nouveauContexteLumi(conversationId: string | null, langue: 'fr' | 'en'): ContexteAppelLumi {
  return { conversationId, langue, imbrique: { cout_cents: 0, appels: 0, usage: usageVide(), model: null } };
}

/** Exécute `fn` dans le contexte du tour. */
export function avecContexteLumi<T>(contexte: ContexteAppelLumi, fn: () => Promise<T>): Promise<T> {
  return stockage.run(contexte, fn);
}

/**
 * Ouvre le contexte pour TOUTE la suite de la requête en cours (et ce qu'elle
 * lance) : la route l'appelle une fois, au début du tour. Chaque requête HTTP a
 * sa propre chaîne asynchrone — deux tours simultanés ne se voient pas.
 */
export function entrerDansContexteLumi(conversationId: string | null, langue: 'fr' | 'en'): ContexteAppelLumi {
  const contexte = nouveauContexteLumi(conversationId, langue);
  stockage.enterWith(contexte);
  return contexte;
}

/** Le contexte du tour en cours, ou null hors d'un tour de Lumi. */
export function contexteLumi(): ContexteAppelLumi | null {
  return stockage.getStore() ?? null;
}

/** Langue du tour en cours (français hors d'un tour). */
export function langueDuTour(): 'fr' | 'en' {
  return stockage.getStore()?.langue ?? 'fr';
}

/** Un appel au modèle lancé par un outil : son coût rejoint celui du tour. */
export function noterAppelImbrique(model: string, usage: UsageTokens, coutCents: number): void {
  const c = stockage.getStore();
  if (!c) return;
  c.imbrique.cout_cents += coutCents;
  c.imbrique.appels += 1;
  c.imbrique.usage = ajouterUsage(c.imbrique.usage, usage);
  c.imbrique.model = model;
}
