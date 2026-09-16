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
 * ce qui calibre le seuil sur du trafic réel avant d'activer quoi que ce soit.
 * MODE ACTIF (LUMI_ROUTEUR=actif, étage 5 dans routes/lumi.ts, audit B6) :
 * une action déterministe reconnue avec confiance ≥ SEUIL_CONFIANCE répond
 * sans le gros modèle (raccourciDepuisAction → repondreRaccourci) ; tout le
 * reste (doute, hors scope, multi) va au modèle avec le verdict tracé.
 * Coût : ~600 tokens de prompt (cache 1 h) + l'énoncé, sur Haiku (~0,03 ¢),
 * journalisé dans ai_usage.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { clientAnthropic } from './llm';
import { z } from 'zod';
import { TOPICS, type IdTopic } from './topics';
import { IDS_RACCOURCIS, PERIODES_AGENDA, ENONCES_EXACTS } from './raccourcis';
import { logger } from '../logger';

export const SEUIL_CONFIANCE = 0.85;
export const MODELE_ROUTEUR = 'claude-haiku-4-5';
export type ModeRouteur = 'off' | 'observation' | 'actif';

export function modeRouteur(env: NodeJS.ProcessEnv = process.env): ModeRouteur {
  if (env.LUMI_ROUTEUR === 'actif') return 'actif';
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

/** Exporté pour les scripts de mesure (count_tokens) et les tests ; ≥ 4 096 tokens exigés par le cache de Haiku 4.5. */
export const PROMPT_ROUTEUR = `Tu classes UN message d'un utilisateur de Lume (CRM d'entreprise de services au Québec) dans un topic, et tu dis si une action déterministe connue y répond exactement.

Topics (et ce que chacun refuse, renvoyé au topic voisin) :
${TOPICS.map((t) => `- ${t.id} : ${t.description} Refuse : ${t.refuse}`).join('\n')}
Une question « comment je fais … dans Lume » (mode d'emploi, abonnement, facturation de Lume) va au topic du sujet, action null — jamais hors_scope.

Actions déterministes (réponse gabarit, sans modèle) — seulement si le message demande EXACTEMENT ça, sans précision de client, de ville, de période autre que celles permises :
- clients-total : combien de clients au total
- agenda (params.periode = aujourdhui | demain | semaine) : ce qui est planifié sur cette période
- revenu-mois : encaissé / facturé ce mois-ci
- retards : FACTURES en retard, paiements en retard, qui doit de l'argent — jamais les jobs ou visites en retard (ça, c'est planification, action null)
- briefing : survol du jour, quoi de neuf
- top-clients (params.limit) : meilleurs clients
- taches : tâches à faire
- equipe : qui est dans l'équipe
- devis-attente : devis en attente de réponse
- ou-equipe : où est l'équipe en ce moment
- job-numero (params.numero) : montrer le job numéro N

Règles : action = null dès qu'il y a un doute, une écriture (créer, envoyer, modifier, annuler), un nom propre, une ville ou une période non permise. Plusieurs sujets ou actions → topic multi, action null. confidence entre 0 et 1, honnête.
Suites de conversation : quand un échange précédent est fourni et que le message s'y rapporte (« il », « elle », « ça », « lui », « le pire », « lequel », « la plus vieille », « et pour… »), action null — le modèle complet a le contexte, pas toi. Seule exception : un simple changement de période après une question d'agenda (« pis cette semaine ? », « et demain ? », « et aujourd'hui ? ») reste agenda avec la nouvelle période.

Exemples (québécois oral, fautes incluses) :
- « cb jai de job dmain », « chu tu occupé demain matin ? », « c'est quoi mon horaire demain » → planification, agenda, periode demain
- « pis cette semaine ? », « ma semaine ça ressemble à quoi », « what's my week like » → planification, agenda, periode semaine
- « qu'est-ce que j'ai aujourd'hui », « ma journée d'aujourd'hui » → planification, agenda, periode aujourdhui
- « qui me doit de l'argent », « mes factures en retard », « c'est qui qui a pas payé », « les comptes en souffrance » → facturation, retards
- « mes jobs en retard », « les jobs pas finis », « les visites qui traînent » → planification, action null (des jobs, pas des factures)
- « mon brief », « quoi de neuf », « ma journée », « résume-moi ma journée » → rapports, briefing
- « combien de clients j'ai », « j'ai combien de clients en tout » → clients, clients-total
- « mes meilleurs clients », « top 5 de mes clients », « qui me rapporte le plus » → clients, top-clients, limit 5
- « mes tâches », « qu'est-ce que j'ai à faire », « ma to-do » → equipe, taches
- « c'est qui dans mon équipe », « mon équipe », « mes employés » → equipe, equipe
- « où est mon équipe », « ma gang est où là », « ils sont rendus où » → planification, ou-equipe
- « mes soumissions en attente », « les devis pas répondus », « quelles soumissions attendent » → facturation, devis-attente
- « montre-moi le job 33 », « job numéro 33 », « la job #33 » → planification, job-numero, numero 33
- « c'est quoi la liste de vérification du job 33 », « y a-tu un contrat sur le job 33 », « prépare un contrat pour le job 33 », « facture le job 33 » → topic du sujet, action null (job-numero SEULEMENT quand on veut voir le job et rien d'autre ; un numéro dans une autre demande n'est pas job-numero)
- « combien j'ai facturé ce mois-ci », « mes revenus du mois », « ça donne quoi ce mois-ci » → facturation, revenu-mois
- « montre-moi les paiements reçus ce mois-ci », « la liste des paiements », « qui a payé cette semaine » → facturation, action null (une LISTE, pas le total)
- « quelles équipes (crews) j'ai », « mes équipes », « les groupes de mon équipe » → equipe, action null (les équipes nommées, pas la liste des membres)
- « retire la carte enregistrée de Gagnon », « sa carte de crédit au dossier », « charge sa carte » → facturation, action null (carte de paiement, pas le pipeline)
- « relance mes retards », « envoie un texto à Tremblay », « crée une job chez Gagnon » → topic du sujet, action null (écriture)
- « parle-moi de Marie Tremblay », « les factures de Gagnon », « c'est quoi le numéro de Lapointe » → topic du sujet, action null (nom propre)
- « mes revenus vs le mois passé », « pourquoi c'est plus bas que juillet » → facturation, action null (comparaison)
- « les jobs de Victoriaville », « on est-tu à Sherbrooke bientôt » → planification, action null (ville)
- « mon paiement Lume a échoué », « comment j'envoie une facture » → facturation, action null (mode d'emploi)
- « c'est quoi la capitale de l'Australie », « écris-moi un poème » → hors_scope
- « mon horaire de demain pis mes factures en retard » → multi, action null
- après « c'est quoi mon horaire demain » : « pis cette semaine ? » → planification, agenda, periode semaine ; « et aujourd'hui ? » → planification, agenda, periode aujourdhui
- après une liste de factures en retard : « c'est qui le pire ? », « laquelle traîne depuis le plus longtemps ? » → facturation, action null (se rapporte à la liste)
- après une fiche client : « il a-tu des factures pas payées ? », « son numéro ? » → topic du sujet, action null (« il » = ce client)
- après « comment j'envoie une facture » : « et pour la marquer payée ? » → facturation, action null (mode d'emploi, suite)

Énoncés déjà reconnus tels quels par le code (mêmes actions, à reconnaître aussi reformulés) :
${ENONCES_EXACTS.map(([e, a]) => `- « ${e} » → ${a.id}${a.periode ? `, periode ${a.periode}` : ''}`).join('\n')}

Autres formulations courantes → topic, action :
- « y me reste tu des jobs à faire aujourd'hui » → planification, agenda, periode aujourdhui
- « on a tu de quoi de cédulé lundi » → planification, action null (jour précis non permis)
- « trouve-moi un trou de 2 h jeudi » → planification, action null (créneau)
- « la job de Tremblay est rendue où » → planification, action null (nom propre)
- « mets Marc sur la job 12 » → planification, action null (écriture)
- « optimise ma run de demain », « prépare-moi ma tournée d'aujourd'hui », « ma tournée » → planification, action null (une tournée = le trajet optimisé, pas l'agenda)
- « c'est quoi la meilleure route pour aujourd'hui » → planification, action null
- « combien ça m'a coûté la job 41 » → facturation, action null (rentabilité d'un job)
- « envoie la facture à Gagnon » → facturation, action null (écriture)
- « marque la facture 18 payée » → facturation, action null (écriture)
- « fais-moi une soumission pour un nettoyage de vitres » → facturation, action null (écriture)
- « mes services les plus payants » → facturation, action null
- « je suis tu en avance sur mon objectif du mois » → facturation, revenu-mois
- « combien j'ai rentré cette semaine » → facturation, action null (période non permise)
- « qui sont mes clients à risque » → clients, action null
- « c'est quoi le numéro de Marie » → clients, action null (nom propre)
- « crée-moi un client Jean Roy » → clients, action null (écriture)
- « fusionne les deux Tremblay » → clients, action null (écriture)
- « j'ai tu des messages » → communications, action null
- « réponds à Sophie que j'arrive à 10 h » → communications, action null (écriture)
- « écris un courriel de remerciement à Lapointe » → communications, action null (écriture)
- « mes heures de la semaine », « la paie de mes gars » → equipe, action null
- « pointe-moi », « je commence ma journée », « je pars en pause », « je reviens de pause », « pointe-moi dehors » → equipe, action null (pointage, pas le brief)
- « ajoute une tâche rappeler le fournisseur » → equipe, action null (écriture)
- « qu'est-ce qui reste à faire » → equipe, taches
- « mes stats de porte-à-porte » → equipe, action null
- « fais-moi un rapport pour mon comptable » → rapports, action null
- « un PDF de mes retards » → rapports, action null
- « retiens que je ne travaille jamais le dimanche » → memoire, action null
- « oublie le prix des vitres » → memoire, action null
- « qu'est-ce que t'as fait pour moi hier » → memoire, action null
- « pourquoi l'automatisation a pas parti » → equipe, action null
- « comment je change mon logo » → clients, action null (mode d'emploi, jamais hors_scope)
- « peux-tu me bâtir un site web » → hors_scope
- « raconte-moi une blague » → hors_scope

Outils que chaque topic possède (aide à situer une demande ; tu ne les appelles jamais) :
${TOPICS.filter((t) => t.outils.length).map((t) => `- ${t.id} : ${t.outils.join(', ')}`).join('\n')}

English phrasings (same rules) :
- "what's on tomorrow", "am I busy tomorrow morning" → planification, agenda, periode demain
- "who owes me money", "overdue invoices" → facturation, retards
- "how many clients do I have" → clients, clients-total
- "my best clients" → clients, top-clients, limit 5
- "what's left on my to-do" → equipe, taches
- "where's my crew right now" → planification, ou-equipe
- "quotes waiting on the client" → facturation, devis-attente
- "show me job 33" → planification, job-numero, numero 33
- "how much did I bill this month" → facturation, revenu-mois
- "my morning brief", "what's new" → rapports, briefing
- "text Tremblay I'm running late" → communications, action null (écriture)
- "send the invoice to Gagnon" → facturation, action null (écriture)
- "tell me about Marie Tremblay" → clients, action null (nom propre)
- "late jobs", "jobs behind schedule" → planification, action null (des jobs, pas des factures)

Paramètres : periode ∈ aujourdhui | demain | semaine (lundi à dimanche de la semaine en cours) — tout autre jour ou intervalle → action null ; numero = les chiffres du job, sans « # » ; limit = nombre demandé (1 à 25), 5 par défaut.

Glossaire québécois oral (pour bien classer, jamais pour répondre) :
chu = je suis ; c'est tu / j'ai tu / y'a tu = est-ce que ; pis = puis, et ; faque / fait que = donc ; ben = très, bien ; tantôt = plus tôt ou plus tard aujourd'hui ; à matin = ce matin ; à soir = ce soir ; asteure = maintenant ; la fin de semaine = samedi et dimanche ; icitte = ici ; pantoute = pas du tout ; en masse = beaucoup ; pas pire = correct ; c'est correct = c'est bon ; une job = un travail, un chantier, un contrat ; une visite = un passage chez le client ; céduler = planifier, mettre à l'horaire ; booker = réserver ; canceller = annuler ; une gang = l'équipe ; mes gars = mes employés ; un estimé = un devis ; une soumission = un devis ; une facture = un invoice ; un check = un chèque ; du cash = comptant ; un dépôt = acompte ; un rappel / une relance = message pour un impayé ; les retards = factures impayées ; un compte = une facture à payer ; le mois passé = le mois dernier ; la semaine prochaine = les 7 jours après dimanche ; en retard (job) = pas fini à temps ; en retard (facture) = pas payée à l'échéance ; un client = personne ou entreprise servie ; un lead = client potentiel ; un texto = SMS ; un courriel = email ; la run / la route = les arrêts de la journée ; le truck / le char = le véhicule ; checker = vérifier ; loader = charger ; dispatcher = assigner les jobs ; le boss = le propriétaire ; la paie = feuilles de temps et salaires ; les heures = feuilles de temps ; magasiner = comparer des prix ; une formation = un cours ; le porte-à-porte = prospection sur le terrain ; une automatisation = règle automatique de Lume ; l'abonnement = le forfait Lume de l'entreprise ; un rapport = un document à produire (PDF) ; un brief = résumé de la journée.`;


/**
 * Classifie l'énoncé. Sortie JSON stricte via un outil unique (`classer`)
 * dont le schéma reflète verdictSchema ; forcée par tool_choice.
 */
/** L'échange précédent, tronqué, pour classer une suite de conversation (« pis cette semaine ? »). */
export interface ContexteRouteur { utilisateur: string; lumi: string }

/** Message envoyé au routeur : l'énoncé seul, ou précédé de l'échange précédent (pur, testé). */
export function messageRouteur(enonce: string, contexte?: ContexteRouteur | null): string {
  const e = enonce.slice(0, 1000);
  if (!contexte) return e;
  return `Échange précédent — utilisateur : « ${contexte.utilisateur.slice(0, 300)} » ; Lumi : « ${contexte.lumi.slice(0, 400)} »\n\nMessage à classer : « ${e} »`;
}

export async function classifier(enonce: string, contexte?: ContexteRouteur | null): Promise<ResultatRouteur> {
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
      messages: [{ role: 'user', content: messageRouteur(enonce, contexte) }],
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
