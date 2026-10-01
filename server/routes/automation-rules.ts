/* ═══════════════════════════════════════════════════════════════
   Routes — Automatisations personnalisées

   GET    /api/automations/rules        → catalogue + règles de l'org
   POST   /api/automations/rules        → créer
   PATCH  /api/automations/rules/:id    → modifier
   DELETE /api/automations/rules/:id    → supprimer
   POST   /api/automations/rules/:id/duplicate → dupliquer

   POURQUOI PASSER PAR LE SERVEUR plutôt qu'écrire depuis le navigateur
   comme le fait déjà `toggleAutomationRule` : une automatisation envoie
   des textos et des courriels aux clients, au nom de l'entreprise. Ce
   n'est pas une donnée ordinaire. Trois choses ne peuvent se faire qu'ici :

   1. la validation Zod contre le catalogue — un déclencheur que le moteur
      n'émet jamais, ou une action qu'il ne sait pas exécuter, produirait
      une automatisation morte que personne ne saurait diagnostiquer ;
   2. les gardes qui demandent de lire le catalogue (délai négatif réservé
      aux rendez-vous) ;
   3. le refus de modifier ce qui appartient au moteur sur un préréglage
      (son `trigger_event`, son `preset_key`).

   La RLS reste la garde de fond (migration 20260924090000 : lecture =
   `automations.read`, écriture = `automations.update`). Les routes
   utilisent le client de l'utilisateur, jamais le client service_role qui
   la contourne : une faille ici ne peut donc pas franchir la frontière
   entre entreprises. Un test le vérifie.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { genererParcours } from '../lib/lumi/generer-parcours';
import { lireDejaPubliees, noteDejaPubliees, typesDAction } from '../lib/lumi/deja-publiees';
import { sequenceEtapes } from '../lib/validation';
import {
  validate, automationRuleCreateSchema, automationRuleUpdateSchema,
  dossierCreateSchema, dossierUpdateSchema, automationCopieBureauxSchema,
  automationModeleUtiliserSchema,
} from '../lib/validation';
import { MODELES_AUTOMATISATION, trouverModele } from '../lib/automationTemplates';
import { copierEtapes, nomDisponible } from '../../src/lib/automationTemplates';
import { projeterFormatOrigine } from '../../src/lib/sequenceTypes';
import { bureauxCibles, copierVersBureaux, propagerAuxCopies, type ResultatCopie } from '../lib/automatisations-bureaux';
import { logger } from '../lib/logger';
import { oublierPause } from '../lib/automations-pause-org';
import { drapeauActif, declencheurOffertA, refusDeclencheurNonOffert, type CleDrapeauAutomatisation } from '../lib/automations-drapeaux';
import { problemesBloquants, messageRefus, messagePublieeCassee, refAutomatisationInventee } from '../lib/automations-publication';
import { langueDe, repondreDansLaLangue } from '../lib/automations-langue';
import { problemeJoursAvant } from '../lib/rappels-dates';
import {
  DECLENCHEURS,
  ACTIONS,
  trouverDeclencheur,
  conditionsApresChangement,
  declencheurOffert,
  estPrereglageRetire,
  DELAI_NEGATIF_MAX_SECONDES,
} from '../../src/lib/automationCatalogue';

const router = Router();
// Les messages d'erreur partent dans la langue de l'interface (A-09).
router.use('/automations', repondreDansLaLangue);

/** Colonnes renvoyées au navigateur. `org_id` n'a aucun intérêt côté client. */
const COLONNES = 'id, name, description, trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, is_preset, preset_key, folder_id, modele_id, deleted_at, created_at, updated_at, lumi_conversation';

/** Champs dont la modification change le CONTENU d'une règle (pas son interrupteur ni son dossier). */
const CHAMPS_CONTENU = ['name', 'description', 'trigger_event', 'conditions', 'delay_seconds', 'actions', 'steps', 'settings'] as const;

/**
 * Les gardes qui ont besoin du catalogue, donc impossibles à exprimer en Zod
 * seul. Retourne un message en clair, ou null si tout va bien.
 */
export function verifierCoherence(corps: {
  trigger_event?: string;
  delay_seconds?: number;
  actions?: Array<{ type: string }>;
  /** Les conditions qu'on s'apprête à ÉCRIRE (absentes d'un PATCH qui n'y touche pas). */
  conditions?: Record<string, unknown> | null;
}, fr = true): string | null {
  const { trigger_event, delay_seconds, actions, conditions } = corps;

  // « Date atteinte » : le balayage ne sait viser qu'un nombre ENTIER de
  // jours, entre -365 et 365. « 3.5 » ou « 400 » s'enregistraient, et la
  // règle ne partait jamais, sans erreur (J-063).
  if (trigger_event === 'date.reached' && conditions) {
    const probleme = problemeJoursAvant(conditions.jours_avant, fr);
    if (probleme) return probleme;
  }

  // Un délai négatif = « X avant la date de référence ». Le moteur ne sait le
  // calculer que pour les rendez-vous (`resolveExecuteAt`) : ailleurs, il n'y
  // a pas de date future à laquelle se raccrocher, et la tâche partirait
  // immédiatement — l'inverse de ce que l'utilisateur a demandé.
  if (typeof delay_seconds === 'number' && delay_seconds < 0) {
    if (!trigger_event) {
      return 'Pour envoyer avant, il faut préciser le déclencheur.';
    }
    const decl = trouverDeclencheur(trigger_event);
    if (!decl?.accepte_delai_negatif) {
      return fr
        ? `« ${decl?.fr ?? trigger_event} » n'a pas de date future : on ne peut pas envoyer avant. Utilisez un délai après l'événement.`
        : `“${decl?.en ?? trigger_event}” has no future date: you cannot send before. Use a delay after the event.`;
    }
    if (delay_seconds < -DELAI_NEGATIF_MAX_SECONDES) {
      return 'On ne peut pas envoyer plus de 30 jours avant.';
    }
  }

  // Deux fois la même action avec le même texte : le client recevrait le
  // message en double. L'anti-doublon du moteur ne protège pas de ça — sa clé
  // inclut l'index de l'action, donc deux actions identiques sont deux tâches
  // légitimes à ses yeux.
  if (actions && actions.length > 1) {
    const vues = new Set<string>();
    for (const a of actions) {
      const empreinte = JSON.stringify([a.type, (a as { config?: unknown }).config]);
      if (vues.has(empreinte)) {
        return 'Deux actions identiques : le client recevrait le même message en double.';
      }
      vues.add(empreinte);
    }
  }

  return null;
}

// ── Catalogue + règles ──────────────────────────────────────

