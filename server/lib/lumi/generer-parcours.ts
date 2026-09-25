/* ═══════════════════════════════════════════════════════════════
   Lumi construit un parcours à partir d'une phrase.

   « Après l'envoi d'une soumission, attends 3 jours puis envoie un texto de
   suivi si le client n'a pas répondu » → un graphe d'étapes prêt à dessiner.

   ── Pourquoi un appel direct, pas l'orchestrateur ──────────────
   L'orchestrateur porte 240 outils, un routeur, un cache de prompt système.
   C'est ce qu'il faut pour une conversation ; ici on veut UNE sortie
   structurée, en un aller-retour. Un appel ciblé coûte une fraction du prix
   et répond en deux secondes au lieu de dix.

   ── Ce que Lumi N'A PAS le droit de faire ──────────────────────
   · inventer un déclencheur ou une action hors catalogue — la liste lui est
     donnée, et la validation Zod refuse le reste à l'enregistrement ;
   · choisir un destinataire — il n'y a pas de champ pour ça ;
   · enregistrer quoi que ce soit. Il PROPOSE un parcours, l'utilisateur le
     voit dans le canevas et décide. C'est la règle Lumi du projet : une
     écriture n'est jamais exécutée par l'orchestrateur.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { clientAnthropic, isLumiConfigured } from './llm';
import { reserverBudget, journaliserUsage, estimationCoutAppel } from './budget';
import { coutEnCents } from './tarifs';
import { logger } from '../logger';
import { DECLENCHEURS, ACTIONS } from '../../../src/lib/automationCatalogue';

/**
 * Haiku suffit et coûte 5× moins cher que Sonnet.
 *
 * La tâche est du remplissage de gabarit : on donne le catalogue, la forme
 * attendue et un exemple. Si un cas réel montrait que Haiku se trompe de
 * déclencheur ou câble mal une branche, passer à Sonnet ne coûte qu'une
 * ligne — mais commencer par le moins cher est le bon sens.
 */
const MODELE = 'claude-haiku-4-5';

/** Plafond de sortie : un parcours réaliste tient largement dedans. */
const MAX_TOKENS = 1_500;

export interface ParcoursPropose {
  /** Le nom suggéré — l'utilisateur peut le changer. */
  nom: string;
  trigger_event: string;
  steps: Array<Record<string, unknown>>;
  /** Ce que Lumi a compris, en une phrase, affiché au-dessus du canevas. */
  resume: string;
}

/** Le prompt système : le catalogue, la forme, et les interdits. */
function consignes(fr: boolean): string {
  const declencheurs = DECLENCHEURS
    .map((d) => `- ${d.cle} : ${fr ? d.aide_fr : d.aide_en}`)
    .join('\n');
  const actions = ACTIONS
    .map((a) => {
      const champs = a.champs.map((c) => `${c.cle}${c.obligatoire ? '' : '?'}`).join(', ');
      return `- ${a.cle} (${champs}) : ${fr ? a.aide_fr : a.aide_en}`;
    })
    .join('\n');

  return `Tu construis une automatisation pour un CRM d'entreprise de services au Québec.

DÉCLENCHEURS DISPONIBLES (choisis-en UN, exactement comme écrit) :
${declencheurs}

ACTIONS DISPONIBLES (rien d'autre n'existe) :
${actions}

FORME DE LA RÉPONSE — un objet JSON, rien autour :
{
  "nom": "nom court de l'automatisation",
  "trigger_event": "une clé de la liste ci-dessus",
  "resume": "une phrase qui dit ce que ça fait",
  "steps": [
    { "id": "e1", "type": "action", "action": { "type": "send_sms", "config": { "body": "..." } }, "suivant": "e2" },
    { "id": "e2", "type": "attendre", "delai_secondes": 259200, "suivant": "e3" },
    { "id": "e3", "type": "si", "conditions": { "status": { "eq": "sent" } }, "alors": "e4", "sinon": null },
    { "id": "e4", "type": "action", "action": { "type": "send_email", "config": { "subject": "...", "body": "..." } } }
  ]
}

RÈGLES ABSOLUES :
- Les identifiants d'étape sont e1, e2, e3… et ne contiennent ni ":" ni espace.
- Le parcours NE REVIENT JAMAIS en arrière : "suivant", "alors" et "sinon"
  pointent toujours vers une étape PLUS LOIN dans la liste. Une boucle serait
  refusée et enverrait des messages à l'infini.
- Une étape "attendre" n'est jamais la dernière : elle attendrait pour rien.
- Les délais sont en SECONDES (1 jour = 86400).
- Les seules conditions possibles portent sur "status" avec l'opérateur "eq" :
  "sent" (toujours sans réponse), "approved" (accepté), "paid" (payé),
  "unpaid" (impayé). Aucun autre opérateur n'existe.
- N'invente AUCUN champ. Pas de destinataire : le message part toujours au
  client concerné.
- Les messages sont écrits en ${fr ? 'français québécois, tutoiement, ton d\'entrepreneur — court et direct' : 'plain English, short and direct'}.
- Utilise les variables entre crochets quand c'est utile : [client_first_name],
  [company_name], [invoice_total], [quote_number], [appointment_date].

Réponds UNIQUEMENT par le JSON.`;
}

