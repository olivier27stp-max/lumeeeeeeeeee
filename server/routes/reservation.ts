/**
 * Lien de réservation + aperçu « Client inactif » (drapeau `auto_client_inactif`).
 *
 * PUBLIC (le jeton de 64 hex EST l'authentification ; il ne mène qu'à SON client) :
 *   GET  /api/reservation/:token  → la demande pré-remplie (nom, adresse, services passés)
 *   POST /api/reservation/:token  → dépose la demande dans le pipeline
 *
 * AUTHENTIFIÉ :
 *   GET  /api/automations/clients-inactifs/apercu?mois=6 → « X clients correspondent aujourd'hui »
 *
 * La demande passe par `ingest_lead` (source `lien_reservation`) : c'est
 * l'entrée officielle du pipeline, et elle RATTACHE un contact existant au
 * lieu d'en créer un — contrairement au formulaire public, qui repasse un
 * client actif en prospect (rapport de phase 0, bug 9). Un client qui
 * réserve reste un client.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { drapeauActif, DRAPEAUX_AUTOMATISATIONS } from '../lib/automations-drapeaux';
import { compterClientsInactifs, lireLienReservation, reglagesInactivite } from '../lib/client-inactif';
import { logger } from '../lib/logger';

const router = Router();

const demandeSchema = z.object({
  prenom: z.string().trim().max(100).nullable().optional(),
  nom: z.string().trim().max(100).nullable().optional(),
  courriel: z.string().trim().max(200).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  adresse: z.string().trim().max(300).nullable().optional(),
  services: z.array(z.string().trim().max(200)).max(20).optional(),
  message: z.string().trim().max(2000).nullable().optional(),
}).strict();

/** Le lien, ou la réponse d'erreur déjà envoyée. */
async function lienOuErreur(token: string, res: import('express').Response) {
  const admin = getServiceClient();
  const lien = await lireLienReservation(admin, token);
  if (lien.etat === 'inconnu') { res.status(404).json({ code: 'inconnu', error: 'Ce lien de réservation n’existe pas.' }); return null; }
  if (lien.etat === 'expire') { res.status(410).json({ code: 'expire', error: 'Ce lien de réservation a expiré. Contactez l’entreprise pour en recevoir un nouveau.' }); return null; }
  // Drapeau coupé après l'envoi : le lien cesse de fonctionner, proprement.
  if (!(await drapeauActif(admin, lien.orgId, DRAPEAUX_AUTOMATISATIONS.clientInactif))) {
    res.status(410).json({ code: 'expire', error: 'Ce lien de réservation n’est plus actif. Contactez l’entreprise.' });
    return null;
  }
  return { admin, lien };
}

