/**
 * Ce qu'on vérifie — et ce qu'on DIT — avant d'afficher la carte d'une écriture
 * sur une automatisation.
 * ─────────────────────────────────────────────────────────────────────────
 * Une carte se confirme d'un clic. Si ce qu'elle propose est faux — un texto
 * troué par une variable inventée, un « plus court » qui est plus long —,
 * l'utilisateur ne le découvre qu'après avoir cliqué (« ça n'a pas
 * fonctionné »), ou pas du tout. Et une activation proposée sans un mot ne dit
 * pas ce qui va partir.
 *
 * 1. `verifierAvantCarte` : le contrôle a lieu au moment où le modèle PROPOSE.
 *    Le refus lui revient comme un résultat d'outil, il corrige dans le même
 *    tour, et la carte qui s'affiche est juste. Mesuré sur le vrai modèle
 *    (mission finale, 2026-10-02) : « plus court » rendait un texto de 183
 *    caractères pour un texte de 160 — un modèle ne sait pas compter les
 *    caractères, le code si.
 *     · variables inconnues (A-06), automatisation introuvable ou à la corbeille
 *       (A-08), message à préciser quand il y en a plusieurs : refus ferme ;
 *     · `must_be_shorter` : le nouveau texte est compté contre l'actuel ;
 *     · un texto de plus de 160 caractères : signalé une fois (A-18) — redemandé
 *       tel quel, il passe (un texte long peut être voulu) ;
 *     · activer une automatisation qui porte encore un texte d'exemple, ou
 *       incomplète : refus ferme, Lumi le dit au lieu de proposer.
 *
 * 2. `texteAvantCarte` : avant d'activer une automatisation qui écrit aux
 *    clients (A-13), le SERVEUR écrit au-dessus de la carte ce qui partira —
 *    déclencheur, chaque message mot pour mot, portée. Écrit par du code : le
 *    modèle, laissé à lui-même, proposait la carte sans un mot, ou paraphrasait.
 *
 * Les handlers gardent leurs propres refus (le MCP n'a pas de carte) : ceci
 * les avance d'un clic, il ne les remplace pas.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { COLONNES_REGLE_LUE, messagesDeLaRegle, regleAtteintLeClient, type RegleLue } from '../automations-etapes';
import { problemeDeVariables } from '../agent/tools-reglages';
import { recapAvantPublication } from './panneau-automatisation';
import { textesDExemple } from '../../../src/lib/publicationAutomatisation';
import { problemesBloquants } from '../automations-publication';
import { messageCorbeille } from '../automations-corbeille';
import { segmentsSms } from '../../../src/lib/smsSegments';

export interface RefusAvantCarte {
  /** Ce que le modèle lit : quoi corriger, avec les chiffres. */
  message: string;
  /**
   * `ferme` : refusé tant que ce n'est pas corrigé. `une_fois` : signalé une
   * fois ; si le modèle refait la même proposition, elle passe.
   */
  genre: 'ferme' | 'une_fois';
  /** Pour ne signaler qu'une fois (clé du refus dans le tour). */
  code: string;
}

interface Contexte {
  /** Le client de l'UTILISATEUR (RLS). */
  client: SupabaseClient;
  orgId: string;
  langue: 'fr' | 'en';
}

const OUTILS: ReadonlySet<string> = new Set(['update_automation_sms_body', 'update_automation_message', 'update_automation_from_text', 'toggle_automation_rule']);

/**
 * Une longueur dite de façon qu'un modèle sache la viser. « 160 caractères au plus » le faisait
 * compter lettre par lettre dans sa réflexion, jusqu'à épuiser sa sortie (réponse coupée, mesuré
 * le 2026-10-02 sur « écris quelque chose de plus chaleureux ») : un modèle vise des MOTS.
 */
const enMots = (caracteres: number): string => `vise ${Math.max(6, Math.round(caracteres / 6.5))} mots environ (${caracteres} caractères), variables comprises`;

async function lire(ctx: Contexte, id: unknown): Promise<RegleLue | null> {
  if (typeof id !== 'string' || !id) return null;
  const { data, error } = await ctx.client
    .from('automation_rules').select(COLONNES_REGLE_LUE)
    .eq('id', id).eq('org_id', ctx.orgId).is('purged_at', null).maybeSingle();
  return error || !data ? null : (data as unknown as RegleLue);
}

/**
 * Le refus à rendre au modèle avant d'afficher la carte, ou null si la
 * proposition peut partir. Ne lève jamais : une vérification qui plante ne doit
 * pas empêcher une carte (le handler revérifie à l'exécution).
 */
