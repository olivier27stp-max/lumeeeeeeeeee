import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { normalizeE164 } from '../lib/helpers';
import { drapeauActif, DRAPEAUX_AUTOMATISATIONS } from '../lib/automations-drapeaux';
import { clientParCourriel, etatDesabonnement, journaliserChoix } from '../lib/desabonnement';

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

type LigneDesabonnement = { id: string; org_id: string; email: string; category: string };

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * Applique un choix par canal (`null` = ne pas toucher ce canal) et le
 * consigne dans le journal probant. N'écrit que ce qui CHANGE : réafficher
 * la page ou recliquer ne crée pas de fausses lignes d'historique.
 */
async function appliquerChoix(
  admin: ReturnType<typeof getServiceClient>,
  ligne: LigneDesabonnement,
  choix: { courriel: boolean | null; texto: boolean | null },
  raison = 'page-preferences',
): Promise<void> {
  const client = await clientParCourriel(admin, ligne.org_id, ligne.email).catch(() => null);
  const etat = await etatDesabonnement(admin, ligne.org_id, { email: ligne.email, phone: client?.phone ?? null });

  if (choix.courriel !== null && choix.courriel !== etat.courriel.desabonne) {
    const { error } = await admin
      .from('email_unsubscribes')
      // `unsubscribed_at` est NOT NULL : au réabonnement on ne le touche pas.
      // Il ne veut rien dire tant que la catégorie est 'pending' (porteur de
      // jeton), et la date du retrait reste lisible dans le journal probant.
      .update(choix.courriel
        ? { category: 'all', unsubscribed_at: new Date().toISOString(), reason: raison }
        : { category: 'pending', reason: raison })
      .eq('id', ligne.id);
    if (error) throw new Error(error.message);
    await journaliserChoix(admin, { orgId: ligne.org_id, clientId: client?.id ?? null, canal: 'courriel', accorde: !choix.courriel, source: choix.courriel ? 'lien-courriel' : raison });
  }

  if (choix.texto !== null && client?.phone && choix.texto !== etat.texto.desabonne) {
    const telephone = normalizeE164(client.phone);
    const { error } = choix.texto
      ? await admin.from('sms_opt_outs').upsert({ org_id: ligne.org_id, phone: telephone, reason: raison }, { onConflict: 'org_id,phone' })
      : await admin.from('sms_opt_outs').delete().eq('org_id', ligne.org_id).eq('phone', telephone);
    if (error) throw new Error(error.message);
    await journaliserChoix(admin, { orgId: ligne.org_id, clientId: client.id, canal: 'texto', accorde: !choix.texto, source: raison });
  }
  logger.info('[unsubscribe] choix par canal appliqué', { orgId: ligne.org_id });
}

