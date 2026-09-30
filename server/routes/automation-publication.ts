/* ═══════════════════════════════════════════════════════════════
   Routes — publier une automatisation (unitaire et en lot)

   POST /api/automations/rules/:id/publication   { actif }
   POST /api/automations/rules/publication       { actif, ids[] }

   Toute l'interface passe par ici pour changer le statut Brouillon /
   Publiée (liste, lot, éditeur, Réglages) : la vérification
   `bloquantsPublication` s'applique partout. Voir
   server/lib/automations-publication.ts.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { validate, publicationSchema, publicationLotSchema } from '../lib/validation';
import { changerPublication, type ResultatPublication } from '../lib/automations-publication';

const router = Router();

// Le lot AVANT la route unitaire : `publication` n'est pas un identifiant.
router.post('/automations/rules/publication', validate(publicationLotSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const ids = [...new Set(req.body.ids as string[])];
  const resultats: ResultatPublication[] = [];
  // En SÉQUENCE : un décompte exact de ce qui a marché, et une ligne en
  // échec n'arrête pas les autres.
  for (const id of ids) {
    resultats.push(await changerPublication(auth.client, auth.orgId, id, req.body.actif));
  }
  return res.json({
    resultats: resultats.map((r) => (r.ok
      ? { id: r.id, ok: true, is_active: r.is_active }
      : { id: r.id, ok: false, erreur: r.erreur, problemes: r.problemes ?? [] })),
  });
});

router.post('/automations/rules/:id/publication', validate(publicationSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const r = await changerPublication(auth.client, auth.orgId, req.params.id, req.body.actif);
  if (!r.ok) {
    return res.status(r.statut).json({
      error: r.erreur,
      ...(r.problemes ? { code: 'publication_refusee', problemes: r.problemes } : {}),
    });
  }
  return res.json({ id: r.id, is_active: r.is_active });
});

export default router;
