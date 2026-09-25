/**
 * email-deliveries.ts — le sort des courriels d'une facture / d'une soumission.
 *
 * Plan courriels pro (2026-09-17) : l'entreprise voit, sous ses actions
 * d'envoi, « Envoyé le 17 sept. · Vu le 17 sept. à 14 h 12 · Lien cliqué »,
 * « Non livré » ou « Pas encore ouvert ». Les données viennent de
 * email_deliveries (écrite par sendEmail, mise à jour par le webhook Resend).
 *
 * Lecture par un membre de l'org uniquement (requireAuthedClient → orgId
 * vérifié, anti-IDOR) ; jamais l'erreur brute du fournisseur ni l'URL cliquée
 * hors de l'org.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

const requeteSchema = z.object({
  entity_type: z.string().trim().regex(/^[a-z_]{1,40}$/, 'entity_type invalide.'),
  entity_id: z.string().uuid('entity_id invalide.'),
});

export const COLONNES_ENVOI = 'id, to_email, subject, status, error, created_at, opened_at, open_count, clicked_at, click_count, last_clicked_url';
const MAX_ENVOIS = 20;

// GET /api/email-deliveries?entity_type=invoice&entity_id=<uuid>
router.get('/email-deliveries', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = requeteSchema.safeParse({ entity_type: req.query.entity_type, entity_id: req.query.entity_id });
    if (!parsed.success) {
      return res.status(400).json({ error: 'entity_type et entity_id (uuid) sont requis.' });
    }

    const { data, error } = await getServiceClient()
      .from('email_deliveries')
      .select(COLONNES_ENVOI)
      .eq('org_id', auth.orgId)
      .eq('entity_type', parsed.data.entity_type)
      .eq('entity_id', parsed.data.entity_id)
      .order('created_at', { ascending: false })
      .limit(MAX_ENVOIS);
    if (error) throw error;

    return res.json({ deliveries: data ?? [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch email deliveries.', '[email-deliveries]');
  }
});

export default router;
