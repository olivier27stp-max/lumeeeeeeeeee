/**
 * Désabonnement par canal — ce que la fiche client affiche.
 *
 * GET /api/clients/:id/desabonnement
 *   → { actif, courriel, texto, historique }
 *
 * `actif` = le drapeau `auto_desabonnement_canal` de l'entreprise. Drapeau
 * OFF : la fiche n'affiche rien de plus qu'avant.
 *
 * Le client est d'abord relu avec le client de l'UTILISATEUR (RLS) : un
 * identifiant d'une autre entreprise rend 404, jamais ses données. Ce n'est
 * qu'ensuite que le client service lit les tables de retrait et le journal,
 * toujours filtrés sur l'entreprise de la session.
 */
import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { drapeauActif, DRAPEAUX_AUTOMATISATIONS } from '../lib/automations-drapeaux';
import { etatDesabonnement } from '../lib/desabonnement';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/clients/:id/desabonnement', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const clientId = String(req.params.id || '');
  if (!UUID.test(clientId)) return res.status(400).json({ error: 'Invalid client id.' });

  try {
    const orgId = auth.orgId as string;
    const { data: client, error } = await auth.client
      .from('clients')
      .select('id, email, phone, email_opt_out_at')
      .eq('id', clientId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) return sendSafeError(res, error, 'Failed to load client.', '[desabonnement]');
    if (!client) return res.status(404).json({ error: 'Client not found.' });

    const admin = getServiceClient();
    const actif = await drapeauActif(admin, orgId, DRAPEAUX_AUTOMATISATIONS.desabonnementCanal);
    if (!actif) return res.json({ actif: false });

    const etat = await etatDesabonnement(admin, orgId, client);
    const { data: journal, error: jErr } = await admin
      .from('consents')
      .select('purpose, granted, method, created_at')
      .eq('org_id', orgId)
      .eq('subject_type', 'client')
      .eq('subject_id', clientId)
      .in('purpose', ['email-marketing', 'sms-marketing'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (jErr) return sendSafeError(res, jErr, 'Failed to load history.', '[desabonnement]');

    return res.json({
      actif: true,
      courriel: etat.courriel,
      texto: etat.texto,
      historique: (journal ?? []).map((l: any) => ({
        canal: l.purpose === 'sms-marketing' ? 'texto' : 'courriel',
        accorde: !!l.granted,
        source: l.method ?? null,
        date: l.created_at,
      })),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load unsubscribe state.', '[desabonnement]');
  }
});

export default router;