router.get('/reservation/:token', async (req, res) => {
  try {
    const ok = await lienOuErreur(String(req.params.token || ''), res);
    if (!ok) return;
    const { admin, lien } = ok;
    const [{ data: client }, { data: entreprise }, { data: jobs }] = await Promise.all([
      admin.from('clients').select('first_name, last_name, email, phone, address').eq('id', lien.clientId).eq('org_id', lien.orgId).is('deleted_at', null).maybeSingle(),
      admin.from('company_settings').select('company_name, logo_url, brand_color, default_language, phone, email').eq('org_id', lien.orgId).maybeSingle(),
      admin.from('jobs').select('title').eq('org_id', lien.orgId).eq('client_id', lien.clientId).eq('status', 'completed').is('deleted_at', null).order('created_at', { ascending: false }).limit(30),
    ]);
    if (!client) return res.status(404).json({ code: 'inconnu', error: 'Ce lien de réservation n’existe pas.' });
    const services = [...new Set(((jobs ?? []) as Array<{ title: string | null }>).map((j) => (j.title ?? '').trim()).filter(Boolean))].slice(0, 10);
    const e = (entreprise ?? {}) as Record<string, string | null>;
    return res.json({
      entreprise: { nom: e.company_name ?? '', logo: e.logo_url ?? null, couleur: e.brand_color ?? null, langue: e.default_language === 'en' ? 'en' : 'fr', telephone: e.phone ?? null, courriel: e.email ?? null },
      client: {
        prenom: (client as any).first_name ?? '', nom: (client as any).last_name ?? '',
        courriel: (client as any).email ?? '', telephone: (client as any).phone ?? '', adresse: (client as any).address ?? '',
      },
      services_passes: services,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Lien de réservation illisible.', '[reservation/get]');
  }
});

router.post('/reservation/:token', async (req, res) => {
  const parse = demandeSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'Demande invalide.' });
  try {
    const ok = await lienOuErreur(String(req.params.token || ''), res);
    if (!ok) return;
    const { admin, lien } = ok;
    const d = parse.data;
    const { data: client } = await admin.from('clients').select('first_name, last_name, email, phone, address').eq('id', lien.clientId).eq('org_id', lien.orgId).maybeSingle();
    if (!client) return res.status(404).json({ code: 'inconnu', error: 'Ce lien de réservation n’existe pas.' });
    const c = client as Record<string, string | null>;

    const lignes = [
      'Demande de réservation (lien envoyé au client).',
      d.services?.length ? `Services souhaités : ${d.services.join(', ')}` : null,
      d.message ? `Message : ${d.message}` : null,
    ].filter(Boolean).join('\n');

    // Une demande par lien et par jour : un double clic ne crée pas deux opportunités.
    const jour = new Date().toISOString().slice(0, 10);
    const { data: ingest, error } = await admin.rpc('ingest_lead', {
      p_org_id: lien.orgId,
      p_source: 'lien_reservation',
      p_external_id: `reservation:${lien.lienId}:${jour}`,
      p_first_name: d.prenom || c.first_name,
      p_last_name: d.nom || c.last_name,
      // Le rapprochement se fait sur le courriel/téléphone DU CLIENT du lien :
      // un visiteur ne peut pas rattacher la demande à quelqu'un d'autre.
      p_email: c.email,
      p_phone: c.phone,
      p_address: d.adresse || c.address,
      p_notes: lignes,
      p_payload: { lien_reservation_id: lien.lienId, client_id: lien.clientId, services: d.services ?? [], courriel_saisi: d.courriel ?? null, telephone_saisi: d.telephone ?? null },
    });
    if (error) throw new Error(error.message);

    await admin.from('liens_reservation').update({ derniere_demande_at: new Date().toISOString() }).eq('id', lien.lienId);

    const nomComplet = `${d.prenom || c.first_name || ''} ${d.nom || c.last_name || ''}`.trim() || 'Client';
    const { error: nErr } = await admin.from('notifications').insert({
      org_id: lien.orgId,
      type: 'request_created',
      title: `Nouvelle demande de réservation de ${nomComplet}`,
      body: d.services?.length ? d.services.join(', ') : null,
      message: lignes,
      reference_id: lien.clientId,
      link: `/clients/${lien.clientId}`,
    });
    if (nErr) logger.error('[reservation] notification non écrite', { orgId: lien.orgId, message: nErr.message });

    return res.status(201).json({ ok: true, deal_id: (ingest as { deal_id?: string } | null)?.deal_id ?? null });
  } catch (err: any) {
    return sendSafeError(res, err, 'La demande n’a pas pu être enregistrée.', '[reservation/post]');
  }
});

router.get('/automations/clients-inactifs/apercu', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const admin = getServiceClient();
    if (!(await drapeauActif(admin, auth.orgId as string, DRAPEAUX_AUTOMATISATIONS.clientInactif))) {
      return res.status(404).json({ error: 'Capacité non activée.' });
    }
    const { mois } = reglagesInactivite({ mois: req.query.mois });
    const nombre = await compterClientsInactifs(admin, auth.orgId as string, mois);
    return res.json({ mois, nombre });
  } catch (err: any) {
    return sendSafeError(res, err, 'Aperçu indisponible.', '[reservation/apercu]');
  }
});

export default router;