/**
 * Extrait le JSON d'une réponse, même si le modèle l'a entouré de texte.
 *
 * On demande « uniquement le JSON », mais un modèle ajoute parfois une
 * phrase ou des balises de code. Échouer là-dessus serait absurde.
 */
function extraireJson(texte: string): unknown {
  const nettoye = texte.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf('{');
    const fin = nettoye.lastIndexOf('}');
    if (debut >= 0 && fin > debut) {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    }
    throw new Error('réponse illisible');
  }
}

export interface ResultatGeneration {
  parcours: ParcoursPropose | null;
  /** Message à afficher si rien n'a pu être généré. */
  erreur?: string;
}

export async function genererParcours(params: {
  admin: SupabaseClient;
  orgId: string;
  userId: string | null;
  demande: string;
  langue: 'fr' | 'en';
}): Promise<ResultatGeneration> {
  const { admin, orgId, userId, demande, langue } = params;
  const fr = langue === 'fr';

  if (!isLumiConfigured()) {
    return { parcours: null, erreur: fr ? 'Lumi n’est pas configuré.' : 'Lumi is not configured.' };
  }

  const systeme = consignes(fr);

  // Le budget d'abord : on ne lance pas un appel qu'on ne peut pas payer.
  const estimation = estimationCoutAppel(MODELE, systeme.length + demande.length, MAX_TOKENS, 0);
  const reservation = await reserverBudget(admin, orgId, estimation).catch((e: unknown) => {
    logger.error('[lumi/parcours] réservation impossible', { message: e instanceof Error ? e.message : String(e) });
    return { id: null, statut: 'indisponible' as const };
  });

  if (reservation.statut === 'capped' || reservation.statut === 'plan_sans_lumi') {
    return {
      parcours: null,
      erreur: fr
        ? 'Le budget Lumi du mois est atteint. Le parcours peut être construit à la main avec le « + ».'
        : 'This month’s Lumi budget is used up. You can still build the path by hand with “+”.',
    };
  }

  try {
    const reponse = await clientAnthropic().messages.create({
      model: MODELE,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: systeme, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: demande.slice(0, 2_000) }],
    });

    const u = reponse.usage;
    // `coutEnCents` prend l'usage BRUT de l'API : il sait lire un id daté et
    // distinguer les écritures de cache 5 min / 1 h.
    const modeleRendu = reponse.model ?? MODELE;
    await journaliserUsage(admin, {
      orgId,
      userId,
      conversationId: null,
      model: modeleRendu,
      input_tokens: u?.input_tokens ?? 0,
      output_tokens: u?.output_tokens ?? 0,
      cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
      cost_cents: coutEnCents(modeleRendu, u ?? { input_tokens: 0, output_tokens: 0 }),
      // `source` est borné par une contrainte CHECK en base : 'lumi' est la
      // valeur juste ici, c'est bien lui qui génère.
      source: 'lumi',
    });

    const texte = reponse.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');

    const brut = extraireJson(texte) as Partial<ParcoursPropose>;
    if (!brut?.trigger_event || !Array.isArray(brut.steps) || brut.steps.length === 0) {
      return {
        parcours: null,
        erreur: fr
          ? 'Lumi n’a pas réussi à construire ce parcours. Reformule en une phrase, ou construis-le avec le « + ».'
          : 'Lumi could not build that path. Rephrase it in one sentence, or build it with “+”.',
      };
    }

    return {
      parcours: {
        nom: String(brut.nom ?? (fr ? 'Nouvelle automatisation' : 'New automation')).slice(0, 120),
        trigger_event: String(brut.trigger_event),
        resume: String(brut.resume ?? '').slice(0, 300),
        steps: brut.steps as Array<Record<string, unknown>>,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[lumi/parcours] génération échouée', { message, org_id: orgId });
    return {
      parcours: null,
      erreur: fr
        ? 'Lumi n’a pas pu répondre. Réessaie, ou construis le parcours avec le « + ».'
        : 'Lumi could not answer. Try again, or build the path with “+”.',
    };
  }
}