export async function verifierAvantCarte(outil: string, args: Record<string, any>, ctx: Contexte): Promise<RefusAvantCarte | null> {
  if (!OUTILS.has(outil)) return null;
  try {
    const fr = ctx.langue === 'fr';
    const regle = await lire(ctx, args.rule_id);
    if (!regle) {
      return { genre: 'ferme', code: 'introuvable', message: 'Automatisation introuvable dans cette entreprise. Retrouve-la avec get_automation (par son nom) avant de proposer quoi que ce soit — ou dis que tu ne la trouves pas.' };
    }
    if (regle.deleted_at) return { genre: 'ferme', code: 'corbeille', message: `${messageCorbeille(true)} Dis-le à l'utilisateur ; ne propose rien.` };

    if (outil === 'update_automation_sms_body' || outil === 'update_automation_message') {
      const type = outil === 'update_automation_sms_body' || args.action_type !== 'send_email' ? 'send_sms' : 'send_email';
      const quoi = type === 'send_sms' ? 'texto' : 'courriel';
      const cibles = messagesDeLaRegle(regle).filter((m) => m.type === type);
      if (!cibles.length) return { genre: 'ferme', code: 'aucun_message', message: `Cette automatisation n’envoie pas de ${quoi} : rien à réécrire. Dis-le, ou propose de l'ajouter (update_automation_from_text).` };
      const numero = Number.isInteger(args.message_number) && Number(args.message_number) > 0 ? Number(args.message_number) : null;
      if (cibles.length > 1 && !numero) {
        const liste = cibles.map((c, i) => `${i + 1}. « ${c.texte.slice(0, 60)}${c.texte.length > 60 ? '…' : ''} »`).join(' ; ');
        return { genre: 'ferme', code: 'lequel', message: `Cette automatisation envoie ${cibles.length} ${quoi}s : précise message_number, ou demande lequel en UNE question. ${liste}` };
      }
      const cible = cibles[(numero ?? 1) - 1];
      if (!cible) return { genre: 'ferme', code: 'numero', message: `Il n’y a que ${cibles.length} ${quoi}(s) dans cette automatisation.` };
      const corps = typeof args.body === 'string' ? args.body.trim() : '';
      const variables = problemeDeVariables([corps, typeof args.subject === 'string' ? args.subject : undefined], regle.trigger_event);
      if (variables) return { genre: 'ferme', code: 'variables', message: `${variables} Réécris le message et propose-le de nouveau.` };
      if (type === 'send_sms' && corps) {
        if (args.must_be_shorter === true && corps.length >= cible.texte.length) {
          const visee = Math.max(40, Math.floor(cible.texte.length * 0.7));
          return { genre: 'ferme', code: 'pas_plus_court', message: `L'utilisateur veut PLUS COURT : le texto actuel fait ${cible.texte.length} caractères, le tien ${corps.length}. Réécris-le nettement plus court — ${enMots(visee)} — et propose-le de nouveau tout de suite. Ne compte pas les caractères toi-même : le serveur compte.` };
        }
        if (corps.length > 160 && cible.texte.length <= 160) {
          return { genre: 'une_fois', code: 'trop_long', message: `Ce texto fait ${corps.length} caractères : au-delà de 160, chaque envoi est facturé ${segmentsSms(corps).segments} SMS. Resserre-le — ${enMots(135)} — et propose-le de nouveau tout de suite, sans compter les caractères toi-même (le serveur compte). Si l'utilisateur a demandé un texto long, repropose-le tel quel et dis-lui ce que ça coûte.` };
        }
      }
      return null;
    }

    if (outil === 'toggle_automation_rule' && args.is_active === true && regle.is_active !== true) {
      const exemples = textesDExemple({ ...regle, fr });
      if (exemples.length) {
        return { genre: 'ferme', code: 'texte_exemple', message: 'Activation impossible : une étape porte encore le texte d’exemple de l’éditeur, qui partirait tel quel aux clients. Ne propose pas l’activation : dis-le, et DEMANDE si tu rédiges le vrai message — ne réécris rien de toi-même dans ce tour.' };
      }
      const bloquants = problemesBloquants(regle as Parameters<typeof problemesBloquants>[0], fr);
      if (bloquants.length) {
        return { genre: 'ferme', code: 'incomplete', message: `Activation impossible pour l’instant : ${bloquants.join(' · ')}. Ne propose pas l’activation : dis ce qui manque.` };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Le texte que le SERVEUR écrit juste au-dessus de la carte, ou null.
 * Aujourd'hui : l'activation d'une automatisation qui écrit aux clients.
 */
export async function texteAvantCarte(outil: string, args: Record<string, any>, ctx: Contexte): Promise<string | null> {
  if (outil !== 'toggle_automation_rule' || args.is_active !== true) return null;
  try {
    const regle = await lire(ctx, args.rule_id);
    if (!regle || regle.deleted_at || regle.is_active === true || !regleAtteintLeClient(regle)) return null;
    return await recapAvantPublication(getServiceClient(), ctx.orgId, regle, ctx.langue);
  } catch {
    return null;
  }
}