router.get('/automations/rules', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_rules')
    .select(COLONNES)
    .eq('org_id', auth.orgId)
    // Les règles à la corbeille sont renvoyées AVEC les autres : l'onglet
    // « Corbeille » en a besoin, et `deleted_at` suffit à les séparer côté
    // interface. Deux requêtes pour une liste de 40 lignes n'apporteraient
    // rien. Une règle supprimée DÉFINITIVEMENT n'apparaît plus nulle part.
    .is('purged_at', null)
    .order('name');

  if (error) {
    logger.error('[automation-rules] lecture échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire les automatisations.' });
  }

  return res.json({
    // Un préréglage retiré s'afficherait « publié » sans jamais partir.
    rules: ((data ?? []) as unknown as Array<{ preset_key: string | null; trigger_event: string | null }>).filter((r) => !estPrereglageRetire(r)),
    catalogue: await catalogueOffert(auth.client, auth.orgId),
  });
});

/**
 * Le catalogue voyage avec les règles : l'interface n'a pas à le dupliquer,
 * et une clé retirée ici disparaît du sélecteur sans redéploiement du front.
 * Un déclencheur réservé à une capacité en rodage n'est offert qu'aux
 * entreprises qui ont son drapeau : ailleurs, son événement n'est jamais émis.
 * Client de l'UTILISATEUR (RLS de org_features), comme tout ce fichier.
 */
async function catalogueOffert(client: SupabaseClient, orgId: string) {
  const actifs = new Set<string>();
  for (const d of DECLENCHEURS) {
    if (d.drapeau && !actifs.has(d.drapeau) && await drapeauActif(client, orgId, d.drapeau as CleDrapeauAutomatisation)) actifs.add(d.drapeau);
  }
  return { declencheurs: DECLENCHEURS.filter((d) => declencheurOffert(d, actifs)), actions: ACTIONS };
}

/*
 * GET /automations/editeur?rule_id=… — ce que l'ÉDITEUR affiche (PERF-2).
 *
 * L'éditeur chargeait TOUTES les règles (316 ko à 400 règles) pour en
 * afficher une. Il reçoit maintenant sa règle (par id), le catalogue, et la
 * liste LÉGÈRE (id, nom) des autres automatisations publiées, pour l'action
 * « Démarrer une automatisation ». Sans `rule_id` (`/nouvelle`) : pas de
 * règle. Règle absente : `rule: null` (l'écran dit « introuvable »).
 */
router.get('/automations/editeur', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const ruleId = typeof req.query.rule_id === 'string' && req.query.rule_id ? req.query.rule_id : null;
  if (ruleId && !/^[0-9a-f-]{36}$/i.test(ruleId)) {
    return res.json({ rule: null, catalogue: await catalogueOffert(auth.client, auth.orgId), autres: [] });
  }

  const [regle, autres] = await Promise.all([
    ruleId
      ? auth.client.from('automation_rules').select(COLONNES).eq('id', ruleId).eq('org_id', auth.orgId).is('purged_at', null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    auth.client
      .from('automation_rules')
      .select('id, name, preset_key, trigger_event')
      .eq('org_id', auth.orgId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
  ]);
  if (regle.error || autres.error) {
    logger.error('[automation-rules] lecture de l’éditeur échouée', { message: (regle.error ?? autres.error)?.message });
    return res.status(500).json({ error: 'Impossible de lire l’automatisation.' });
  }
  return res.json({
    rule: regle.data ?? null,
    catalogue: await catalogueOffert(auth.client, auth.orgId),
    // Jamais la règle ouverte elle-même : une automatisation qui se démarre boucle.
    // Ni un préréglage retiré : « Démarrer » une automatisation qui ne part jamais.
    autres: ((autres.data ?? []) as Array<{ id: string; name: string; preset_key: string | null; trigger_event: string | null }>)
      .filter((r) => r.id !== ruleId && !estPrereglageRetire(r))
      .map((r) => ({ id: r.id, name: r.name })),
  });
});

// ── Créer ───────────────────────────────────────────────────

/**
 * Le dossier choisi appartient-il à CE bureau ? (launch 2026-09-28)
 * Un identifiant de dossier venu du navigateur n'était pas vérifié : une
 * règle pouvait pointer vers le dossier d'une autre entreprise.
 */
async function dossierDuBureau(client: SupabaseClient, orgId: string, folderId: unknown): Promise<boolean> {
  if (folderId === undefined || folderId === null) return true;
  const { data, error } = await client.from('automation_folders').select('id').eq('id', String(folderId)).eq('org_id', orgId).maybeSingle();
  return !error && !!data;
}

router.post('/automations/rules', validate(automationRuleCreateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await dossierDuBureau(auth.client, auth.orgId, req.body.folder_id))) {
    return res.status(400).json({ error: 'Dossier introuvable dans ce bureau.' });
  }

  const fr = langueDe(req) === 'fr';
  const probleme = verifierCoherence(req.body, fr);
  if (probleme) return res.status(400).json({ error: probleme });
  // Un déclencheur en rodage, pas offert à cette entreprise : la règle ne partirait jamais.
  if (!(await declencheurOffertA(auth.client, auth.orgId, req.body.trigger_event))) {
    return res.status(400).json({ error: refusDeclencheurNonOffert(req.body.trigger_event, fr), code: 'declencheur_non_offert' });
  }

  // Naître publiée = publier : mêmes vérifications que la route de publication (M8).
  if (req.body.is_active === true) {
    const problemes = problemesBloquants(req.body, fr);
    if (problemes.length) return res.status(422).json({ error: messageRefus(problemes, fr), code: 'publication_refusee', problemes });
  }

  const { data, error } = await auth.client
    .from('automation_rules')
    .insert({
      org_id: auth.orgId,
      name: req.body.name,
      description: req.body.description ?? '',
      trigger_event: req.body.trigger_event,
      conditions: req.body.conditions ?? {},
      delay_seconds: req.body.delay_seconds,
      actions: req.body.actions,
      // `steps` non fourni = règle simple : la colonne reste NULL et le moteur
      // garde exactement le comportement d'avant.
      steps: req.body.steps ?? null,
      settings: req.body.settings ?? null,
      // Une automatisation naît en pause : elle écrit aux clients, personne ne
      // doit en démarrer une par accident en fermant le formulaire.
      is_active: req.body.is_active ?? false,
      is_preset: false,
      preset_key: null,
    })
    .select(COLONNES)
    .single();

  if (error) {
    // 42501 = la RLS a refusé : l'utilisateur n'a pas `automations.update`.
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une automatisation.' });
    }
    logger.error('[automation-rules] création échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer l\'automatisation.' });
  }

  return res.status(201).json(data);
});

// ── Lumi construit un parcours ──────────────────────────────

/**
 * Retire (suppression douce) une règle SI elle est un brouillon vide et tout
 * juste né : inactive, sans étape, sans conversation, créée il y a moins de
 * 10 minutes. Rien d'autre n'est jamais touché. Vrai si elle a été retirée.
 */
