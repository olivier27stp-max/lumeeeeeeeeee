/**
 * Routeur (item 10, AGENTFORCE_GAP.md B4) — un appel Haiku, sortie JSON stricte.
 * ─────────────────────────────────────────────────────────────────
 * Le LLM classifie et extrait des paramètres ; le CODE exécute. Le routeur
 * ne voit ni identifiant ni résultat d'outil : l'énoncé, la liste des topics
 * et des actions déterminisables, rien d'autre. Sa sortie est validée (Zod)
 * contre le registre : une action inconnue, un JSON invalide ou une
 * confiance sous le seuil → étage 6 (le modèle complet), JAMAIS une action
 * devinée.
 *
 * MODE OBSERVATION (LUMI_ROUTEUR=observation) : le routeur tourne en
 * parallèle du tour, n'agit pas, et son verdict est écrit dans la trace
 * (params.routeur) pour comparer à ce que Sonnet a réellement fait. C'est
 * ce qui calibre le seuil sur du trafic réel avant d'activer quoi que ce soit
 * (mode 'actif', non branché : voir AGENTFORCE_GAP.md ordre 10 → 11).
 * Coût : ~600 tokens de prompt (cache 1 h) + l'énoncé, sur Haiku.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { clientAnthropic } from './llm';
import { z } from 'zod';
import { TOPICS, type IdTopic } from './topics';
import { IDS_RACCOURCIS, PERIODES_AGENDA } from './raccourcis';
import { logger } from '../logger';

export const SEUIL_CONFIANCE = 0.85;
export const MODELE_ROUTEUR = 'claude-haiku-4-5';
export type ModeRouteur = 'off' | 'observation';

export function modeRouteur(env: NodeJS.ProcessEnv = process.env): ModeRouteur {
  return env.LUMI_ROUTEUR === 'observation' ? 'observation' : 'off';
}

const IDS_TOPICS = TOPICS.map((t) => t.id) as [IdTopic, ...IdTopic[]];

export const verdictSchema = z.object({
  topic: z.enum(IDS_TOPICS),
  action: z.enum(IDS_RACCOURCIS as unknown as [string, ...string[]]).nullable(),
  params: z.object({
    periode: z.enum(PERIODES_AGENDA).optional(),
    numero: z.string().regex(/^\d{1,7}$/).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }).strict().default({}),
  confidence: z.number().min(0).max(1),
});
export type Verdict = z.infer<typeof verdictSchema>;

export interface ResultatRouteur {
  verdict: Verdict | null;
  /** 'ok' = verdict valide ; 'invalide' = JSON ou schéma refusé ; 'erreur' = appel raté. */
  statut: 'ok' | 'invalide' | 'erreur';
  /** Ce que le code ferait avec ce verdict. */
  decision: 'action' | 'modele' | 'hors_scope';
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  duree_ms: number;
}

/** Ce que le code fait d'un verdict validé (pur, testable). */
export function decider(v: Verdict | null): ResultatRouteur['decision'] {
  if (!v) return 'modele';
  if (v.topic === 'hors_scope' && v.confidence >= SEUIL_CONFIANCE) return 'hors_scope';
  if (v.action && v.confidence >= SEUIL_CONFIANCE && v.topic !== 'multi') return 'action';
  return 'modele';
}

/** Valide une sortie brute du modèle : jamais d'exception, jamais d'action devinée. */
export function validerVerdict(brut: unknown): Verdict | null {
  const r = verdictSchema.safeParse(brut);
  return r.success ? r.data : null;
}

const PROMPT_ROUTEUR = `Tu classes UN message d'un utilisateur de Lume (CRM d'entreprise de services au Québec) dans un topic, et tu dis si une action déterministe connue y répond exactement.

Topics :
${TOPICS.map((t) => `- ${t.id} : ${t.description}`).join('\n')}

Actions déterministes (réponse gabarit, sans modèle) — seulement si le message demande EXACTEMENT ça, sans précision de client, de ville, de période autre que celles permises :
- clients-total : combien de clients au total
- agenda (params.periode = aujourdhui | demain | semaine) : ce qui est planifié sur cette période
- revenu-mois : encaissé / facturé ce mois-ci
- retards : factures en retard, qui doit de l'argent
- briefing : survol du jour, quoi de neuf
- top-clients (params.limit) : meilleurs clients
- taches : tâches à faire
- equipe : qui est dans l'équipe
- devis-attente : devis en attente de réponse
- ou-equipe : où est l'équipe en ce moment
- job-numero (params.numero) : montrer le job numéro N

Règles : action = null dès qu'il y a un doute, une écriture (créer, envoyer, modifier, annuler), un nom propre, une ville ou une période non permise. Plusieurs sujets ou actions → topic multi, action null. confidence entre 0 et 1, honnête.`;


/**
 * Classifie l'énoncé. Sortie JSON stricte via un outil unique (`classer`)
 * dont le schéma reflète verdictSchema ; forcée par tool_choice.
 */
export async function classifier(enonce: string): Promise<ResultatRouteur> {
  const debut = Date.now();
  try {
    const res = await clientAnthropic().messages.create({
      model: MODELE_ROUTEUR,
      max_tokens: 200,
      system: [{ type: 'text', text: PROMPT_ROUTEUR, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools: [{
        name: 'classer',
        description: 'Le verdict de classification.',
        input_schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', enum: IDS_TOPICS },
            action: { type: ['string', 'null'], enum: [...IDS_RACCOURCIS, null] },
            params: { type: 'object', properties: { periode: { type: 'string', enum: [...PERIODES_AGENDA] }, numero: { type: 'string' }, limit: { type: 'integer' } }, additionalProperties: false },
            confidence: { type: 'number' },
          },
          required: ['topic', 'action', 'params', 'confidence'],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: 'tool', name: 'classer' },
      messages: [{ role: 'user', content: enonce.slice(0, 1000) }],
    });
    const appel = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    const verdict = validerVerdict(appel?.input ?? null);
    const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0 };
    return { verdict, statut: verdict ? 'ok' : 'invalide', decision: decider(verdict), usage, duree_ms: Date.now() - debut };
  } catch (err: any) {
    logger.error('[lumi/routeur] classification ratée', { error: err?.message || String(err) });
    return { verdict: null, statut: 'erreur', decision: 'modele', duree_ms: Date.now() - debut };
  }
}
