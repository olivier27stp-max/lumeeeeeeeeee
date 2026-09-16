/**
 * Maintien du cache 1 h « chaud » après une activité réelle de Lumi.
 * ─────────────────────────────────────────────────────────────────
 * Le préfixe (prompt stable + outils de base, ~6 700 tokens) est en cache
 * 1 h, partagé par toutes les orgs depuis #401. Il expire après UNE HEURE
 * sans appel, et le prochain appel le réécrit à prix double : 2,7 ¢, soit
 * dix fois un appel chaud (0,3 à 0,6 ¢, mesuré en prod le 2026-09-16).
 *
 * Un « ping » minimal (même modèle, même préfixe, 16 tokens de sortie)
 * rafraîchit le TTL pour ~0,15 ¢. On ne pinge QUE dans la foulée d'une
 * activité réelle : à 50 min d'inactivité, puis toutes les 50 min tant qu'on
 * reste dans la fenêtre (LUMI_CACHE_CHAUD_MINUTES, défaut 120, 0 désactive).
 * Plafond : 2 pings (0,3 ¢) par rafale d'activité ; rentable dès qu'un
 * utilisateur revient une fois sur neuf dans les deux heures. Sans activité
 * (nuit, week-end), aucun ping : rien n'est dépensé dans le vide.
 *
 * Le ping ne touche ni la base, ni les traces d'une org (pas d'org) : il est
 * journalisé par le logger seulement.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { clientAnthropic } from './llm';
import { logger } from '../logger';
import { coutEnCents, modeleLumi } from './tarifs';

/** Le TTL est d'une heure ; on rafraîchit à 50 min pour garder de la marge. */
export const DELAI_RAFRAICHISSEMENT_MS = 50 * 60_000;
const CADENCE_VERIFICATION_MS = 5 * 60_000;

let dernierAppelReel = 0;
let dernierPing = 0;
let dernierModele = '';
/** Le préfixe (système + outils) du dernier vrai appel : c'est LUI qu'on rafraîchit, pas un préfixe théorique. */
let dernierPrefixe: { systeme: Anthropic.Messages.TextBlockParam[]; outils: Anthropic.Messages.ToolUnion[] } | null = null;

/** À appeler à chaque appel réel au modèle : c'est ce qui arme le maintien. */
export function signalerAppelLumi(model: string, prefixe?: { systeme: Anthropic.Messages.TextBlockParam[]; outils: Anthropic.Messages.ToolUnion[] }): void {
  dernierAppelReel = Date.now();
  dernierModele = model;
  if (prefixe) dernierPrefixe = prefixe;
}

/** Fenêtre après le dernier appel réel pendant laquelle on garde le cache chaud. 0 = désactivé. */
export function fenetreMaintienMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.LUMI_CACHE_CHAUD_MINUTES === '0') return 0;
  const v = Number(env.LUMI_CACHE_CHAUD_MINUTES);
  return (Number.isFinite(v) && v >= 1 ? v : 120) * 60_000;
}

export interface EtatMaintien { dernierAppelReel: number; dernierPing: number; maintenant: number; fenetreMs: number }

/** Pur : faut-il pinger maintenant ? */
export function doitPinger(e: EtatMaintien): boolean {
  if (!e.fenetreMs || !e.dernierAppelReel) return false;
  const depuisAppel = e.maintenant - e.dernierAppelReel;
  if (depuisAppel < DELAI_RAFRAICHISSEMENT_MS || depuisAppel > e.fenetreMs) return false;
  const dernierContact = Math.max(e.dernierAppelReel, e.dernierPing);
  return e.maintenant - dernierContact >= DELAI_RAFRAICHISSEMENT_MS;
}

type ClientMinimal = { messages: { create: (p: Anthropic.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Messages.Message> } };

/**
 * Un appel minimal sur le MÊME préfixe qu'un vrai tour (modèle, outils,
 * bloc stable — le même pour fr et en depuis B1 —, réglages de réflexion) : c'est la seule façon de
 * rafraîchir l'entrée de cache que les vrais appels lisent.
 */
export async function pingerCache(client: ClientMinimal, model: string = dernierModele || modeleLumi()): Promise<{ model: string; cost_cents: number; cache_lu: number; cache_ecrit: number }> {
  const { outilsClaude, promptSystemeLumi, parametresReflexion } = await import('./orchestrateur');
  const { reglesCout } = await import('./regles-cout');
  // Seul le bloc stable (1 h) compte : on le prend tel quel du dernier appel ; le bloc variable est jetable.
  const systeme = dernierPrefixe ? [dernierPrefixe.systeme[0]] : [promptSystemeLumi({ companyName: null, userName: null, language: 'fr', todayIso: new Date().toISOString().slice(0, 10) })[0]];
  const outils = dernierPrefixe ? dernierPrefixe.outils : outilsClaude();
  const reflexion = parametresReflexion(model, reglesCout().effort_defaut);
  const reponse = await client.messages.create({
    model,
    max_tokens: 16,
    system: systeme,
    tools: outils,
    messages: [{ role: 'user', content: 'ping' }],
    ...(reflexion.thinking ? { thinking: reflexion.thinking } : {}),
    ...(reflexion.output_config ? { output_config: reflexion.output_config } : {}),
  });
  dernierPing = Date.now();
  const u = reponse.usage;
  return { model, cost_cents: coutEnCents(model, u), cache_lu: u.cache_read_input_tokens ?? 0, cache_ecrit: u.cache_creation_input_tokens ?? 0 };
}

/** Vérifie toutes les 5 min ; ne fait rien tant que Lumi n'a pas servi un vrai appel. */
export function demarrerMaintienCacheChaud(): void {
  const fenetreMs = fenetreMaintienMs();
  if (!fenetreMs || !process.env.ANTHROPIC_API_KEY) return;
  const t = setInterval(async () => {
    if (!doitPinger({ dernierAppelReel, dernierPing, maintenant: Date.now(), fenetreMs })) return;
    try {
      const r = await pingerCache(clientAnthropic());
      logger.info('[lumi] cache 1 h rafraîchi', r);
    } catch (e: any) {
      dernierPing = Date.now(); // pas de rafale de tentatives : on réessaie au prochain créneau
      logger.warn('[lumi] rafraîchissement du cache impossible', { error: e?.message || String(e) });
    }
  }, CADENCE_VERIFICATION_MS);
  t.unref?.();
}