async function retirerBrouillonVide(client: SupabaseClient, orgId: string, ruleId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(ruleId)) return false;
  const { data, error } = await client
    .from('automation_rules')
    .select('id, is_active, steps, lumi_conversation, created_at')
    .eq('id', ruleId).eq('org_id', orgId).is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return false;
  const vide = !data.is_active
    && (!Array.isArray(data.steps) || data.steps.length === 0)
    && (!Array.isArray(data.lumi_conversation) || data.lumi_conversation.length === 0)
    && Date.now() - Date.parse(String(data.created_at)) < 10 * 60_000;
  if (!vide) return false;
  const { error: eRetrait } = await client
    .from('automation_rules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', ruleId).eq('org_id', orgId).is('deleted_at', null);
  if (eRetrait) {
    logger.error('[lumi/parcours] brouillon vide non retiré', { rule_id: ruleId, message: eRetrait.message });
    return false;
  }
  return true;
}


/**
 * POST /api/automations/rules/generer
 *
 * Lumi PROPOSE un parcours ; il n'enregistre rien. La proposition est
 * renvoyée au navigateur, dessinée dans le canevas, et c'est l'utilisateur
 * qui décide de la garder. C'est la règle du projet : une écriture n'est
 * jamais exécutée par l'orchestrateur.
 *
 * Ce que Lumi renvoie repasse par la MÊME validation que ce qu'un humain
 * enregistre. Un modèle qui inventerait un déclencheur, une action hors
 * catalogue ou une boucle est refusé ici — avant que l'utilisateur ne voie
 * un parcours qui ne pourrait jamais tourner.
 */
router.post('/automations/rules/generer', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  /*
   * Une génération qui échoue ne laisse pas de brouillon vide : l'éditeur
   * crée la règle au PREMIER envoi (pour y garder la conversation) et elle
   * restait en base, « Nouvelle automatisation » sans étape, quand rien
   * n'était construit (audit V2, L-7). Le serveur sait ce qui est vide.
   */
  const ruleIdEnvoye = typeof (req.body as { rule_id?: unknown })?.rule_id === 'string'
    ? String((req.body as { rule_id: string }).rule_id) : null;
  const refuser = async (corpsReponse: Record<string, unknown>) => {
    const retire = ruleIdEnvoye ? await retirerBrouillonVide(auth.client, auth.orgId, ruleIdEnvoye) : false;
    return res.status(422).json({ ...corpsReponse, brouillon_retire: retire });
  };

  const demande = String((req.body as { demande?: unknown })?.demande ?? '').trim();
  if (demande.length < 10) {
    return res.status(400).json({ error: 'Décris ton automatisation en une phrase.' });
  }
  const langue = (req.body as { langue?: string })?.langue === 'en' ? 'en' : 'fr';

  // Le budget et le journal des coûts vivent côté service_role : la RLS
  // interdirait à l'utilisateur d'écrire dans `ai_usage`.
  /*
   * Le contexte vient du navigateur : l'éditeur sait ce qui est à
   * l'écran et ce qui a déjà été dit. Sans lui, Lumi ne recevait que la
   * dernière phrase et reconstruisait tout depuis zéro — QA du
   * 2026-09-25 (P1-6, P1-7).
   *
   * On ne fait CONFIANCE à rien de tout ça : c'est du contexte pour le
   * modèle, jamais une donnée qu'on enregistre. Le parcours produit
   * repasse par `sequenceEtapes` comme avant.
   */
  const corps = req.body as {
    echanges?: Array<{ role?: string; content?: string }>;
    parcours_actuel?: { trigger_event?: string; steps?: unknown[] } | null;
  };
  const echanges = Array.isArray(corps?.echanges)
    ? corps.echanges
        .filter((e) => e && typeof e.content === 'string' && (e.role === 'user' || e.role === 'assistant'))
        .slice(-6)
        .map((e) => ({ role: e.role as 'user' | 'assistant', content: String(e.content) }))
    : undefined;

  const resultat = await genererParcours({
    admin: getServiceClient(),
    orgId: auth.orgId,
    userId: auth.user.id,
    demande,
    langue,
    echanges,
    parcoursActuel: corps?.parcours_actuel ?? null,
  });

  if (!resultat.parcours) {
    // `sans_lumi` : l'écran propose Autopilot au lieu d'afficher une erreur.
    return refuser({ error: resultat.erreur ?? 'Lumi n’a rien pu construire.', sans_lumi: resultat.sansLumi === true });
  }

  // Le garde-fou : ce que Lumi propose doit passer la validation humaine.
  const verdict = sequenceEtapes.safeParse(resultat.parcours.steps);
  if (!verdict.success) {
    logger.error('[lumi/parcours] proposition invalide', {
      org_id: auth.orgId,
      motifs: verdict.error.issues.map((i) => i.message).slice(0, 3),
    });
    return refuser({
      error: langue === 'fr'
        ? 'Lumi a proposé un parcours que le moteur ne saurait pas exécuter. Reformule, ou construis-le avec le « + ».'
        : 'Lumi proposed a path the engine could not run. Rephrase, or build it with “+”.',
    });
  }

  const decl = trouverDeclencheur(resultat.parcours.trigger_event);
  if (!decl) {
    return refuser({
      error: langue === 'fr'
        ? 'Lumi a choisi un déclencheur qui n’existe pas. Reformule ta demande.'
        : 'Lumi picked a trigger that does not exist. Rephrase your request.',
    });
  }
  // Le prompt de Lumi liste tout le catalogue (il est partagé entre les
  // entreprises, donc en cache) : c'est ici qu'un déclencheur en rodage, pas
  // offert à CETTE entreprise, est refusé.
  if (!(await declencheurOffertA(auth.client, auth.orgId, decl.cle))) {
    return refuser({ error: refusDeclencheurNonOffert(decl.cle, langue === 'fr'), code: 'declencheur_non_offert' });
  }

  /*
   * Une étape qui désigne une AUTRE automatisation doit viser une règle qui
   * existe dans ce bureau. Lumi en a inventé une (« calendly_reply ») le
   * 2026-09-28 : l'étape était enregistrée et ne pouvait rien faire.
   */
  const inventee = await refAutomatisationInventee(auth.client, auth.orgId, verdict.data);
  if (inventee) {
    logger.error('[lumi/parcours] référence à une automatisation inexistante', { org_id: auth.orgId, rule_id: inventee });
    return refuser({
      error: langue === 'fr'
        ? 'Lumi a voulu relier une automatisation qui n’existe pas. Redemande-le autrement (ex. : « quand le client répond, envoie mon lien Calendly »).'
        : 'Lumi tried to link an automation that does not exist. Ask again differently.',
    });
  }

  /*
   * La deuxième automatisation (autre déclencheur) passe les MÊMES gardes.
   * Invalide : on la laisse tomber et on garde la première — refuser tout
   * ferait perdre un parcours correct pour un ajout raté.
   */
  let autre: {
    nom: string; trigger_event: string; resume: string; steps: unknown[]; une_fois_par_client_jours?: number;
  } | null = null;
  const a = resultat.parcours.autre;
  if (a) {
    const verdictAutre = sequenceEtapes.safeParse(a.steps);
    const inventeeAutre = verdictAutre.success
      ? await refAutomatisationInventee(auth.client, auth.orgId, verdictAutre.data)
      : null;
    if (verdictAutre.success && trouverDeclencheur(a.trigger_event) && !inventeeAutre && await declencheurOffertA(auth.client, auth.orgId, a.trigger_event)) {
      autre = { nom: a.nom, trigger_event: a.trigger_event, resume: a.resume, steps: verdictAutre.data, une_fois_par_client_jours: a.une_fois_par_client_jours };
    } else {
      logger.error('[lumi/parcours] deuxième automatisation écartée', {
        org_id: auth.orgId,
        motif: !verdictAutre.success ? verdictAutre.error.issues[0]?.message : (inventeeAutre ? 'référence inventée' : 'déclencheur inconnu'),
      });
    }
  }

  /*
   * « Tu en as déjà une » : au PREMIER tour d'une conversation, on signale
   * les automatisations publiées du bureau sur le même déclencheur — Lumi ne
   * les voit pas, et en bâtir une seconde fait un doublon silencieux (rep
   * notifié deux fois, client relancé deux fois). Aux tours suivants, la
   * note serait du bruit : elle a déjà été dite.
   */
  if (!echanges?.length) {
    const dejaLa = await lireDejaPubliees(auth.client, auth.orgId, resultat.parcours.trigger_event, ruleIdEnvoye, langue);
    resultat.parcours.resume += noteDejaPubliees(dejaLa, resultat.parcours.trigger_event, langue, typesDAction({ steps: verdict.data }));
  }

  /*
   * La conversation est gardée AVEC l'automatisation : fermer l'éditeur ne
   * fait plus oublier à Lumi ce qui a été dit (« plus poli », « jamais le
   * dimanche »). Écrite par le client de l'UTILISATEUR — la RLS décide qui
   * peut modifier cette règle — et bornée aux 40 derniers tours.
   * Un échec ici n'annule pas la génération : on le journalise.
   */
  const ruleId = typeof (req.body as { rule_id?: unknown })?.rule_id === 'string'
    ? String((req.body as { rule_id: string }).rule_id)
    : null;
  if (ruleId && /^[0-9a-f-]{36}$/i.test(ruleId)) {
    const { data: actuelle, error: lectureErr } = await auth.client
      .from('automation_rules')
      .select('lumi_conversation')
      .eq('id', ruleId)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (lectureErr || !actuelle) {
      logger.error('[lumi/parcours] conversation non lue', { rule_id: ruleId, message: lectureErr?.message ?? 'règle introuvable' });
    } else {
      const avant = Array.isArray(actuelle.lumi_conversation) ? actuelle.lumi_conversation : [];
      const conversation = [
        ...avant,
        { role: 'user', content: demande.slice(0, 2000) },
        {
          role: 'assistant',
          content: (
            (resultat.parcours.resume || (langue === 'fr' ? 'Parcours construit.' : 'Path built.'))
            + (autre ? (langue === 'fr' ? ` — Et une 2e automatisation, « ${autre.nom} » : ${autre.resume}` : ` — And a second automation, “${autre.nom}”: ${autre.resume}`) : '')
          ).slice(0, 2000),
        },
      ].slice(-40);
      const { error: ecritureErr } = await auth.client
        .from('automation_rules')
        .update({ lumi_conversation: conversation })
        .eq('id', ruleId)
        .eq('org_id', auth.orgId);
      if (ecritureErr) {
        logger.error('[lumi/parcours] conversation non gardée', { rule_id: ruleId, message: ecritureErr.message });
      }
    }
  }

  return res.json({
    nom: resultat.parcours.nom,
    trigger_event: resultat.parcours.trigger_event,
    resume: resultat.parcours.resume,
    steps: verdict.data,
    autre,
  });
});

