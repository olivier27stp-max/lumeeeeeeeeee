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
import { requireAuthedClient } from '../lib/supabase';
import { validate, automationRuleCreateSchema, automationRuleUpdateSchema } from '../lib/validation';
import { logger } from '../lib/logger';
import {
  DECLENCHEURS,
  ACTIONS,
  trouverDeclencheur,
  DELAI_NEGATIF_MAX_SECONDES,
} from '../../src/lib/automationCatalogue';

const router = Router();

/** Colonnes renvoyées au navigateur. `org_id` n'a aucun intérêt côté client. */
const COLONNES = 'id, name, description, trigger_event, conditions, delay_seconds, actions, steps, is_active, is_preset, preset_key, created_at, updated_at';

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

// ── Modifier ────────────────────────────────────────────────

router.patch('/automations/rules/:id', validate(automationRuleUpdateSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: existante, error: lectureErr } = await auth.client
    .from('automation_rules')
    .select('id, is_preset, trigger_event, delay_seconds')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant modification échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });

  const patch = { ...req.body };

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

  return res.json(data);
});

// ── Dupliquer ───────────────────────────────────────────────

router.post('/automations/rules/:id/duplicate', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: source, error: lectureErr } = await auth.client
    .from('automation_rules')
    .select('name, description, trigger_event, conditions, delay_seconds, actions, steps')
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

  // Les tâches déjà planifiées survivraient à la règle : elles s'exécuteraient
  // sans que rien ne les explique, ou échoueraient sans règle à pointer. On
  // les annule d'abord. `cancelled` plutôt qu'une suppression : le journal
  // garde la trace de ce qui était prévu.
  const { error: annulErr } = await auth.client
    .from('automation_scheduled_tasks')
    .update({ status: 'cancelled', last_error: 'Automatisation supprimée' })
    .eq('automation_rule_id', req.params.id)
    .eq('org_id', auth.orgId)
    .in('status', ['pending']);

  if (annulErr) {
    logger.error('[automation-rules] annulation des tâches échouée', { message: annulErr.message });
    return res.status(500).json({ error: 'Impossible d\'annuler les envois déjà prévus.' });
  }

  const { error } = await auth.client
    .from('automation_rules')
    .delete()
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

export default router;
