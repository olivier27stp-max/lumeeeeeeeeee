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
import { verifierPlafond, ajouterDepense, compterRefus } from './plafond-journalier';

/** Le TTL est d'une heure ; on rafraîchit à 50 min pour garder de la marge. */
export const DELAI_RAFRAICHISSEMENT_MS = 50 * 60_000;
const CADENCE_VERIFICATION_MS = 5 * 60_000;

let dernierAppelReel = 0;
let dernierPing = 0;
let dernierModele = '';
type Prefixe = { systeme: Anthropic.Messages.TextBlockParam[]; outils: Anthropic.Messages.ToolUnion[] };
/** Le préfixe (système + outils) du dernier vrai appel : c'est LUI qu'on rafraîchit, pas un préfixe théorique. */
let dernierPrefixe: Prefixe | null = null;
/**
 * Un préfixe PAR JEU D'OUTILS (jeu de base + un par sous-agent, ≤ 8) : depuis
 * que chaque sous-agent charge tout son topic (7 à 11 k tokens), laisser
 * refroidir un topic coûte 2 à 3 ¢ à sa prochaine utilisation ; le garder
 * chaud coûte ~0,2 ¢ par ping. Chaque entrée a sa propre horloge.
 */
const prefixes = new Map<string, { prefixe: Prefixe; dernierAppelReel: number; dernierPing: number }>();
export const MAX_PREFIXES_CHAUDS = 12;

/** À appeler à chaque appel réel au modèle : c'est ce qui arme le maintien. `cle` = jeu d'outils (base ou topic). */
export function signalerAppelLumi(model: string, prefixe?: Prefixe, cle = 'base'): void {
  dernierAppelReel = Date.now();
  dernierModele = model;
  if (prefixe) {
    dernierPrefixe = prefixe;
    const e = prefixes.get(cle);
    if (e) { e.prefixe = prefixe; e.dernierAppelReel = Date.now(); }
    else {
      if (prefixes.size >= MAX_PREFIXES_CHAUDS) {
        // Le plus ancien s'en va : on ne pinge jamais plus de MAX_PREFIXES_CHAUDS préfixes.
        let plusVieux: string | null = null; let t = Infinity;
        for (const [k, v] of prefixes) if (v.dernierAppelReel < t) { t = v.dernierAppelReel; plusVieux = k; }
        if (plusVieux) prefixes.delete(plusVieux);
      }
      prefixes.set(cle, { prefixe, dernierAppelReel: Date.now(), dernierPing: 0 });
    }
  }
}

/** Pour les tests : l'état des préfixes suivis. */
export function prefixesSuivis(): ReadonlyMap<string, { dernierAppelReel: number; dernierPing: number }> { return prefixes; }

/**
 * Fenêtre après le dernier appel réel pendant laquelle on garde le cache
 * chaud. 0 = désactivé.
 *
 * Portée de 2 h à 12 h le 2026-09-22, sur mesure. Le démarrage à froid est
 * LA source des coûts imprévisibles : un tour à cache froide coûte 5,25 ¢
 * contre 2,06 ¢ à chaud (4,8×), et 25 % des tours étaient à froid. Ventilé
 * par écart depuis le tour précédent :
 *
 *   0-5 min    57 tours   16 % à froid   2,06 ¢
 *   1-2 h       2 tours  100 % à froid   4,92 ¢
 *   > 8 h       5 tours  100 % à froid   5,25 ¢
 *
 * Au-delà d'une heure, c'est froid à tous les coups — et une fenêtre de 2 h
 * ne couvrait pas le cas le plus courant : la personne qui revient le
 * lendemain matin, ou après le dîner.
 *
 * 12 h couvre une journée ouvrable : 15 pings à ~0,15 ¢ = 2,25 ¢ par jour,
 * rentable dès qu'UN SEUL tour à froid est évité tous les trois jours
 * (0,7/jour exactement). Le maintien ne s'arme toujours qu'après une activité
 * réelle : la nuit et le week-end, rien n'est dépensé.
 */
export function fenetreMaintienMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.LUMI_CACHE_CHAUD_MINUTES === '0') return 0;
  const v = Number(env.LUMI_CACHE_CHAUD_MINUTES);
  return (Number.isFinite(v) && v >= 1 ? v : 720) * 60_000;
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
export async function pingerCache(client: ClientMinimal, model: string = dernierModele || modeleLumi(), prefixe: Prefixe | null = dernierPrefixe): Promise<{ model: string; cost_cents: number; cache_lu: number; cache_ecrit: number }> {
  const { outilsClaude, promptSystemeLumi, parametresReflexion } = await import('./orchestrateur');
  const { reglesCout } = await import('./regles-cout');
  // Seul le bloc stable (1 h) compte : on le prend tel quel du dernier appel ; le bloc variable est jetable.
  const systeme = prefixe ? [prefixe.systeme[0]] : [promptSystemeLumi({ companyName: null, userName: null, language: 'fr', todayIso: new Date().toISOString().slice(0, 10) })[0]];
  const outils = prefixe ? prefixe.outils : outilsClaude();
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
    const maintenant = Date.now();
    // Sans préfixe suivi (aucun appel réel depuis le démarrage) : l'horloge globale, préfixe par défaut.
    const cibles: Array<{ cle: string; prefixe: Prefixe | null; etat: { dernierAppelReel: number; dernierPing: number } }> = prefixes.size
      ? [...prefixes].map(([cle, e]) => ({ cle, prefixe: e.prefixe, etat: e }))
      : [{ cle: 'base', prefixe: null, etat: { dernierAppelReel, dernierPing } }];
    for (const c of cibles) {
      if (!doitPinger({ dernierAppelReel: c.etat.dernierAppelReel, dernierPing: c.etat.dernierPing, maintenant, fenetreMs })) continue;
      // Un ping est un appel facturé émis par une minuterie, sans utilisateur
      // derrière : il passe par le même plafond que le reste (incident
      // 2026-09-18 — c'était la seule dépense sans aucune trace en base).
      if (!verifierPlafond('cache-chaud').autorise) { compterRefus('cache-chaud'); continue; }
      try {
        const r = await pingerCache(clientAnthropic(), undefined, c.prefixe);
        c.etat.dernierPing = Date.now();
        ajouterDepense('cache-chaud', r.cost_cents);
        logger.info('[lumi] cache 1 h rafraîchi', { jeu: c.cle, ...r });
      } catch (e: any) {
        c.etat.dernierPing = Date.now(); // pas de rafale de tentatives : on réessaie au prochain créneau
        logger.warn('[lumi] rafraîchissement du cache impossible', { jeu: c.cle, error: e?.message || String(e) });
      }
    }
    if (!prefixes.size) dernierPing = Math.max(dernierPing, cibles[0].etat.dernierPing);
  }, CADENCE_VERIFICATION_MS);
  t.unref?.();
}