// ── Modifier ────────────────────────────────────────────────

router.patch('/automations/rules/:id', validate(automationRuleUpdateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await dossierDuBureau(auth.client, auth.orgId, req.body.folder_id))) {
    return res.status(400).json({ error: 'Dossier introuvable dans ce bureau.' });
  }

  const { data: existante, error: lectureErr } = await auth.client
    .from('automation_rules')
    .select('id, is_preset, is_active, trigger_event, delay_seconds, modele_id, conditions, steps, actions, deleted_at')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('purged_at', null)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant modification échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });
  /*
   * À LA CORBEILLE : on restaure d'abord. L'éditeur s'ouvrait par son adresse
   * sur une règle supprimée et la laissait réécrire (texte d'une étape changé
   * en base, audit du 2026-10-01) — on modifiait sans le savoir une
   * automatisation qui ne partira plus.
   */
  if (existante.deleted_at) {
    return res.status(409).json({
      error: langueDe(req) === 'fr'
        ? 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.'
        : 'This automation is in the bin: restore it to edit it.',
    });
  }

  const patch = { ...req.body };
  const contenuModifie = CHAMPS_CONTENU.some((k) => k in patch);
  // Modifier une copie liée la détache de son modèle : sinon la prochaine
  // modification du modèle écraserait ce qu'on vient d'écrire ici.
  if (existante.modele_id && contenuModifie) patch.modele_id = null;

  // Sur un préréglage, le déclencheur appartient au moteur : les conditions
  // d'arrêt (`checkStopConditions`) et le seeder s'appuient sur le couple
  // (preset_key, trigger_event). Le renommer, changer son texte, son délai ou
  // l'éteindre reste permis — c'est le sens même de « personnalisable ».
  if (existante.is_preset && 'trigger_event' in patch && patch.trigger_event !== existante.trigger_event) {
    return res.status(400).json({
      error: 'Le déclencheur d\'une automatisation fournie ne se change pas. Dupliquez-la pour en faire une à vous.',
    });
  }

  /*
   * Changer de déclencheur SANS dire quoi faire des conditions : les réglages
   * de l'ancien ne doivent pas rester (une règle qui garde « première
   * ouverture » sur « Étiquette ajoutée » ne part jamais). L'éditeur envoie
   * déjà les bonnes conditions ; ceci couvre tout autre client.
   */
  if (typeof patch.trigger_event === 'string' && patch.trigger_event !== existante.trigger_event && !('conditions' in patch)) {
    patch.conditions = conditionsApresChangement(
      existante.trigger_event, patch.trigger_event, (existante.conditions ?? {}) as Record<string, unknown>,
    );
  }

  const fr = langueDe(req) === 'fr';
  const probleme = verifierCoherence({
    trigger_event: patch.trigger_event ?? existante.trigger_event,
    delay_seconds: patch.delay_seconds ?? existante.delay_seconds,
    actions: patch.actions,
    // Seulement si ce PATCH écrit les conditions : une règle déjà hors bornes
    // reste renommable, déplaçable, dépubliable.
    conditions: patch.conditions,
  }, fr);
  if (probleme) return res.status(400).json({ error: probleme });
  // Seulement si ce PATCH CHANGE le déclencheur : une règle existante reste
  // renommable, déplaçable, dépubliable.
  if (typeof patch.trigger_event === 'string' && patch.trigger_event !== existante.trigger_event
    && !(await declencheurOffertA(auth.client, auth.orgId, patch.trigger_event))) {
    return res.status(400).json({ error: refusDeclencheurNonOffert(patch.trigger_event, fr), code: 'declencheur_non_offert' });
  }

  // Publier par ce chemin passe par les mêmes vérifications que la route de
  // publication (M8), sur la règle telle qu'elle SERA après modification.
  if (patch.is_active === true) {
    // Une règle à la corbeille ne se publie pas : même refus que la route de
    // publication (`changerPublication`). Sans lui, ce chemin écrivait
    // `is_active: true` sur une règle supprimée — invisible dans la liste, et
    // affichée « publiée » dès sa restauration (J-065).
    if (existante.deleted_at) {
      return res.status(422).json({
        error: 'Cette automatisation est à la corbeille : restaurez-la avant de la publier.',
        code: 'publication_refusee',
      });
    }
    const problemes = problemesBloquants({ ...existante, ...patch }, fr);
    if (problemes.length) return res.status(422).json({ error: messageRefus(problemes, fr), code: 'publication_refusee', problemes });
  }

  /*
   * UNE AUTOMATISATION PUBLIÉE NE SE CASSE PAS EN SILENCE (audit V2, A-03).
   *
   * Changer le déclencheur d'une règle publiée (« Facture envoyée » →
   * « Nouveau prospect ») laissait « Envoyer la facture » sans facture : la
   * règle restait publiée et ne faisait plus rien. On rejoue les contrôles
   * de publication sur l'état FINAL dès que le parcours bouge, et on refuse
   * ce qui AJOUTE un problème. Une règle publiée déjà cassée (d'avant la
   * garde) reste corrigeable pas à pas ; la dépublier n'est jamais refusé.
   */
  const parcoursModifie = (['trigger_event', 'steps', 'actions', 'conditions'] as const).some((k) => k in patch);
  if (existante.is_active && patch.is_active === undefined && parcoursModifie) {
    const avant = new Set(problemesBloquants(existante, fr));
    const nouveaux = problemesBloquants({ ...existante, ...patch }, fr).filter((p) => !avant.has(p));
    if (nouveaux.length) {
      return res.status(422).json({ error: messagePublieeCassee(nouveaux, fr), code: 'publiee_cassee', problemes: nouveaux });
    }
  }

  const { data, error } = await auth.client
    .from('automation_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select(COLONNES)
    .single();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de modifier une automatisation.' });
    }
    logger.error('[automation-rules] modification échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de modifier l\'automatisation.' });
  }

  // Modèle partagé : ses copies des autres bureaux suivent.
  let copies: ResultatCopie[] = [];
  if (contenuModifie) {
    try {
      copies = await propagerAuxCopies(req.header('authorization') as string, auth.user.id, auth.orgId, req.params.id);
    } catch (err: any) {
      logger.error('[automation-rules] propagation aux copies échouée', { rule_id: req.params.id, message: err?.message });
    }
  }

  return res.json(copies.length ? { ...data, copies } : data);
});

