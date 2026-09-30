/**
 * GET /api/profitability — la rentabilité pour l'écran (fiche de job, carte
 * des Statistiques). Même calcul que Lumi et le MCP : server/lib/rentabilite.
 * L'org et l'utilisateur viennent de la session ; la permission
 * financial.view_margins est vérifiée par le service.
 */
import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { rentabiliteQuerySchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';
import { analyserRentabilite } from '../lib/rentabilite';

const router = Router();

router.get('/profitability', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const q = rentabiliteQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.issues[0]?.message ?? 'Paramètres invalides.' });
  try {
    const { job_id, ...reste } = q.data;
    const r = await analyserRentabilite({
      client: auth.client,
      orgId: auth.orgId,
      userId: auth.user.id,
      demande: { ...reste, ...(job_id ? { job_ids: [job_id] } : {}) },
    });
    if (r.ok) return res.json(r.resultat);
    if ('refus' in r) return res.status(403).json({ error: r.refus.fr, error_en: r.refus.en, code: 'permission' });
    return res.status(400).json({ error: r.erreur });
  } catch (err) {
    return sendSafeError(res, err, 'Rentabilité indisponible.', '[profitability]');
  }
});

export default router;
