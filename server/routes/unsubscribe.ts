import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';

/**
 * Désinscription courriel — route PUBLIQUE, sans authentification.
 *
 * Exigence CASL : le retrait doit être possible en un clic, sans que le
 * destinataire ait à créer un compte ou à se connecter. La sécurité repose
 * donc sur le jeton (32 octets aléatoires, opaque, propre à une adresse et à
 * une organisation) et non sur une session.
 *
 * Le GET affiche une confirmation lisible plutôt que du JSON : ce lien est
 * cliqué depuis une boîte de réception, par quelqu'un qui n'utilise pas
 * l'application.
 */
const router = Router();

function page(titre: string, message: string, ok = true): string {
  const accent = ok ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${titre}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:80px auto;padding:40px 32px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center;">
    <div style="font-size:40px;line-height:1;margin-bottom:16px;">${ok ? '✓' : '!'}</div>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:${accent};">${titre}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">${message}</p>
  </div>
</body>
</html>`;
}

/**
 * GET /api/unsubscribe/:token — désinscription en un clic.
 *
 * Idempotent : recliquer le lien réaffiche la confirmation sans erreur.
 */
router.get('/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token || '');
  res.type('html');

  // Le jeton est un hex de 64 caractères (32 octets). Filtrer ici évite une
  // requête pour toute URL manifestement invalide.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).send(page(
      'Lien invalide',
      "Ce lien de désinscription n'est pas valide. Répondez directement au courriel reçu pour être retiré de la liste.",
      false,
    ));
  }

  try {
    const admin = getServiceClient();
    const { data: ligne, error } = await admin
      .from('email_unsubscribes')
      .select('id, org_id, email, category')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      console.error('[unsubscribe] lecture échouée:', error.message);
      return res.status(500).send(page(
        'Erreur temporaire',
        'Nous ne parvenons pas à traiter votre demande pour le moment. Réessayez dans quelques minutes.',
        false,
      ));
    }

    if (!ligne) {
      return res.status(404).send(page(
        'Lien inconnu',
        "Ce lien de désinscription n'existe plus. Répondez directement au courriel reçu pour être retiré de la liste.",
        false,
      ));
    }

    // Déjà désabonné : on le confirme sans rien réécrire.
    if (ligne.category !== 'pending') {
      return res.send(page(
        'Vous êtes déjà désabonné',
        `L'adresse <strong>${ligne.email}</strong> ne reçoit plus de communications commerciales de cette entreprise.`,
      ));
    }

    const { error: majErr } = await admin
      .from('email_unsubscribes')
      .update({
        category: 'all',
        unsubscribed_at: new Date().toISOString(),
        reason: 'one-click unsubscribe',
      })
      .eq('id', ligne.id);

    if (majErr) {
      console.error('[unsubscribe] écriture échouée:', majErr.message);
      return res.status(500).send(page(
        'Erreur temporaire',
        'Nous ne parvenons pas à enregistrer votre demande. Réessayez dans quelques minutes.',
        false,
      ));
    }

    console.log('[unsubscribe] désabonnement enregistré pour', ligne.email, 'org', ligne.org_id);
    return res.send(page(
      'Désinscription confirmée',
      `L'adresse <strong>${ligne.email}</strong> ne recevra plus de communications commerciales de cette entreprise. Les documents que vous demandez (factures, reçus, soumissions) continueront de vous être envoyés.`,
    ));
  } catch (err: any) {
    console.error('[unsubscribe] erreur inattendue:', err?.message);
    return res.status(500).send(page(
      'Erreur temporaire',
      'Nous ne parvenons pas à traiter votre demande pour le moment.',
      false,
    ));
  }
});

/**
 * POST /api/unsubscribe/:token — exigé par l'en-tête `List-Unsubscribe-Post`.
 *
 * Gmail et Outlook affichent un bouton « Se désabonner » natif et appellent
 * cette route directement, sans ouvrir le navigateur. Sans elle, le bouton
 * n'apparaît pas.
 */
router.post('/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ ok: false });

  try {
    const admin = getServiceClient();
    const { data: ligne } = await admin
      .from('email_unsubscribes')
      .select('id, category')
      .eq('token', token)
      .maybeSingle();

    if (!ligne) return res.status(404).json({ ok: false });
    if (ligne.category === 'pending') {
      await admin
        .from('email_unsubscribes')
        .update({
          category: 'all',
          unsubscribed_at: new Date().toISOString(),
          reason: 'list-unsubscribe header',
        })
        .eq('id', ligne.id);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[unsubscribe] POST échoué:', err?.message);
    return res.status(500).json({ ok: false });
  }
});

export default router;