// ── Bibliothèque de modèles ─────────────────────────────────
//
// GET : le catalogue, global et en lecture seule — ouvrir la bibliothèque
// n'écrit RIEN. POST : « Utiliser ce modèle » crée UNE automatisation, copie
// profonde du modèle, en brouillon, dans l'entreprise de la SESSION. Aucune
// autre règle n'est touchée (un seul INSERT, aucun UPDATE).

router.get('/automations/templates', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.json({ modeles: MODELES_AUTOMATISATION });
});

/**
 * Double clic = une seule copie. La clé d'idempotence (en-tête
 * `Idempotency-Key`, générée à l'ouverture de l'aperçu) est retenue 10 min
 * par entreprise : le 2e appel reçoit la MÊME réponse que le 1er, même s'il
 * arrive pendant que le 1er s'exécute encore.
 */
const utilisationsEnCours = new Map<string, { expire: number; resultat: Promise<{ status: number; body: unknown }> }>();
const IDEMPOTENCE_MS = 10 * 60_000;

router.post('/automations/templates/utiliser', validate(automationModeleUtiliserSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { templateId } = req.body as { templateId: string };
  const modele = trouverModele(templateId);
  if (!modele) return res.status(404).json({ error: 'Modèle introuvable.' });

  const cleBrute = String(req.header('idempotency-key') ?? '').slice(0, 100);
  const cle = cleBrute ? `${auth.orgId}:${cleBrute}` : '';
  const maintenant = Date.now();
  for (const [k, v] of utilisationsEnCours) if (v.expire < maintenant) utilisationsEnCours.delete(k);
  const deja = cle ? utilisationsEnCours.get(cle) : undefined;
  if (deja) {
    const r = await deja.resultat;
    return res.status(r.status).json(r.body);
  }

  const travail = (async (): Promise<{ status: number; body: unknown }> => {
    const [{ data: reglages }, { data: noms, error: nomsErr }] = await Promise.all([
      auth.client.from('company_settings').select('default_language').eq('org_id', auth.orgId).maybeSingle(),
      auth.client.from('automation_rules').select('name').eq('org_id', auth.orgId).is('deleted_at', null),
    ]);
    if (nomsErr) {
      logger.error('[automation-templates] lecture des noms échouée', { message: nomsErr.message });
      return { status: 500, body: { error: 'Impossible de créer l’automatisation.' } };
    }
    const en = reglages?.default_language === 'en';
    const nom = nomDisponible(en ? modele.nom.en : modele.nom.fr, (noms ?? []).map((n) => String(n.name ?? '')));
    let compteur = 0;
    // Toujours un PARCOURS, modifiable étape par étape dans l'éditeur. Un
    // modèle d'une seule vague (actions + délai) est projeté comme le fait
    // la conversion de l'éditeur : l'attente en tête (« X avant le
    // rendez-vous » pour un délai négatif), puis les actions dans l'ordre.
    // Sans ça, la copie s'ouvrait en lecture seule (Rafba, 2026-09-30).
    const source = modele.steps ?? projeterFormatOrigine({ actions: modele.actions, delay_seconds: modele.delai_secondes });
    const steps = copierEtapes(source, () => `e${++compteur}`);

    const { data, error } = await auth.client
      .from('automation_rules')
      .insert({
        org_id: auth.orgId,
        name: nom.slice(0, 120),
        description: en ? modele.description.en : modele.description.fr,
        trigger_event: modele.declencheur,
        conditions: JSON.parse(JSON.stringify(modele.conditions)),
        // Un parcours porte ses attentes dans ses étapes.
        delay_seconds: 0,
        actions: JSON.parse(JSON.stringify(modele.actions)),
        steps,
        settings: modele.settings ? JSON.parse(JSON.stringify(modele.settings)) : null,
        // Brouillon, jamais activée d'office. Une automatisation À SOI : ni
        // `is_preset` ni `preset_key` — le seeder ne la réécrira jamais.
        is_active: false,
        is_preset: false,
        preset_key: null,
      })
      .select(COLONNES)
      .single();

    if (error) {
      if (error.code === '42501') return { status: 403, body: { error: 'Votre rôle ne permet pas de créer une automatisation.' } };
      logger.error('[automation-templates] création échouée', { message: error.message, code: error.code, templateId });
      return { status: 500, body: { error: 'Impossible de créer l’automatisation.' } };
    }
    return { status: 201, body: data };
  })();

  if (cle) utilisationsEnCours.set(cle, { expire: maintenant + IDEMPOTENCE_MS, resultat: travail });
  try {
    const r = await travail;
    // Un échec n'est pas retenu : réessayer doit pouvoir réussir.
    if (cle && r.status >= 400) utilisationsEnCours.delete(cle);
    return res.status(r.status).json(r.body);
  } catch (e: unknown) {
    if (cle) utilisationsEnCours.delete(cle);
    logger.error('[automation-templates] création échouée', { message: e instanceof Error ? e.message : String(e), templateId });
    return res.status(500).json({ error: 'Impossible de créer l’automatisation.' });
  }
});

