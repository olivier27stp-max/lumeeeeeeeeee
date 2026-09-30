/* ═══════════════════════════════════════════════════════════════
   Les routes des automatisations répondent dans la langue de l'INTERFACE.

   Audit V2 (A-09) : un utilisateur qui a choisi l'anglais recevait
   « Publication refusée : … » ou « Un dossier porte déjà ce nom. » — le
   serveur ne parlait que français.

   Le choix, le plus simple et cohérent avec l'existant :
     · le navigateur envoie la langue de l'interface dans `Accept-Language`
       (`entetes()` de src/lib/automationBuilderApi.ts et
       automationWebhooksApi.ts, lue comme les PDF : `lume-language`) ;
     · les messages CALCULÉS (refus de publication, publiée qu'on casserait)
       sont produits directement dans la bonne langue — le module partagé
       `problemesPublication` sait déjà parler les deux ;
     · les messages FIXES écrits en dur dans les routes restent en français
       dans le code (la langue du produit) et sont traduits à la sortie par
       `repondreDansLaLangue`, d'après la table ci-dessous. Un test
       (tests/automatisations-v4-serveur.test.ts) exige une entrée pour
       chaque message fixe des routes : un message ajouté sans traduction
       fait échouer la CI.

   Sans en-tête, ou pour toute autre langue : français (la langue par
   défaut de Lume).
   ═══════════════════════════════════════════════════════════════ */

import type { Request, Response, NextFunction } from 'express';

export type Langue = 'fr' | 'en';

/** La langue demandée : `en` seulement si c'est la PREMIÈRE préférence. */
export function langueDe(req: Request): Langue {
  const brut = String(req.headers['accept-language'] ?? '').trim().toLowerCase();
  return brut.startsWith('en') ? 'en' : 'fr';
}

