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
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { genererParcours } from '../lib/lumi/generer-parcours';
import { sequenceEtapes } from '../lib/validation';
import {
  validate, automationRuleCreateSchema, automationRuleUpdateSchema,
  dossierCreateSchema, dossierUpdateSchema, automationCopieBureauxSchema,
} from '../lib/validation';
import { bureauxCibles, copierVersBureaux, propagerAuxCopies, type ResultatCopie } from '../lib/automatisations-bureaux';
import { logger } from '../lib/logger';
import { oublierPause } from '../lib/automations-pause-org';
import {
  DECLENCHEURS,
  ACTIONS,
  trouverDeclencheur,
  DELAI_NEGATIF_MAX_SECONDES,
} from '../../src/lib/automationCatalogue';

const router = Router();

/** Colonnes renvoyées au navigateur. `org_id` n'a aucun intérêt côté client. */
const COLONNES = 'id, name, description, trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, is_preset, preset_key, folder_id, modele_id, deleted_at, created_at, updated_at';

/** Champs dont la modification change le CONTENU d'une règle (pas son interrupteur ni son dossier). */
const CHAMPS_CONTENU = ['name', 'description', 'trigger_event', 'conditions', 'delay_seconds', 'actions', 'steps', 'settings'] as const;

/**
 * Les gardes qui ont besoin du catalogue, donc impossibles à exprimer en Zod
 * seul. Retourne un message en clair, ou null si tout va bien.
 */
function verifierCoherence(corps: {
  trigger_event?: string;
  delay_seconds?: number;
  actions?: Array<{ type: string }>;
}): string | null {
  const { trigger_event, delay_seconds, actions } = corps;

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
      return `« ${decl?.fr ?? trigger_event} » n'a pas de date future : on ne peut pas envoyer avant. Utilisez un délai après l'événement.`;
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
    // rien.
    .order('name');

  if (error) {
    logger.error('[automation-rules] lecture échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire les automatisations.' });
  }

  // Le catalogue voyage avec les règles : l'interface n'a pas à le dupliquer,
  // et une clé retirée ici disparaît du sélecteur sans redéploiement du front.
  return res.json({
    rules: data ?? [],
    catalogue: { declencheurs: DECLENCHEURS, actions: ACTIONS },
  });
});

// ── Créer ───────────────────────────────────────────────────

router.post('/automations/rules', validate(automationRuleCreateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const probleme = verifierCoherence(req.body);
  if (probleme) return res.status(400).json({ error: probleme });

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
    return res.status(422).json({ error: resultat.erreur ?? 'Lumi n’a rien pu construire.' });
  }

  // Le garde-fou : ce que Lumi propose doit passer la validation humaine.
  const verdict = sequenceEtapes.safeParse(resultat.parcours.steps);
  if (!verdict.success) {
    logger.error('[lumi/parcours] proposition invalide', {
      org_id: auth.orgId,
      motifs: verdict.error.issues.map((i) => i.message).slice(0, 3),
    });
    return res.status(422).json({
      error: langue === 'fr'
        ? 'Lumi a proposé un parcours que le moteur ne saurait pas exécuter. Reformule, ou construis-le avec le « + ».'
        : 'Lumi proposed a path the engine could not run. Rephrase, or build it with “+”.',
    });
  }

  const decl = trouverDeclencheur(resultat.parcours.trigger_event);
  if (!decl) {
    return res.status(422).json({
      error: langue === 'fr'
        ? 'Lumi a choisi un déclencheur qui n’existe pas. Reformule ta demande.'
        : 'Lumi picked a trigger that does not exist. Rephrase your request.',
    });
  }

  return res.json({
    nom: resultat.parcours.nom,
    cout_cents: resultat.coutCents ?? null,
    trigger_event: resultat.parcours.trigger_event,
    resume: resultat.parcours.resume,
    steps: verdict.data,
  });
});

// ── Modifier ────────────────────────────────────────────────

router.patch('/automations/rules/:id', validate(automationRuleUpdateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: existante, error: lectureErr } = await auth.client
    .from('automation_rules')
    .select('id, is_preset, trigger_event, delay_seconds, modele_id')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant modification échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });

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

  const probleme = verifierCoherence({
    trigger_event: patch.trigger_event ?? existante.trigger_event,
    delay_seconds: patch.delay_seconds ?? existante.delay_seconds,
    actions: patch.actions,
  });
  if (probleme) return res.status(400).json({ error: probleme });

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
      name: `${source.name} (copie)`.slice(0, 120),
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
  const { error } = await auth.client
    .from('automation_folders')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId);

  if (error) {
    if (error.code === '42501') return res.status(403).json({ error: 'Votre rôle ne permet pas de supprimer un dossier.' });
    logger.error('[automation-folders] suppression échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de supprimer le dossier.' });
  }
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

  const { error } = await auth.client
    .from('company_settings')
    .update({
      automations_paused: enPause,
      // QUAND et PAR QUI : sans ça, « pourquoi rien ne part depuis mardi ? »
      // est indébogable. On efface à la reprise pour ne pas laisser une
      // date périmée qui ferait croire à une pause en cours.
      automations_paused_at: enPause ? new Date().toISOString() : null,
      automations_paused_by: enPause ? auth.user.id : null,
    })
    .eq('org_id', auth.orgId);

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de mettre les automatisations en pause.' });
    }
    logger.error('[automation-rules] bascule de pause échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de changer l’état des automatisations.' });
  }

  // Le moteur garde l'état en cache 15 s : on l'oublie tout de suite, sinon
  // un arrêt d'urgence mettrait un quart de minute à mordre.
  oublierPause(auth.orgId);

  logger.warn('[automations] pause basculée', { orgId: auth.orgId, enPause, par: auth.user.id });
  return res.json({ paused: enPause });
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

router.get('/automations/webhooks', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('automation_webhooks')
    .select('id, name, api_key, enabled, created_at')
    .eq('org_id', auth.orgId)
    .is('deleted_at', null)
    .order('created_at');

  if (error) {
    logger.error('[automation-rules] webhooks illisibles', { message: error.message });
    return res.status(500).json({ error: 'Impossible de lire vos adresses d’appel.' });
  }
  return res.json({ webhooks: data ?? [] });
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
    .select('id, name, api_key, enabled, created_at')
    .single();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une adresse d’appel.' });
    }
    logger.error('[automation-rules] création webhook échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer l’adresse d’appel.' });
  }
  return res.status(201).json(data);
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
    .select('id, name, api_key, enabled, created_at')
    .maybeSingle();

  if (error) {
    logger.error('[automation-rules] modification webhook échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de modifier l’adresse d’appel.' });
  }
  if (!data) return res.status(404).json({ error: 'Adresse d’appel introuvable.' });
  return res.json(data);
});

router.delete('/automations/webhooks/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  // Effacement DOUX, comme partout : le journal des appels reçus garde son
  // sens, et une suppression par erreur reste réparable.
  const { error } = await auth.client
    .from('automation_webhooks')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId);

  if (error) {
    logger.error('[automation-rules] suppression webhook échouée', { message: error.message });
    return res.status(500).json({ error: 'Impossible de supprimer l’adresse d’appel.' });
  }
  return res.json({ ok: true });
});

export default router;
