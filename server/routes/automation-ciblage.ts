/* ═══════════════════════════════════════════════════════════════
   Routes — ciblage, conflits, « Tester avec un client »

     POST /api/automations/ciblage/apercu       « Touche X clients » + les 20 premiers
     GET  /api/automations/rules/:id/conflits   l'automatisation publiée qui écrit déjà aux mêmes clients
     POST /api/automations/rules/:id/tester     le parcours joué pour UN client, sans rien envoyer

   TROIS LECTURES : aucune de ces routes n'écrit, n'envoie, ni n'exécute une
   action. Droit exigé : `automations.read` (table `route-permissions.ts` +
   vérification ici, comme `automation-messages.ts`).

   QUI LIT QUOI
     · L'aperçu et les conflits se lisent avec la session de l'UTILISATEUR : la
       RLS borne au bureau, et à ce que son rôle lui laisse voir. Un membre dont
       la portée est restreinte voit donc le compte de SES clients — jamais un
       nom qu'il n'a pas le droit de lire. Les noms de la liste exigent en plus
       « Voir les clients ».
     · L'essai lit le client choisi avec la session de l'utilisateur (il doit
       lui être visible), puis résout les variables et le ciblage comme le
       moteur (rôle de service, bureau filtré explicitement).

   Le bureau vient toujours de la session (`auth.orgId`), jamais du corps.

   NON MONTÉ : voir notes/P-branchements.md (ligne de montage dans
   server/index.ts, lignes de route-permissions.ts).
   ═══════════════════════════════════════════════════════════════ */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { getUserContext, hasPermission, corpsRefusPermission } from '../lib/rbac';
import { validate } from '../lib/validation';
import { logger } from '../lib/logger';
import { langueDe, repondreDansLaLangue } from '../lib/automations-langue';
import { messageCorbeille, STATUT_CORBEILLE } from '../lib/automations-corbeille';
import { ciblageSchema } from '../lib/automations-ciblage-schema';
import { apercuCiblage, TAILLE_APERCU_CIBLAGE } from '../lib/automations-ciblage';
import { conflitsDePublication, avertissementsDeConflit, lignesDeConflit } from '../lib/automations-conflits';
import { essaiPourUnClient } from '../lib/automations-essai';
import { COLONNES_REGLE_LUE } from '../lib/automations-etapes';
import type { Ciblage } from '../../src/lib/automationCiblage';

const router = Router();
// Les refus sont dits dans la langue de l'interface (A-09).
router.use('/automations', repondreDansLaLangue);

// ── Entrées (à déplacer dans server/lib/validation.ts) ──────

export const apercuCiblageSchema = z.object({
  ciblage: ciblageSchema.default({}),
  canaux: z.array(z.enum(['sms', 'email'])).max(2).default([]),
  demande_avis: z.boolean().default(false),
}).strict();

const ID_REGLE = z.string().uuid();

/**
 * Le brouillon tel qu'à l'écran. Seule la FORME est bornée ici : l'essai ne
 * fait que lire et rendre — rien de ce parcours n'est enregistré ni exécuté.
 */
export const essaiSchema = z.object({
  client_id: z.string().uuid(),
  brouillon: z.object({
    trigger_event: z.string().trim().min(1).max(64).optional(),
    conditions: z.record(z.string().max(64), z.unknown()).optional(),
    steps: z.array(z.record(z.string(), z.unknown())).max(60).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
    delay_seconds: z.number().int().min(-366 * 86400).max(366 * 86400).optional(),
  }).strict().optional(),
}).strict();

/** La session et le droit de LIRE les automatisations. `null` : la réponse est déjà partie. */
async function lecteur(req: Request, res: Response) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const ctx = req.userContext ?? await getUserContext(auth.client, auth.user.id, auth.orgId);
  if (!ctx) {
    res.status(403).json({ error: 'No active membership found.' });
    return null;
  }
  if (!hasPermission(ctx, 'automations.read')) {
    res.status(403).json(corpsRefusPermission('automations.read'));
    return null;
  }
  return { auth, ctx, fr: langueDe(req) === 'fr' };
}

// ── « Touche X clients » ────────────────────────────────────