/** La page de choix par canal, dans la langue de l'entreprise. */
async function pageChoix(
  admin: ReturnType<typeof getServiceClient>,
  token: string,
  ligne: LigneDesabonnement,
  enregistre = false,
): Promise<string> {
  const { data: reglages } = await admin
    .from('company_settings')
    .select('company_name, default_language')
    .eq('org_id', ligne.org_id)
    .maybeSingle();
  const fr = (reglages as { default_language?: string } | null)?.default_language !== 'en';
  const nom = echapper(String((reglages as { company_name?: string } | null)?.company_name ?? '') || (fr ? 'cette entreprise' : 'this business'));
  const client = await clientParCourriel(admin, ligne.org_id, ligne.email).catch(() => null);
  const etat = await etatDesabonnement(admin, ligne.org_id, { email: ligne.email, phone: client?.phone ?? null });
  // La personne a cliqué « Se désabonner » : la case courriel est cochée
  // d'avance tant qu'elle n'a rien enregistré. Rien n'est appliqué sans le bouton.
  const cocheCourriel = etat.courriel.desabonne || (!enregistre && ligne.category === 'pending');
  const t = fr
    ? { titre: 'Vos préférences de communication', intro: `Choisissez ce que vous ne voulez plus recevoir de ${nom}.`, courriel: 'Ne plus recevoir de courriels promotionnels', texto: 'Ne plus recevoir de textos promotionnels', note: 'Vos factures, soumissions, reçus et rappels de rendez-vous continueront de vous être envoyés.', bouton: 'Enregistrer mes choix', ok: 'Vos choix sont enregistrés.' }
    : { titre: 'Your communication preferences', intro: `Choose what you no longer want to receive from ${nom}.`, courriel: 'Stop promotional emails', texto: 'Stop promotional texts', note: 'Your invoices, quotes, receipts and appointment reminders will still be sent.', bouton: 'Save my choices', ok: 'Your choices are saved.' };
  const caseHtml = (nomChamp: string, libelle: string, coche: boolean) =>
    `<label for="${nomChamp}" style="display:flex;gap:10px;align-items:center;padding:12px 0;border-top:1px solid #eee;font-size:15px;color:#222;cursor:pointer;">
       <input type="checkbox" id="${nomChamp}" name="${nomChamp}" ${coche ? 'checked' : ''} style="width:18px;height:18px;"/> ${libelle}
     </label>`;
  return `<!DOCTYPE html>
<html lang="${fr ? 'fr' : 'en'}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${t.titre}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <form method="post" action="/api/unsubscribe/${token}" style="max-width:520px;margin:64px auto;padding:32px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111;">${t.titre}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#555;">${t.intro}<br/><strong>${echapper(ligne.email)}</strong></p>
    ${enregistre ? `<p role="status" style="margin:0 0 12px;padding:10px 12px;background:#ecfdf5;color:#15803d;border-radius:8px;font-size:14px;">✓ ${t.ok}</p>` : ''}
    <input type="hidden" name="choix" value="1"/>
    ${caseHtml('courriel', t.courriel, cocheCourriel)}
    ${client?.phone ? caseHtml('texto', t.texto, etat.texto.desabonne) : ''}
    <p style="margin:16px 0 20px;font-size:13px;line-height:1.5;color:#777;">${t.note}</p>
    <button type="submit" style="width:100%;padding:12px;border:0;border-radius:8px;background:#111;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">${t.bouton}</button>
  </form>
</body>
</html>`;
}

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

    // Désabonnement par canal (drapeau par entreprise) : la page PROPOSE le
    // choix courriel / texto au lieu de désabonner d'office. Le bouton natif
    // « Se désabonner » de Gmail/Outlook (POST sans formulaire) reste en un clic.
    if (await drapeauActif(admin, ligne.org_id, DRAPEAUX_AUTOMATISATIONS.desabonnementCanal)) {
      return res.send(await pageChoix(admin, token, ligne));
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

    logger.info('[unsubscribe] désabonnement enregistré', { email: ligne.email, orgId: ligne.org_id });
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
      .select('id, org_id, email, category')
      .eq('token', token)
      .maybeSingle();

    if (!ligne) return res.status(404).json({ ok: false });

    const parCanal = await drapeauActif(admin, ligne.org_id, DRAPEAUX_AUTOMATISATIONS.desabonnementCanal);
    // Le formulaire de la page de choix (champ `choix`) : on applique canal
    // par canal et on réaffiche la page.
    if (parCanal && req.body?.choix === '1') {
      res.type('html');
      await appliquerChoix(admin, ligne, {
        courriel: req.body?.courriel === 'on',
        texto: req.body?.texto === 'on',
      });
      return res.send(await pageChoix(admin, token, ligne, true));
    }
    // Le bouton natif de la messagerie : désabonnement courriel en un clic.
    if (parCanal) {
      if (ligne.category === 'pending') await appliquerChoix(admin, ligne, { courriel: true, texto: null }, 'list-unsubscribe header');
      return res.json({ ok: true });
    }

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