// ── Dupliquer ───────────────────────────────────────────────

router.post('/automations/rules/:id/duplicate', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: source, error: lectureErr } = await auth.client
    .from('automation_rules')
    .select('name, description, trigger_event, conditions, delay_seconds, actions, steps, settings')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant duplication échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!source) return res.status(404).json({ error: 'Automatisation introuvable.' });

  const { data, error } = await auth.client
    .from('automation_rules')
    .insert({
      org_id: auth.orgId,
      // Suffixe dans la langue de l'interface (audit V2, A-16).
      name: `${source.name} ${langueDe(req) === 'fr' ? '(copie)' : '(copy)'}`.slice(0, 120),
      description: source.description ?? '',
      trigger_event: source.trigger_event,
      conditions: source.conditions ?? {},
      delay_seconds: source.delay_seconds,
      actions: source.actions,
      steps: source.steps ?? null,
      settings: source.settings ?? null,
      // La copie d'un préréglage devient une automatisation À SOI : plus de
      // `preset_key`, donc le seeder ne la réécrira jamais, et tout y est
      // modifiable — y compris le déclencheur.
      is_active: false,
      is_preset: false,
      preset_key: null,
    })
    .select(COLONNES)
    .single();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une automatisation.' });
    }
    logger.error('[automation-rules] duplication échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de dupliquer l\'automatisation.' });
  }

  return res.status(201).json(data);
});

// ── Supprimer ───────────────────────────────────────────────

router.delete('/automations/rules/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: existante } = await auth.client
    .from('automation_rules')
    .select('id, is_preset')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });

  // Supprimer un préréglage ne servirait à rien : `ensureAutomationPresets`
  // le recrée au prochain démarrage, et l'utilisateur croirait à un bogue.
  // L'éteindre produit exactement l'effet voulu, définitivement.
  if (existante.is_preset) {
    return res.status(400).json({
      error: 'Une automatisation fournie ne se supprime pas — désactivez-la, l\'effet est le même.',
    });
  }

  /*
   * Les tâches déjà planifiées survivraient à la règle : elles s'exécuteraient
   * sans que rien ne les explique, ou échoueraient sans règle à pointer. On
   * les annule d'abord. `cancelled` plutôt qu'une suppression : le journal
   * garde la trace de ce qui était prévu.
   *
   * CLIENT SERVICE, et pas celui de l'utilisateur.
   *
   * `automation_scheduled_tasks` n'accorde à `authenticated` que le SELECT
   * (vérifié dans le catalogue de staging le 2026-09-24 : une seule policy,
   * `automation_scheduled_tasks_select_org`, et aucun grant UPDATE). Avec le
   * client de session, l'annulation renvoyait donc « permission denied for
   * table automation_scheduled_tasks », et la route sortait en 500 AVANT de
   * supprimer quoi que ce soit : supprimer une automatisation échouait pour
   * tout le monde, avec un message générique.
   *
   * L'org reste filtrée explicitement ci-dessous — le client service ne
   * passe pas par la RLS, c'est donc à nous de ne pas déborder.
   */
  const service = getServiceClient();
  const { error: annulErr } = await service
    .from('automation_scheduled_tasks')
    .update({ status: 'cancelled', last_error: 'Automatisation supprimée' })
    .eq('automation_rule_id', req.params.id)
    .eq('org_id', auth.orgId)
    .in('status', ['pending']);

  if (annulErr) {
    logger.error('[automation-rules] annulation des tâches échouée', { message: annulErr.message });
    return res.status(500).json({ error: 'Impossible d\'annuler les envois déjà prévus.' });
  }

  /*
   * SUPPRESSION DOUCE, comme partout dans Lume.
   *
   * La ligne était EFFACÉE : un clic de trop et des mois de réglages
   * partaient — le texte, les conditions, le parcours — sans recours. Elle
   * part maintenant à la corbeille, d'où elle se restaure.
   *
   * Les envois déjà prévus ont été annulés juste au-dessus : une règle en
   * corbeille ne doit plus rien envoyer, même restaurable.
   */
  const { error } = await auth.client
    .from('automation_rules')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId);

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de supprimer une automatisation.' });
    }
    logger.error('[automation-rules] suppression échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de supprimer l\'automatisation.' });
  }

  return res.json({ ok: true });
});


/*
 * POST /automations/rules/:id/restaurer — sortir de la corbeille.
 *
 * La règle revient en BROUILLON, jamais publiée : restaurer ne doit pas
 * relancer des envois à l'insu de qui restaure. C'est à lui de relire
 * puis de publier.
 */
router.post('/automations/rules/:id/restaurer', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_rules')
    .update({ deleted_at: null, is_active: false })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .not('deleted_at', 'is', null)
    // Supprimée définitivement : elle ne revient plus.
    .is('purged_at', null)
    .select(COLONNES)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de restaurer une automatisation.' });
    }
    logger.error('[automation-rules] restauration échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de restaurer l’automatisation.' });
  }
  if (!data) return res.status(404).json({ error: 'Automatisation introuvable dans la corbeille.' });
  return res.json(data);
});