router.post('/automations/ciblage/apercu', validate(apercuCiblageSchema), async (req, res) => {
  const l = await lecteur(req, res);
  if (!l) return;
  const { auth, ctx, fr } = l;
  const corps = req.body as z.infer<typeof apercuCiblageSchema>;
  try {
    const a = await apercuCiblage(auth.client, auth.orgId, {
      ciblage: corps.ciblage as Ciblage, canaux: corps.canaux, demandeAvis: corps.demande_avis, fr,
    });
    return res.json({
      total: a.total,
      dont: a.dont,
      // Des NOMS de clients : seulement pour qui a le droit de voir les clients.
      apercu: hasPermission(ctx, 'clients.read') ? a.apercu.slice(0, TAILLE_APERCU_CIBLAGE) : [],
      tronque: a.tronque,
      plafond: a.plafond,
      carnet: a.carnet,
    });
  } catch (err) {
    logger.error('[automation-ciblage] aperçu impossible', { orgId: auth.orgId, message: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: fr ? 'Compteur indisponible pour l’instant.' : 'Counter unavailable right now.' });
  }
});

// ── Conflits (avertissement de doublon, jamais bloquant) ────

router.get('/automations/rules/:id/conflits', async (req, res) => {
  const l = await lecteur(req, res);
  if (!l) return;
  const { auth, fr } = l;
  if (!ID_REGLE.safeParse(req.params.id).success) {
    return res.status(404).json({ error: fr ? 'Automatisation introuvable.' : 'Automation not found.' });
  }
  const { data: regle, error } = await auth.client
    .from('automation_rules')
    .select('id, name, trigger_event, conditions, steps, actions, preset_key, deleted_at')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('purged_at', null)
    .maybeSingle();
  if (error) {
    logger.error('[automation-ciblage] conflits : lecture de la règle impossible', { rule_id: req.params.id, message: error.message });
    return res.status(500).json({ error: fr ? 'Impossible de vérifier les doublons.' : 'Could not check for duplicates.' });
  }
  if (!regle) return res.status(404).json({ error: fr ? 'Automatisation introuvable.' : 'Automation not found.' });
  // À la corbeille : elle ne part plus, rien à signaler.
  if (regle.deleted_at) return res.json({ conflits: [], lignes: [] });
  const conflits = await conflitsDePublication(auth.client, auth.orgId, regle, fr ? 'fr' : 'en');
  return res.json({ conflits: avertissementsDeConflit(conflits, fr), lignes: lignesDeConflit(conflits, fr) });
});

// ── « Tester avec un client » ───────────────────────────────

router.post('/automations/rules/:id/tester', validate(essaiSchema), async (req, res) => {
  const l = await lecteur(req, res);
  if (!l) return;
  const { auth, ctx, fr } = l;
  const corps = req.body as z.infer<typeof essaiSchema>;
  const introuvable = () => res.status(404).json({ error: fr ? 'Automatisation introuvable.' : 'Automation not found.' });
  if (!ID_REGLE.safeParse(req.params.id).success) return introuvable();
  // L'essai montre le nom, le numéro et l'adresse d'un client : il faut le droit de les voir.
  if (!hasPermission(ctx, 'clients.read')) return res.status(403).json(corpsRefusPermission('clients.read'));

  try {
    const { data: regle, error } = await auth.client
      .from('automation_rules')
      .select(`${COLONNES_REGLE_LUE}, preset_key`)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('purged_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!regle) return introuvable();
    const lue = regle as unknown as Record<string, unknown> & { deleted_at?: string | null };
    if (lue.deleted_at) return res.status(STATUT_CORBEILLE).json({ error: messageCorbeille(fr) });

    // Le parcours à l'écran (modifications non enregistrées) remplace, pour l'essai seulement, la version enregistrée.
    const b = corps.brouillon;
    const aEssayer = b ? {
      ...lue,
      ...(b.trigger_event !== undefined ? { trigger_event: b.trigger_event } : {}),
      ...(b.conditions !== undefined ? { conditions: b.conditions } : {}),
      ...(b.steps !== undefined ? { steps: b.steps } : {}),
      ...(b.actions !== undefined ? { actions: b.actions } : {}),
      ...(b.delay_seconds !== undefined ? { delay_seconds: b.delay_seconds } : {}),
    } : lue;

    const resultat = await essaiPourUnClient({
      lecture: auth.client,
      // Rôle de service : les variables et le ciblage se calculent comme le moteur. Le bureau est celui de la session.
      admin: getServiceClient(),
      orgId: auth.orgId, regle: aEssayer, clientId: corps.client_id, fr,
    });
    if (!resultat) return res.status(404).json({ error: fr ? 'Client introuvable.' : 'Client not found.' });
    return res.json(resultat);
  } catch (err) {
    logger.error('[automation-ciblage] essai impossible', { rule_id: req.params.id, message: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: fr ? 'Impossible de préparer l’essai.' : 'Could not prepare the test.' });
  }
});

export default router;
