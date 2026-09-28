/**
 * Réglages → Étiquettes (étape 2 du plan étiquettes + champs, 2026-09-28).
 *
 * Les étiquettes restent du texte posé sur les clients (`client_tags`) ; le
 * catalogue `tags` porte la couleur. Lire : tout membre (le sélecteur en a
 * besoin partout). Créer, recolorer, renommer/fusionner, supprimer :
 * « Réglages » (route-permissions.ts) — décision D3, pour éviter « VIP »,
 * « vip » et « V.I.P. ».
 *
 * Renommer ou supprimer passe par des fonctions SQL (une transaction chacune,
 * service_role seulement) : `client_tags` n'a pas de policy UPDATE, et une
 * fusion à moitié faite laisserait des doublons.
 */
import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate, etiquetteCreerSchema, etiquetteModifierSchema, etiquetteSupprimerSchema } from '../lib/validation';

const router = Router();
const COULEUR_DEFAUT = '#6366f1';

// GET /api/etiquettes — nom, couleur, nombre de clients.
router.get('/etiquettes', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { data, error } = await getServiceClient().rpc('etiquettes_de_l_org', { p_org: auth.orgId });
    if (error) throw error;
    return res.json({ etiquettes: data ?? [] });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de lire les étiquettes.', '[etiquettes]');
  }
});

// POST /api/etiquettes — nouvelle étiquette au catalogue (idempotent : un nom existant est renvoyé tel quel).
router.post('/etiquettes', validate(etiquetteCreerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { nom, couleur } = req.body as { nom: string; couleur?: string | null };
    const { data: existante } = await admin.from('tags').select('name, color_hex')
      .eq('org_id', auth.orgId).ilike('name', nom.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
    if (existante) return res.json({ nom: existante.name, couleur: existante.color_hex, existait: true });
    const { error } = await admin.from('tags').insert({ org_id: auth.orgId, name: nom, color_hex: couleur || COULEUR_DEFAUT });
    if (error) throw error;
    return res.status(201).json({ nom, couleur: couleur || COULEUR_DEFAUT, existait: false });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de créer l’étiquette.', '[etiquettes]');
  }
});

// PATCH /api/etiquettes — recolorer et/ou renommer (fusionne si le nouveau nom existe déjà).
router.patch('/etiquettes', validate(etiquetteModifierSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { nom, nouveau_nom, couleur } = req.body as { nom: string; nouveau_nom?: string | null; couleur?: string | null };

    if (couleur) {
      // Une étiquette posée sur des clients mais jamais passée au catalogue y entre ici.
      const { data: ligne } = await admin.from('tags').select('id')
        .eq('org_id', auth.orgId).ilike('name', nom.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
      const { error } = ligne
        ? await admin.from('tags').update({ color_hex: couleur }).eq('id', ligne.id)
        : await admin.from('tags').insert({ org_id: auth.orgId, name: nom, color_hex: couleur });
      if (error) throw error;
    }

    let nbClients: number | null = null;
    if (nouveau_nom && nouveau_nom !== nom) {
      const { data, error } = await admin.rpc('etiquette_renommer', { p_org: auth.orgId, p_ancien: nom, p_nouveau: nouveau_nom });
      if (error) {
        if (error.code === '22023') return res.status(400).json({ error: error.message });
        throw error;
      }
      nbClients = Number(data ?? 0);
    }
    return res.json({ ok: true, nom: nouveau_nom || nom, nb_clients: nbClients });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de modifier l’étiquette.', '[etiquettes]');
  }
});

// POST /api/etiquettes/supprimer — retirée de tous les clients de l'entreprise et du catalogue.
router.post('/etiquettes/supprimer', validate(etiquetteSupprimerSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { nom } = req.body as { nom: string };
    const { data, error } = await getServiceClient().rpc('etiquette_supprimer', { p_org: auth.orgId, p_nom: nom });
    if (error) throw error;
    return res.json({ ok: true, retiree_de: Number(data ?? 0) });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de supprimer l’étiquette.', '[etiquettes]');
  }
});

export default router;