/*
 * DELETE /automations/rules/:id/definitivement — vider une ligne de la
 * corbeille (demande de Rafba, 2026-09-30).
 *
 * Pas un vrai DELETE : les journaux d'exécution pointent vers la règle
 * (clé étrangère NO ACTION) et gardent la preuve de ce qui a été envoyé aux
 * clients. La règle sort de la corbeille pour de bon — plus listée, plus
 * restaurable — et son historique reste. Seule une règle DÉJÀ à la
 * corbeille est concernée : on ne supprime pas définitivement en un clic
 * une automatisation qui tourne.
 */
router.delete('/automations/rules/:id/definitivement', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_rules')
    .update({ purged_at: new Date().toISOString(), is_active: false })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .not('deleted_at', 'is', null)
    .is('purged_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de supprimer une automatisation.' });
    }
    logger.error('[automation-rules] suppression définitive échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de supprimer définitivement l’automatisation.' });
  }
  if (!data) return res.status(404).json({ error: 'Automatisation introuvable dans la corbeille.' });
  return res.json({ ok: true });
});

// ── Dossiers ────────────────────────────────────────────────
//
// Ranger ses automatisations. Le bouton « Nouveau dossier » existait
// depuis #525 sans rien derrière ; la table est arrivée avec la migration
// `20260924230000`.
//
// Tout passe par la RLS (`automations.read` / `automations.update`), comme
// les automatisations elles-mêmes : un dossier décide de ce qu'on voit.

router.get('/automations/folders', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_folders')
    .select('id, name, position, created_at')
    .eq('org_id', auth.orgId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    logger.error('[automation-folders] lecture échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire les dossiers.' });
  }
  return res.json(data ?? []);
});

router.post('/automations/folders', validate(dossierCreateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_folders')
    .insert({ org_id: auth.orgId, name: req.body.name })
    .select('id, name, position, created_at')
    .single();

  if (error) {
    // 23505 = l'index unique (org_id, nom en minuscules) : deux dossiers du
    // même nom rendraient le menu « Déplacer vers » illisible. On le dit en
    // clair plutôt que de renvoyer une erreur Postgres.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Un dossier porte déjà ce nom.' });
    }
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer un dossier.' });
    }
    logger.error('[automation-folders] création échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer le dossier.' });
  }
  return res.status(201).json(data);
});

router.patch('/automations/folders/:id', validate(dossierUpdateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_folders')
    .update({ name: req.body.name })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select('id, name, position, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Un dossier porte déjà ce nom.' });
    if (error.code === '42501') return res.status(403).json({ error: 'Votre rôle ne permet pas de renommer un dossier.' });
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Dossier introuvable.' });
    logger.error('[automation-folders] renommage échoué', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de renommer le dossier.' });
  }
  return res.json(data);
});

router.delete('/automations/folders/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  // La clé étrangère est en `on delete set null` : les automatisations du
  // dossier reviennent à la racine et CONTINUENT de tourner. Un rangement
  // ne doit jamais faire disparaître un envoi.
  const { data, error } = await auth.client
    .from('automation_folders')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select('id');

  if (error) {
    if (error.code === '42501') return res.status(403).json({ error: 'Votre rôle ne permet pas de supprimer un dossier.' });
    logger.error('[automation-folders] suppression échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de supprimer le dossier.' });
  }
  // Audit V2, S9 : 0 ligne (dossier d'un autre bureau, inexistant, ou refusé
  // par la RLS) répondait 204 « supprimé » sans rien supprimer.
  if (!data?.length) return res.status(404).json({ error: 'Dossier introuvable.' });
  return res.status(204).end();
});

// ── Copier vers d'autres bureaux ────────────────────────────

// Bureaux de l'entreprise (hors bureau actif) où l'on peut créer une automatisation.
router.get('/automations/bureaux-cibles', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    return res.json({ offices: await bureauxCibles(auth.user.id, auth.orgId) });
  } catch (err: any) {
    logger.error('[automation-rules] bureaux cibles illisibles', { message: err?.message });
    return res.status(500).json({ error: 'Impossible de lister vos bureaux.' });
  }
});

router.post('/automations/rules/:id/copier-bureaux', validate(automationCopieBureauxSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const resultats = await copierVersBureaux(req.header('authorization') as string, auth.user.id, auth.orgId, req.params.id, req.body.org_ids, req.body.lier !== false);
    if (!resultats) return res.status(404).json({ error: 'Automatisation introuvable.' });
    return res.json({ results: resultats });
  } catch (err: any) {
    logger.error('[automation-rules] copie vers bureaux échouée', { message: err?.message });
    return res.status(500).json({ error: 'Impossible de copier l’automatisation.' });
  }
});

// ── Pause des automatisations (par entreprise) ────────

/*
 * L'interrupteur du CLIENT. Distinct de `AUTOMATIONS_ENABLED`, qui coupe
 * toute la plateforme et n'appartient qu'à l'éditeur.
 *
 * La file est CONSERVÉE : rien n'est réclamé, marqué en échec ni
 * supprimé. Reprendre repart où on en était.
 */

router.get('/automations/pause', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('company_settings')
    .select('automations_paused, automations_paused_at')
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (error) {
    logger.error('[automation-rules] état de pause illisible', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire l’état des automatisations.' });
  }
  return res.json({
    paused: data?.automations_paused === true,
    pausedAt: data?.automations_paused_at ?? null,
  });
});

router.post('/automations/pause', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const enPause = req.body?.paused === true;

  const { data: modifiees, error } = await auth.client
    .from('company_settings')
    .update({
      automations_paused: enPause,
      // QUAND et PAR QUI : sans ça, « pourquoi rien ne part depuis mardi ? »
      // est indébogable. On efface à la reprise pour ne pas laisser une
      // date périmée qui ferait croire à une pause en cours.
      automations_paused_at: enPause ? new Date().toISOString() : null,
      automations_paused_by: enPause ? auth.user.id : null,
    })
    .eq('org_id', auth.orgId)
    // Launch 2026-09-28 : la RLS de company_settings ne laisse modifier
    // qu'un administrateur. Pour un autre rôle, la mise à jour touche ZÉRO
    // ligne, sans erreur — et la route répondait « en pause » alors que rien
    // n'était arrêté. On relit ce qui a vraiment été écrit.
    .select('automations_paused');

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de mettre les automatisations en pause.' });
    }
    logger.error('[automation-rules] bascule de pause échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de changer l’état des automatisations.' });
  }
  if (!modifiees || modifiees.length === 0) {
    return res.status(403).json({
      error: enPause
        ? 'Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.'
        : 'Seul un administrateur peut reprendre les automatisations. Elles sont toujours en pause.',
    });
  }

  // Le moteur garde l'état en cache 15 s : on l'oublie tout de suite, sinon
  // un arrêt d'urgence mettrait un quart de minute à mordre.
  oublierPause(auth.orgId);

  logger.warn('[automations] pause basculée', { orgId: auth.orgId, enPause, par: auth.user.id });
  // L'état RÉEL, relu de la base — pas celui qu'on a demandé.
  return res.json({ paused: (modifiees[0] as { automations_paused: boolean | null }).automations_paused === true });
});

