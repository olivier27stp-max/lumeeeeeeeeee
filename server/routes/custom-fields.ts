/**
 * Champs personnalisés v2 — API.
 *
 * Toute la logique vit dans server/lib/champs/service.ts ; ces routes
 * valident (Zod), authentifient et traduisent les erreurs. Le client
 * Supabase est celui de l'utilisateur : la RLS (page Rôles) s'applique à
 * chaque lecture et écriture, en plus des permissions de route
 * (server/lib/route-permissions.ts).
 */
import { Router, type Response } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  validate, champCreerSchema, champModifierSchema, champPurgerSchema, dossierCreerSchema, dossierModifierSchema,
  champsCherchablesSchema, champUniqueSchema, valeursEcrireSchema, champsFiltrerSchema, cartesPipelineSchema,
} from '../lib/validation';
import {
  ErreurChamps, estObjet, champsV2Actifs, listerChamps, creerChamp, modifierChamp, archiverChamp, impactChamp,
  purgerChamp, majCherchables, majUnique, creerDossier, renommerDossier, supprimerDossier, lireValeurs,
  lireValeursLot, ecrireValeurs, filtrer, lireCartesPipeline, majCartesPipeline,
} from '../lib/champs/service';
import { CHAMPS_STANDARD } from '../../src/lib/champs/standard';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function repondreErreur(res: Response, err: unknown, contexte: string) {
  if (err instanceof ErreurChamps) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  return sendSafeError(res, err, `Impossible de ${contexte}.`, '[custom-fields]');
}

function uuidOu400(res: Response, id: string): boolean {
  if (UUID.test(id)) return true;
  res.status(400).json({ error: 'Identifiant invalide.' });
  return false;
}

// ── Définitions ─────────────────────────────────────────────────

// GET /api/custom-fields?object=deal&include_archived=1
router.get('/custom-fields', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const objet = req.query.object;
    if (objet !== undefined && !estObjet(objet)) return res.status(400).json({ error: 'Objet inconnu.' });
    const [{ champs, dossiers }, actif] = await Promise.all([
      listerChamps(auth.client, auth.orgId, { objet: objet as never, inclureArchives: req.query.include_archived === '1' }),
      champsV2Actifs(auth.client, auth.orgId),
    ]);
    return res.json({ enabled: actif, fields: champs, folders: dossiers, standard: CHAMPS_STANDARD });
  } catch (err) {
    return repondreErreur(res, err, 'lire les champs');
  }
});

router.post('/custom-fields', validate(champCreerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    return res.status(201).json({ field: await creerChamp(auth.client, auth.orgId, req.body) });
  } catch (err) {
    return repondreErreur(res, err, 'créer le champ');
  }
});

// Réglages en lot (déclarés AVANT /:id pour ne pas être pris pour un id).
router.put('/custom-fields/searchable', validate(champsCherchablesSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    await majCherchables(auth.client, auth.orgId, req.body.object_type, req.body.field_ids);
    return res.json({ ok: true });
  } catch (err) {
    return repondreErreur(res, err, 'modifier les champs cherchables');
  }
});

router.put('/custom-fields/unique', validate(champUniqueSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const r = await majUnique(auth.client, auth.orgId, req.body.field_id, req.body.unique);
    // 409 + la liste : l'écran montre les doublons qui bloquent.
    return res.status(r.ok ? 200 : 409).json(r.ok ? r : { error: 'Des doublons empêchent d’activer l’unicité.', ...r });
  } catch (err) {
    return repondreErreur(res, err, 'modifier l’unicité');
  }
});

router.post('/custom-fields/filter', validate(champsFiltrerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    return res.json({ ids: await filtrer(auth.client, auth.orgId, req.body.object_type, req.body.conditions, req.body.ids ?? undefined) });
  } catch (err) {
    return repondreErreur(res, err, 'filtrer');
  }
});

router.get('/custom-fields/pipeline-cards/:pipelineId', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.pipelineId)) return;
    return res.json({ field_ids: await lireCartesPipeline(auth.client, auth.orgId, req.params.pipelineId) });
  } catch (err) {
    return repondreErreur(res, err, 'lire l’affichage des cartes');
  }
});

