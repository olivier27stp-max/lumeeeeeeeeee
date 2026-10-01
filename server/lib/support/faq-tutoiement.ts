/**
 * Les réponses de la FAQ, à la voix de Lumi.
 * ──────────────────────────────────────────
 * La FAQ (src/components/supportArticles.ts) est écrite au « vous » : c'est la
 * voix du support et du centre d'aide. Lumi, lui, tutoie — partout, toujours
 * (server/lib/agent/consignesCollegue.ts). Passe de référence du 2026-10-01 :
 * quand Lumi servait un article gratuit, il passait au « vous » le temps d'une
 * réponse, puis revenait au « tu » au message suivant. Pour quelqu'un qui
 * parle à UN assistant, ce sont deux personnes différentes.
 *
 * Même contenu, mêmes chemins, mêmes boutons que l'article d'origine : seule la
 * voix change (et « Lumi peut… » devient « je peux… », puisque c'est lui qui
 * parle). Un article ajouté à la FAQ sans sa version ici fait échouer
 * tests/lumi-aide-tutoiement.test.ts.
 *
 * Le français seulement : l'anglais n'a pas de tutoiement.
 */
export type Voix = 'tu' | 'vous';

export const REPONSES_TU: Readonly<Record<string, string>> = {
  'quote-preset': "Un modèle de soumission prêt à envoyer, à ton nom : un titre, une description, une image de couverture, la liste de tes services avec prix et quantités, un texte d'introduction, tes conditions, et un dépôt (fixe ou en pourcentage) si tu en demandes un. À la création du compte, Lume propose des services de départ selon ton métier ; ensuite, tes préréglages ne contiennent que ce que tu y as mis.",
  'quote-preset-edit': "Entièrement : titre, description, images, services (ajouter, retirer, changer prix et quantités), texte d'intro, conditions, dépôt et sections personnalisées, dans Soumissions → Modèles et préréglages. Les soumissions déjà envoyées ne changent pas : un préréglage est un point de départ, chaque soumission garde sa propre copie. Un préréglage dont tu ne te sers plus se désactive plutôt que de se supprimer, pour garder l'historique.",
  'quote-preset-trade': "Les services proposés au départ ne sont qu'une suggestion selon le métier choisi : tu peux créer tes propres préréglages de zéro dans Soumissions → Modèles et préréglages, avec tes services, tes prix et tes conditions. Rien ne t'oblige à partir d'un modèle existant.",
  'quote-to-invoice': "Ouvre le devis approuvé, puis utilise l'action « Convertir en facture ». Les articles, prix et taxes sont repris automatiquement — tu n'as qu'à vérifier la date d'échéance avant d'envoyer.",
  'get-paid': "Active Lume Payments dans Paramètres → Lume Payments. Une fois ton compte connecté, chaque facture envoyée contient un bouton de paiement, et l'argent est déposé automatiquement dans ton compte bancaire.",
  'add-member': "Va dans Paramètres → Membres, puis invite la personne par courriel. Elle recevra un lien pour créer son compte. Si ton forfait n'a plus de sièges disponibles, un siège supplémentaire te sera facturé au prorata.",
  'permissions': "Dans Paramètres → Rôles & Permissions, choisis le rôle du membre ou crée-en un sur mesure. Tu contrôles l'accès module par module : finances, clients, horaire, etc. Exception : un technicien ne voit jamais les montants (factures, soumissions, paiements). C'est bloqué pour ce rôle et aucune case ne le débloque ; pour montrer les prix à quelqu'un, donne-lui le rôle Représentant ou Administrateur.",
  'schedule-job': "Depuis le Calendrier, clique sur une plage horaire, ou ouvre un travail existant et assigne-lui une date et un employé. La vue Répartition permet de déplacer les visites par glisser-déposer.",
  'recurring': "À la création du travail, choisis une récurrence (hebdomadaire, mensuelle, etc.). Lume génère les visites à l'avance ; tu peux modifier ou annuler une occurrence sans toucher aux autres.",
  'sms': "La messagerie SMS s'active dans Paramètres → Messagerie SMS. Un numéro local t'est attribué avec les forfaits qui incluent les SMS. Tu peux ensuite envoyer des rappels de rendez-vous automatiques.",
  'automations': "Dans Automatisations, chaque règle (devis approuvé → courriel, facture en retard → rappel, job terminé → demande d'avis…) a un interrupteur pour l'activer ou la mettre en pause, et un panneau qui montre ce qu'elle a envoyé et à qui. Les filtres en haut trient par statut. Les textes des messages se modifient dans la règle. Rien ne se supprime : une règle inutile se met en pause.",
  'change-plan': "Tout se passe dans Paramètres → Forfait & facturation. Une amélioration prend effet immédiatement (montant ajusté au prorata) ; une rétrogradation ou une annulation prend effet à la fin de la période déjà payée.",
  'billing-failed': "Va dans Paramètres → Forfait & facturation : tant que le paiement n'est pas réglé, un bandeau te propose de mettre ta carte à jour. Ton compte reste utilisable pendant ce délai — corrige la carte et le paiement est repris automatiquement, sans rien perdre.",
  'talk-to-human': "Dis-le simplement ici (« je veux parler à quelqu'un ») : je transmets la conversation à l'équipe avec tout le contexte, et une vraie personne te répond dans ce même fil. Pas de file d'attente ni de numéro à composer.",
  'invoice-unpaid': "La facture apparaît comme « en retard » dans Factures. Tu peux la renvoyer en un clic, ou configurer une relance automatique dans Automatisations pour que Lume s'en occupe à ta place.",
  'import-clients': "Oui. Depuis la page Clients, utilise l'import par fichier CSV. Prévois au minimum le nom et un moyen de contact (courriel ou téléphone) par ligne. Écris à l'équipe si ton fichier vient d'un autre logiciel, elle peut t'aider à le préparer.",
  'mobile': "Lume se travaille sur ordinateur (tableaux, calendrier de répartition, glisser-déposer). Sur un téléphone, l'app affiche une page d'attente : l'application mobile est en bêta fermée et n'est pas encore publiée. Par contre, tout ce que reçoivent TES clients fonctionne sur leur téléphone sans rien installer : soumission à approuver, contrat à signer, paiement en ligne, portail et formulaire de demande.",
  'delete-task': "Dans Tâches, sur la ligne de la tâche, clique l'icône corbeille « Supprimer » (ou le menu « … » → « Supprimer »). Pour plusieurs tâches d'un coup : coche-les, puis « Supprimer ». C'est immédiat, sans confirmation. Si tu parles d'un travail planifié (une job), c'est dans Jobs : menu « … » → « Supprimer ».",
  'delete-job': "Dans Jobs, sur la ligne de la job : menu « … » → « Supprimer », puis confirme. La job est masquée des vues actives (un bouton « Annuler » apparaît quelques secondes). Il n'y a pas de bouton « Archiver » : l'onglet « Archivé » regroupe automatiquement les jobs complétées ou annulées.",
  'archive-client': "Ouvre la fiche du client → menu « … » → « Archiver » : ses jobs, factures et devis restent visibles, et tu peux le restaurer dans Paramètres → Archives. Pour effacer définitivement (et tout ce qui lui est lié) : fiche → « Modifier » → bouton rouge « Supprimer ».",
  'void-invoice': "Ouvre la facture (Finances → Facturation) → menu « … » → « Marquer payée » ou « Annuler », puis confirme : la facture annulée reste dans l'historique. Pour la retirer de la liste, dans Finances → Facturation, menu « … » de la ligne → « Supprimer » (confirmation).",
  'reschedule-job': "Le plus rapide : dans le Calendrier, glisse l'événement à sa nouvelle place (ou étire-le pour changer la durée). Sinon, ouvre la job → carte de la visite → « Plus d'actions » → « Modifier la visite », change la date, l'heure ou l'équipe, puis « Enregistrer ».",
  'change-language': "Paramètres → Mon profil, section « Langue de l'interface » : choisis « Français » ou « English », c'est appliqué tout de suite. La langue des messages envoyés à tes clients se règle à part, dans Automatisations.",
  'two-factor': "Elle s'active d'elle-même à ta première action sensible, par exemple inviter un membre dans Paramètres → Membres : Lume affiche un code QR à scanner avec une application d'authentification (Google Authenticator, Authy, 1Password ou l'app Mots de passe), puis tu entres le code à 6 chiffres. Ensuite, un code te sera demandé pour ces actions.",
  'forgot-password': "Sur la page de connexion, clique « Mot de passe oublié », entre ton courriel : tu reçois un lien qui ouvre la page de réinitialisation. Choisis un nouveau mot de passe et reconnecte-toi. Pas de courriel après quelques minutes ? Vérifie les indésirables et que l'adresse est bien celle du compte.",
  'taxes-setup': "Paramètres → Taxes : « Ajouter une région » (Québec : TPS 5 % et TVQ 9,975 %), puis « Définir par défaut ». Ces taxes s'appliquent automatiquement aux nouveaux devis, jobs et factures ; un document peut être marqué sans taxes au cas par cas. Modifier une taxe ne change pas les documents déjà émis.",
  'leads-vs-clients': "Un prospect est une personne qui n'a pas encore acheté : une demande reçue du formulaire, un appel, un contact de porte-à-porte. Il vit dans le pipeline des soumissions. Dès qu'une soumission est approuvée ou qu'un job est créé, il devient un client avec sa fiche complète (historique, factures, messages). Je peux convertir un prospect en client si tu me le demandes.",
  'google-reviews': "Paramètres → Avis clients : active « Demander un avis à la fin d'un job » et colle le lien de ta fiche Google. À la fin de chaque job, le client reçoit un texto et un courriel avec un lien qui l'amène à choisir Google ou Facebook pour laisser son avis. Pour exclure un client, coche son champ personnalisé « noreview ». Le message se personnalise au même endroit.",
  'job-profit': "Dans la fiche du job, clique « Afficher la rentabilité » : revenu facturé, main-d'œuvre (heures pointées × taux), dépenses et profit. Pour enregistrer des dépenses (essence, matériaux, sous-traitant), demande-le-moi : « ajoute 80 $ de dépenses sur le job 12 ». Le rapport Finances donne la vue d'ensemble par période.",
};