// ── Webhooks entrants ───────────────────────────

/*
 * L'adresse que l'entreprise donne à un service extérieur (formulaire de
 * son site, Zapier, Facebook Leads). La Réception elle-même est publique
 * et vit dans `routes/webhooks-entrants.ts` ; ici, c'est la GESTION, qui
 * demande d'être connecté et d'avoir le droit sur les automatisations.
 *
 * On passe par le client de l'utilisateur, jamais service_role : la RLS
 * reste la garde de fond, comme pour les règles.
 */

/*
 * LA CLÉ EST UN SECRET (launch 2026-09-28). Qui la détient déclenche les
 * automatisations de l'entreprise depuis l'extérieur. Elle n'est plus jamais
 * RELUE : la liste montre ses 4 derniers caractères, et la clé complète ne
 * sort qu'une fois — à la création ou à la régénération. La colonne n'est
 * plus lisible par `authenticated` (migration du bloc 4) : la lecture du
 * suffixe passe par service_role APRÈS la garde de la RLS.
 */
const COLONNES_WEBHOOK = 'id, name, enabled, created_at';
const masquer = (cle: string | null | undefined) => (cle ? `••••${cle.slice(-4)}` : '••••');

async function suffixesDesCles(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await getServiceClient().from('automation_webhooks').select('id, api_key').eq('org_id', orgId).in('id', ids);
  if (error) {
    logger.error('[automation-rules] suffixes des clés illisibles', { message: error.message });
    return new Map();
  }
  return new Map(((data ?? []) as Array<{ id: string; api_key: string }>).map((w) => [w.id, masquer(w.api_key)]));
}

async function cleComplete(orgId: string, id: string): Promise<string | null> {
  const { data } = await getServiceClient().from('automation_webhooks').select('api_key').eq('org_id', orgId).eq('id', id).maybeSingle();
  return (data as { api_key?: string } | null)?.api_key ?? null;
}

router.get('/automations/webhooks', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  // La RLS (« Voir les automatisations ») décide QUELLES adresses on voit.
  const { data, error } = await auth.client
    .from('automation_webhooks')
    .select(COLONNES_WEBHOOK)
    .eq('org_id', auth.orgId)
    .is('deleted_at', null)
    .order('created_at');

  if (error) {
    logger.error('[automation-rules] webhooks illisibles', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire vos adresses d’appel.' });
  }
  const lignes = (data ?? []) as Array<{ id: string }>;
  const suffixes = await suffixesDesCles(auth.orgId, lignes.map((w) => w.id));
  return res.json({ webhooks: lignes.map((w) => ({ ...w, cle_masquee: suffixes.get(w.id) ?? '••••' })) });
});

router.post('/automations/webhooks', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const nom = typeof req.body?.name === 'string' && req.body.name.trim()
    ? req.body.name.trim().slice(0, 80)
    : 'Webhook';

  // `api_key` n'est PAS fourni : la base la génère (32 octets aléatoires).
  // Laisser le client proposer sa clé permettrait d'en choisir une faible.
  const { data, error } = await auth.client
    .from('automation_webhooks')
    .insert({ org_id: auth.orgId, created_by: auth.user.id, name: nom })
    .select(COLONNES_WEBHOOK)
    .single();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une adresse d’appel.' });
    }
    logger.error('[automation-rules] création webhook échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer l’adresse d’appel.' });
  }
  // La SEULE fois où la clé complète sort (avec la régénération).
  const cle = await cleComplete(auth.orgId, (data as { id: string }).id);
  return res.status(201).json({ ...data, api_key: cle, cle_masquee: masquer(cle) });
});

router.post('/automations/webhooks/:id/regenerer', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  // Nouvelle clé, même format que la base (32 octets en hexadécimal).
  // L'ancienne adresse cesse de fonctionner immédiatement.
  const nouvelle = randomBytes(32).toString('hex');
  // 1. Le DROIT, avec le client de l'utilisateur : la RLS (automations.update)
  //    décide. Seul `updated_at` est écrit à cette étape.
  const { data, error } = await auth.client
    .from('automation_webhooks')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('deleted_at', null)
    .select(COLONNES_WEBHOOK)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de régénérer cette adresse.' });
    }
    logger.error('[automation-rules] régénération webhook échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de régénérer l’adresse d’appel.' });
  }
  // 0 ligne = introuvable, ou la RLS a refusé (pas « Modifier les automatisations »).
  if (!data) return res.status(404).json({ error: 'Adresse d’appel introuvable, ou votre rôle ne permet pas de la régénérer.' });

  // 2. La CLÉ, avec le client service_role : `authenticated` n'a plus le
  //    droit d'écrire `api_key` (audit V2, S8 — une clé choisie par un
  //    client pouvait être devinable). Bornée au bureau et à l'id vérifiés.
  const { error: erreurCle } = await getServiceClient()
    .from('automation_webhooks')
    .update({ api_key: nouvelle })
    .eq('id', (data as { id: string }).id)
    .eq('org_id', auth.orgId);
  if (erreurCle) {
    logger.error('[automation-rules] nouvelle clé non écrite', { message: erreurCle.message });
    return res.status(500).json({ error: 'Impossible de régénérer l’adresse d’appel.' });
  }
  return res.json({ ...data, api_key: nouvelle, cle_masquee: masquer(nouvelle) });
});

router.patch('/automations/webhooks/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const patch: Record<string, unknown> = {};
  if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
  if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim().slice(0, 80);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier.' });

  const { data, error } = await auth.client
    .from('automation_webhooks')
    .update(patch)
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('deleted_at', null)
    .select(COLONNES_WEBHOOK)
    .maybeSingle();

  if (error) {
    logger.error('[automation-rules] modification webhook échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de modifier l’adresse d’appel.' });
  }
  if (!data) return res.status(404).json({ error: 'Adresse d’appel introuvable.' });
  const suffixes = await suffixesDesCles(auth.orgId, [(data as { id: string }).id]);
  return res.json({ ...data, cle_masquee: suffixes.get((data as { id: string }).id) ?? '••••' });
});

router.delete('/automations/webhooks/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  // Effacement DOUX, comme partout : le journal des appels reçus garde son
  // sens, et une suppression par erreur reste réparable.
  const { data, error } = await auth.client
    .from('automation_webhooks')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    if (error.code === '42501') return res.status(403).json({ error: 'Votre rôle ne permet pas de supprimer cette adresse.' });
    logger.error('[automation-rules] suppression webhook échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de supprimer l’adresse d’appel.' });
  }
  // Audit V2, S9 : 0 ligne répondait { ok: true } sans rien supprimer.
  if (!data?.length) return res.status(404).json({ error: 'Adresse d’appel introuvable.' });
  return res.json({ ok: true });
});

export default router;