/** Les messages fixes des routes d'automatisations, en anglais. */
export const MESSAGES_EN: Record<string, string> = {
  'Impossible de lire les automatisations.': 'Could not read the automations.',
  'Dossier introuvable dans ce bureau.': 'Folder not found in this office.',
  'Votre rôle ne permet pas de créer une automatisation.': 'Your role does not allow creating an automation.',
  'Impossible de créer l\'automatisation.': 'Could not create the automation.',
  'Impossible de créer l’automatisation.': 'Could not create the automation.',
  // Bibliothèque de modèles (#778).
  'Modèle introuvable.': 'Template not found.',
  'Décris ton automatisation en une phrase.': 'Describe your automation in one sentence.',
  'Impossible de lire l\'automatisation.': 'Could not read the automation.',
  'Impossible de lire l’automatisation.': 'Could not read the automation.',
  'Automatisation introuvable.': 'Automation not found.',
  'Le déclencheur d\'une automatisation fournie ne se change pas. Dupliquez-la pour en faire une à vous.':
    'The trigger of a provided automation cannot be changed. Duplicate it to make your own.',
  'Votre rôle ne permet pas de modifier une automatisation.': 'Your role does not allow editing an automation.',
  'Impossible de modifier l\'automatisation.': 'Could not edit the automation.',
  'Impossible de dupliquer l\'automatisation.': 'Could not duplicate the automation.',
  'Une automatisation fournie ne se supprime pas — désactivez-la, l\'effet est le même.':
    'A provided automation cannot be deleted — turn it off, the effect is the same.',
  'Impossible d\'annuler les envois déjà prévus.': 'Could not cancel the messages already scheduled.',
  'Votre rôle ne permet pas de supprimer une automatisation.': 'Your role does not allow deleting an automation.',
  'Impossible de supprimer l\'automatisation.': 'Could not delete the automation.',
  'Votre rôle ne permet pas de restaurer une automatisation.': 'Your role does not allow restoring an automation.',
  'Impossible de restaurer l’automatisation.': 'Could not restore the automation.',
  'Automatisation introuvable dans la corbeille.': 'Automation not found in the bin.',
  'Impossible de lire les dossiers.': 'Could not read the folders.',
  'Un dossier porte déjà ce nom.': 'A folder already has this name.',
  'Votre rôle ne permet pas de créer un dossier.': 'Your role does not allow creating a folder.',
  'Impossible de créer le dossier.': 'Could not create the folder.',
  'Votre rôle ne permet pas de renommer un dossier.': 'Your role does not allow renaming a folder.',
  'Dossier introuvable.': 'Folder not found.',
  'Impossible de renommer le dossier.': 'Could not rename the folder.',
  'Votre rôle ne permet pas de supprimer un dossier.': 'Your role does not allow deleting a folder.',
  'Impossible de supprimer le dossier.': 'Could not delete the folder.',
  'Impossible de lister vos bureaux.': 'Could not list your offices.',
  'Impossible de copier l’automatisation.': 'Could not copy the automation.',
  'Impossible de lire l’état des automatisations.': 'Could not read the state of the automations.',
  'Votre rôle ne permet pas de mettre les automatisations en pause.': 'Your role does not allow pausing the automations.',
  'Impossible de changer l’état des automatisations.': 'Could not change the state of the automations.',
  'Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.':
    'Only an administrator can stop the automations. Nothing was stopped.',
  'Seul un administrateur peut reprendre les automatisations. Elles sont toujours en pause.':
    'Only an administrator can resume the automations. They are still paused.',
  'Impossible de lire vos adresses d’appel.': 'Could not read your incoming addresses.',
  'Votre rôle ne permet pas de créer une adresse d’appel.': 'Your role does not allow creating an incoming address.',
  'Impossible de créer l’adresse d’appel.': 'Could not create the incoming address.',
  'Votre rôle ne permet pas de régénérer cette adresse.': 'Your role does not allow regenerating this address.',
  'Impossible de régénérer l’adresse d’appel.': 'Could not regenerate the incoming address.',
  'Adresse d’appel introuvable, ou votre rôle ne permet pas de la régénérer.':
    'Incoming address not found, or your role does not allow regenerating it.',
  'Rien à modifier.': 'Nothing to change.',
  'Impossible de modifier l’adresse d’appel.': 'Could not edit the incoming address.',
  'Adresse d’appel introuvable.': 'Incoming address not found.',
  'Impossible de supprimer l’adresse d’appel.': 'Could not delete the incoming address.',
  'Votre rôle ne permet pas de supprimer cette adresse.': 'Your role does not allow deleting this address.',
  'Cette automatisation est à la corbeille : restaurez-la avant de la publier.':
    'This automation is in the bin: restore it before publishing it.',
  'Votre rôle ne permet pas de publier une automatisation.': 'Your role does not allow publishing an automation.',
  'Impossible de changer le statut de l’automatisation.': 'Could not change the status of the automation.',
  'La modification n’a pas été appliquée — réessayez.': 'The change was not applied — try again.',
  // Gardes de cohérence (verifierCoherence).
  'Pour envoyer avant, il faut préciser le déclencheur.': 'To send before, the trigger must be specified.',
  'On ne peut pas envoyer plus de 30 jours avant.': 'Cannot send more than 30 days before.',
  'Deux actions identiques : le client recevrait le même message en double.':
    'Two identical actions: the client would receive the same message twice.',
};

/**
 * Traduit à la sortie le champ `error` d'une réponse, pour un utilisateur
 * dont l'interface est en anglais. Un message absent de la table (déjà
 * anglais, ou calculé) passe tel quel.
 */
export function repondreDansLaLangue(req: Request, res: Response, next: NextFunction): void {
  if (langueDe(req) === 'en') {
    const json = res.json.bind(res);
    res.json = ((corps: unknown) => {
      const c = corps as { error?: unknown } | null;
      if (c && typeof c === 'object' && typeof c.error === 'string' && MESSAGES_EN[c.error]) {
        return json({ ...c, error: MESSAGES_EN[c.error] });
      }
      return json(corps);
    }) as Response['json'];
  }
  next();
}