router.put('/custom-fields/pipeline-cards/:pipelineId', validate(cartesPipelineSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.pipelineId)) return;
    await majCartesPipeline(auth.client, auth.orgId, req.params.pipelineId, req.body.field_ids);
    return res.json({ field_ids: req.body.field_ids });
  } catch (err) {
    return repondreErreur(res, err, 'modifier l’affichage des cartes');
  }
});

router.patch('/custom-fields/:id', validate(champModifierSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    return res.json({ field: await modifierChamp(auth.client, auth.orgId, req.params.id, req.body) });
  } catch (err) {
    return repondreErreur(res, err, 'modifier le champ');
  }
});

// POST /api/custom-fields/:id/archive  { archive?: boolean }  (défaut : archiver)
router.post('/custom-fields/:id/archive', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    const archive = req.body?.archive !== false;
    return res.json({ field: await archiverChamp(auth.client, auth.orgId, req.params.id, archive) });
  } catch (err) {
    return repondreErreur(res, err, 'archiver le champ');
  }
});

router.get('/custom-fields/:id/impact', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    return res.json({ impact: await impactChamp(auth.client, auth.orgId, req.params.id) });
  } catch (err) {
    return repondreErreur(res, err, 'mesurer l’impact');
  }
});

// DELETE = PURGE définitive. Le corps porte le nombre de valeurs que la
// personne a vu dans le rapport d'impact ; s'il a changé, on refuse.
router.delete('/custom-fields/:id', validate(champPurgerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    return res.json({ purged: true, impact: await purgerChamp(auth.client, auth.orgId, req.params.id, req.body.valeurs_confirmees) });
  } catch (err) {
    return repondreErreur(res, err, 'purger le champ');
  }
});

// ── Dossiers ────────────────────────────────────────────────────

// Dossier + ses champs en UNE transaction : tout ou rien.
router.post('/custom-field-folders', validate(dossierCreerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = await creerDossier(auth.client, auth.orgId, req.body.object_type, req.body.name, req.body.fields);
    return res.status(201).json({ id });
  } catch (err) {
    return repondreErreur(res, err, 'créer le dossier');
  }
});

router.patch('/custom-field-folders/:id', validate(dossierModifierSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    await renommerDossier(auth.client, auth.orgId, req.params.id, req.body.name, req.body.position);
    return res.json({ ok: true });
  } catch (err) {
    return repondreErreur(res, err, 'renommer le dossier');
  }
});

router.delete('/custom-field-folders/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    await supprimerDossier(auth.client, auth.orgId, req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return repondreErreur(res, err, 'supprimer le dossier');
  }
});

// ── Valeurs ─────────────────────────────────────────────────────

// Plusieurs fiches d'un coup (cartes du pipeline, listes).
router.post('/custom-values/:object/batch', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!estObjet(req.params.object)) return res.status(400).json({ error: 'Objet inconnu.' });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
    if (ids.length > 2000) return res.status(400).json({ error: '2000 fiches au plus.' });
    return res.json({ values: await lireValeursLot(auth.client, auth.orgId, req.params.object, ids) });
  } catch (err) {
    return repondreErreur(res, err, 'lire les valeurs');
  }
});

router.get('/custom-values/:object/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    if (!estObjet(req.params.object)) return res.status(400).json({ error: 'Objet inconnu.' });
    const r = await lireValeurs(auth.client, auth.orgId, req.params.object, req.params.id);
    return res.json({ fields: r.champs, folders: r.dossiers, values: r.valeurs });
  } catch (err) {
    return repondreErreur(res, err, 'lire les valeurs');
  }
});

router.put('/custom-values/:object/:id', validate(valeursEcrireSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth || !uuidOu400(res, req.params.id)) return;
    if (!estObjet(req.params.object)) return res.status(400).json({ error: 'Objet inconnu.' });
    const resultats = await ecrireValeurs(auth.client, auth.orgId, req.params.object, req.params.id, req.body.values,
      { acteur: auth.user.id, source: 'app' });
    const conflit = resultats.some((r) => r.conflict);
    const echec = resultats.some((r) => !r.ok);
    return res.status(conflit ? 409 : echec ? 422 : 200).json({ results: resultats });
  } catch (err) {
    return repondreErreur(res, err, 'enregistrer les valeurs');
  }
});

export default router;
