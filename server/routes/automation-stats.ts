/* ═══════════════════════════════════════════════════════════════
   Routes — statistiques, Historique, Journaux et modifications des
   automatisations.

   GET /api/automations/rules/stats     les chiffres d'une période
        ?jours=7|30|90                  (60 accepté pour le panneau d'étape de l'éditeur)
        ?rule_id=…                      + le détail par étape de CE parcours
   GET /api/automations/rules/historique    une ligne par passage d'un client
   GET /api/automations/rules/journaux      le détail technique, ligne par ligne
        ?rule_id=… (absent = tout le bureau) ?jours= ?du= ?au= ?statut= ?action=
        ?client_id= ?q= (nom du client) ?page= ?par_page=
   GET /api/automations/rules/modifications qui a changé quoi dans UNE automatisation
        ?rule_id=… ?page=

   UNE définition par métrique : elle vit dans la base (migration S-01,
   `automation_evenements`) et dans `server/lib/automations-stats.ts`, et
   tous les écrans passent par ici — la liste, la Vue d'ensemble, l'éditeur.
   Avant, chaque écran comptait à sa façon dans le navigateur, sur 200 ou
   1 000 lignes au plus (constats D-01, D-02, D-09, D-15).

   Client de l'UTILISATEUR (RLS), jamais service_role : un membre d'un autre
   bureau, ou sans « Voir les automatisations », ne lit rien.
   ═══════════════════════════════════════════════════════════════ */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuthedClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { twilioClient } from '../lib/config';
import { getOrgSmsChannel } from '../lib/twilioProvisioning';
import {
  calculerStatistiques, lireJournal, lirePassages, PERIODES_ACCEPTEES, PAR_PAGE_MAX,
  type FiltresLecture,
} from '../lib/automations-stats';
import { lireModifications } from '../lib/automations-modifications';
import { FILTRES_STATUT, type FiltreStatut } from '../../src/lib/automationIssues';

export { calculerStatistiques } from '../lib/automations-stats';
export type { StatsRegle, StatsEtape } from '../lib/automations-stats';

const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Un paramètre d'URL en texte simple, ou `undefined` (jamais un tableau). */
const texte = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const periodeSchema = z.coerce.number().int().refine((n) => (PERIODES_ACCEPTEES as readonly number[]).includes(n), 'Période invalide.');

const lectureSchema = z.object({
  rule_id: z.string().regex(UUID).optional(),
  jours: periodeSchema.optional(),
  du: z.string().regex(JOUR).optional(),
  au: z.string().regex(JOUR).optional(),
  statut: z.enum(Object.keys(FILTRES_STATUT) as [FiltreStatut, ...FiltreStatut[]]).optional(),
  action: z.string().regex(/^[a-z_]{1,60}$/).optional(),
  client_id: z.string().regex(UUID).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  par_page: z.coerce.number().int().min(1).max(PAR_PAGE_MAX).optional(),
});

/** Les paramètres d'une lecture, nettoyés ; `null` si l'un d'eux est invalide (400 déjà envoyé). */
function lireParametres(req: Request, res: Response): z.infer<typeof lectureSchema> | null {
  const brut = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, texte(v)]).filter(([, v]) => v !== undefined));
  const r = lectureSchema.safeParse(brut);
  if (!r.success) {
    res.status(400).json({ error: 'Filtre invalide.', champ: r.error.issues[0]?.path.join('.') ?? null });
    return null;
  }
  return r.data;
}

const filtresDe = (p: z.infer<typeof lectureSchema>): FiltresLecture => ({
  ruleId: p.rule_id ?? null,
  jours: p.jours ?? 30,
  du: p.du ?? null,
  au: p.au ?? null,
  statut: p.statut ?? null,
  action: p.action ?? null,
  clientId: p.client_id ?? null,
  recherche: p.q ?? null,
  page: p.page,
  parPage: p.par_page,
});

/**
 * Le bureau peut-il envoyer des textos ? Même source que le moteur : le
 * client Twilio du serveur ET le numéro actif du bureau (`getOrgSmsChannel`,
 * celui que `requireOrgSmsNumber` exige avant chaque envoi). Sans l'un des
 * deux, chaque étape texto est SAUTÉE (M1, code `sms_non_configure`) — la
 * page l'annonce par un bandeau. `null` = inconnu : aucun bandeau plutôt
 * qu'un faux.
 */
async function textoConfigure(orgId: string): Promise<boolean | null> {
  try {
    if (!twilioClient) return false;
    const canal = await getOrgSmsChannel(orgId);
    return Boolean(canal?.phone_number);
  } catch (e: unknown) {
    logger.error('[automation-stats] numéro texto illisible', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

router.get('/automations/rules/stats', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const brut = typeof req.query.rule_id === 'string' ? req.query.rule_id : null;
  if (brut && !UUID.test(brut)) {
    return res.status(400).json({ error: 'Automatisation invalide.' });
  }
  // Sans `jours` : 60, la fenêtre que le panneau d'étape de l'éditeur annonce encore.
  const joursBrut = texte(req.query.jours);
  const jours = joursBrut === undefined ? { success: true as const, data: 60 } : periodeSchema.safeParse(joursBrut);
  if (!jours.success) return res.status(400).json({ error: 'Période invalide : 7, 30 ou 90 jours.' });

  try {
    const [stats, texto_configure] = await Promise.all([
      calculerStatistiques(auth.client, auth.orgId, brut, { jours: jours.data }),
      textoConfigure(auth.orgId),
    ]);
    return res.json({ ...stats, texto_configure });
  } catch (e: unknown) {
    logger.error('[automation-stats] lecture échouée', { message: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'Impossible de lire les statistiques des automatisations.' });
  }
});

router.get('/automations/rules/historique', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const p = lireParametres(req, res);
  if (!p) return;
  try {
    return res.json(await lirePassages(auth.client, auth.orgId, filtresDe(p)));
  } catch (e: unknown) {
    logger.error('[automation-stats] historique illisible', { message: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'Impossible de lire l’historique des automatisations.' });
  }
});

router.get('/automations/rules/journaux', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const p = lireParametres(req, res);
  if (!p) return;
  try {
    return res.json(await lireJournal(auth.client, auth.orgId, filtresDe(p)));
  } catch (e: unknown) {
    logger.error('[automation-stats] journaux illisibles', { message: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'Impossible de lire les journaux des automatisations.' });
  }
});

router.get('/automations/rules/modifications', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const p = lireParametres(req, res);
  if (!p) return;
  if (!p.rule_id) return res.status(400).json({ error: 'Automatisation invalide.' });
  try {
    return res.json(await lireModifications(auth.client, auth.orgId, p.rule_id, { page: p.page, parPage: p.par_page }));
  } catch (e: unknown) {
    logger.error('[automation-stats] modifications illisibles', { message: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'Impossible de lire l’historique des modifications.' });
  }
});

export default router;
