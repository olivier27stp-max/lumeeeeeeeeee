/**
 * Domaine d'envoi propre à l'entreprise — monté sous /api/sending-domain.
 *
 *   GET    /            état (ligne ou null) + si le fournisseur est configuré
 *   POST   /            { domain }  déclare le domaine chez Resend, renvoie les DNS à coller
 *   POST   /verify      demande la vérification et relit l'état
 *   DELETE /            retire le domaine (les envois repartent de la plateforme)
 *
 * Owner/admin seulement (aussi imposé par ROUTE_PERMISSIONS : settings.update).
 * La logique et l'API Resend vivent dans server/lib/courriels/domaines.ts.
 */
import { Router } from 'express';
import { requireAuthedClient, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { validate, sendingDomainSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';
import { demanderDomaine, lireDomaine, retirerDomaine, verifierDomaine } from '../lib/courriels/domaines';

const router = Router();

async function adminSeulement(req: Parameters<typeof requireAuthedClient>[0], res: Parameters<typeof requireAuthedClient>[1]) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!canManage) {
    res.status(403).json({ error: 'Only owner/admin can manage the sending domain.' });
    return null;
  }
  return auth;
}

router.get('/', async (req, res) => {
  try {
    const auth = await adminSeulement(req, res);
    if (!auth) return;
    const domain = await lireDomaine(getServiceClient(), auth.orgId);
    return res.json({ domain, providerConfigured: Boolean(process.env.RESEND_API_KEY) });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load sending domain.', '[sending-domain/get]');
  }
});

router.post('/', validate(sendingDomainSchema), async (req, res) => {
  try {
    const auth = await adminSeulement(req, res);
    if (!auth) return;
    const domain = await demanderDomaine(getServiceClient(), auth.orgId, req.body.domain);
    return res.json({ domain });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to add sending domain.', '[sending-domain/create]');
  }
});

router.post('/verify', async (req, res) => {
  try {
    const auth = await adminSeulement(req, res);
    if (!auth) return;
    const domain = await verifierDomaine(getServiceClient(), auth.orgId);
    return res.json({ domain });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to verify sending domain.', '[sending-domain/verify]');
  }
});

router.delete('/', async (req, res) => {
  try {
    const auth = await adminSeulement(req, res);
    if (!auth) return;
    await retirerDomaine(getServiceClient(), auth.orgId);
    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to remove sending domain.', '[sending-domain/delete]');
  }
});

export default router;
