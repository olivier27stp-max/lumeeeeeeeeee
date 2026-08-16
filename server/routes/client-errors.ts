import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { captureException } from '../lib/sentry';

const router = Router();

/**
 * Erreurs remontées par un client — aujourd'hui l'app mobile.
 *
 * POURQUOI CETTE ROUTE : le web signale ses erreurs à Sentry, le mobile n'avait
 * rien. Une panne chez un employé, sur son téléphone, n'était donc connue de
 * personne. Brancher @sentry/react-native demanderait de lier un module natif,
 * ce que la chaîne de build de ce projet ne permet pas — le serveur, lui, a
 * déjà Sentry. Le mobile lui poste ses erreurs, le serveur les transmet.
 *
 * L'utilisateur doit être authentifié : ça évite d'ouvrir un dépotoir public,
 * et ça donne au passage l'organisation concernée.
 */
router.post('/client-errors', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { message, stack, contexte } = req.body ?? {};
    const texte = String(message ?? '').slice(0, 2000).trim();
    if (!texte) return res.status(400).json({ error: 'message requis' });

    // On reconstruit une Error pour que Sentry en tire une trace exploitable.
    const err = new Error(texte);
    if (typeof stack === 'string' && stack) err.stack = stack.slice(0, 8000);

    captureException(err, {
      source: 'mobile',
      user_id: auth.user.id,
      org_id: auth.orgId,
      ...(contexte && typeof contexte === 'object' ? contexte : {}),
    });

    // 204 : rien à renvoyer, et le client ne doit jamais dépendre du résultat.
    return res.status(204).end();
  } catch {
    // Un échec du signalement ne doit surtout pas devenir une seconde erreur.
    return res.status(204).end();
  }
});

export default router;
