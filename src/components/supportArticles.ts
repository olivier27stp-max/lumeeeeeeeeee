/**
 * FAQ du support : données seules, sans React.
 *
 * Partagée par le tiroir d'aide, la page Support ET l'assistant de support
 * côté serveur (server/lib/support/ia.ts — c'est pour ça que ce fichier ne
 * doit importer aucun composant ; il est copié dans l'image Docker comme
 * fonctionsData.ts). Les réponses vivent dans le code : elles restent courtes
 * et pointent vers une vraie page de l'app.
 */
export interface Article {
  id: string;
  /** Route the answer refers to; the drawer offers to navigate there. */
  path?: string;
  q_fr: string;
  q_en: string;
  a_fr: string;
  a_en: string;
  /** Extra search terms that don't appear in the question/answer text. */
  tags: string;
}

export const ARTICLES: Article[] = [
  {
    id: 'quote-to-invoice',
    path: '/quotes',
    q_fr: 'Comment transformer un devis en facture ?',
    q_en: 'How do I turn a quote into an invoice?',
    a_fr: "Ouvrez le devis approuvé, puis utilisez l'action « Convertir en facture ». Les articles, prix et taxes sont repris automatiquement — vous n'avez qu'à vérifier la date d'échéance avant d'envoyer.",
    a_en: 'Open the approved quote and use the “Convert to invoice” action. Line items, pricing and taxes carry over automatically — just confirm the due date before sending.',
    tags: 'devis soumission facture invoice quote convertir',
  },
  {
    id: 'get-paid',
    path: '/settings/payments',
    q_fr: 'Comment me faire payer par carte ?',
    q_en: 'How do I get paid by card?',
    a_fr: "Activez Lume Payments dans Paramètres → Lume Payments. Une fois votre compte connecté, chaque facture envoyée contient un bouton de paiement, et l'argent est déposé automatiquement dans votre compte bancaire.",
    a_en: 'Enable Lume Payments under Settings → Lume Payments. Once your account is connected, every invoice you send includes a payment button and funds are deposited to your bank automatically.',
    tags: 'paiement carte credit stripe argent depot payout encaisser',
  },
  {
    id: 'add-member',
    path: '/settings/team',
    q_fr: 'Comment ajouter un employé à mon équipe ?',
    q_en: 'How do I add an employee to my team?',
    a_fr: "Allez dans Paramètres → Membres, puis invitez la personne par courriel. Elle recevra un lien pour créer son compte. Si votre forfait n'a plus de sièges disponibles, un siège supplémentaire vous sera facturé au prorata.",
    a_en: 'Go to Settings → Members and invite the person by email. They get a link to set up their account. If your plan is out of seats, an extra seat is billed pro rata.',
    tags: 'equipe employe membre inviter siege seat utilisateur team',
  },
  {
    id: 'permissions',
    path: '/settings/roles',
    q_fr: 'Comment limiter ce qu\'un employé peut voir ?',
    q_en: 'How do I limit what an employee can see?',
    a_fr: 'Dans Paramètres → Rôles & Permissions, choisissez le rôle du membre ou créez-en un sur mesure. Vous contrôlez l\'accès module par module : finances, clients, horaire, etc.',
    a_en: 'Under Settings → Roles & Permissions, pick the member’s role or build a custom one. You control access module by module: finances, clients, schedule, and so on.',
    tags: 'permission role acces droit securite restreindre cacher',
  },
  {
    id: 'schedule-job',
    path: '/calendar',
    q_fr: 'Comment planifier un travail dans le calendrier ?',
    q_en: 'How do I schedule a job on the calendar?',
    a_fr: "Depuis le Calendrier, cliquez sur une plage horaire, ou ouvrez un travail existant et assignez-lui une date et un employé. La vue Répartition permet de déplacer les visites par glisser-déposer.",
    a_en: 'From the Calendar, click a time slot, or open an existing job and assign it a date and an employee. The Dispatch view lets you drag visits around.',
    tags: 'calendrier horaire planifier cedule job travail visite dispatch',
  },
  {
    id: 'recurring',
    path: '/jobs',
    q_fr: 'Comment créer un travail récurrent ?',
    q_en: 'How do I create a recurring job?',
    a_fr: "À la création du travail, choisissez une récurrence (hebdomadaire, mensuelle, etc.). Lume génère les visites à l'avance ; vous pouvez modifier ou annuler une occurrence sans toucher aux autres.",
    a_en: 'When creating the job, pick a recurrence (weekly, monthly, and so on). Lume generates the visits ahead of time, and you can edit or cancel a single occurrence without affecting the rest.',
    tags: 'recurrent repetition contrat hebdomadaire mensuel abonnement client',
  },
  {
    id: 'sms',
    path: '/settings/messaging',
    q_fr: 'Comment envoyer des SMS à mes clients ?',
    q_en: 'How do I text my clients?',
    a_fr: "La messagerie SMS s'active dans Paramètres → Messagerie SMS. Un numéro local vous est attribué avec les forfaits qui incluent les SMS. Vous pouvez ensuite envoyer des rappels de rendez-vous automatiques.",
    a_en: 'SMS messaging is set up under Settings → SMS Messaging. A local number is provisioned on plans that include SMS. From there you can send automatic appointment reminders.',
    tags: 'sms texto message rappel numero telephone twilio',
  },
  {
    id: 'automations',
    path: '/automations',
    q_fr: 'Comment fonctionnent les automatisations ?',
    q_en: 'How do automations work?',
    a_fr: "Dans Automatisations, chaque règle (devis approuvé → courriel, facture en retard → rappel, job terminé → demande d'avis…) a un interrupteur pour l'activer ou la mettre en pause, et un panneau qui montre ce qu'elle a envoyé et à qui. Les filtres en haut trient par statut. Les textes des messages se modifient dans la règle. Rien ne se supprime : une règle inutile se met en pause.",
    a_en: 'In Automations, each rule (quote approved → email, overdue invoice → reminder, job done → review request…) has a switch to enable or pause it, and a panel showing what it sent and to whom. The filters at the top sort by status. Message texts are edited inside the rule. Nothing gets deleted: an unneeded rule is paused.',
    tags: 'automatisation automation règle rule déclencheur trigger relance rappel avis pause activer',
  },
  {
    id: 'change-plan',
    path: '/settings/billing',
    q_fr: 'Comment changer ou annuler mon forfait ?',
    q_en: 'How do I change or cancel my plan?',
    a_fr: "Tout se passe dans Paramètres → Forfait & facturation. Une amélioration prend effet immédiatement (montant ajusté au prorata) ; une rétrogradation ou une annulation prend effet à la fin de la période déjà payée.",
    a_en: 'Everything is under Settings → Plan & billing. Upgrades take effect immediately with a pro-rata charge; downgrades and cancellations take effect at the end of the period you already paid for.',
    tags: 'forfait plan abonnement annuler upgrade downgrade facturation prix',
  },
  {
    id: 'invoice-unpaid',
    path: '/finances',
    q_fr: 'Un client n\'a pas payé sa facture — que faire ?',
    q_en: 'A client hasn’t paid their invoice — what now?',
    a_fr: "La facture apparaît comme « en retard » dans Factures. Vous pouvez la renvoyer en un clic, ou configurer une relance automatique dans Automatisations pour que Lume s'en occupe à votre place.",
    a_en: 'The invoice shows as overdue under Invoices. You can resend it in one click, or set up an automatic follow-up under Automations so Lume chases it for you.',
    tags: 'impaye retard relance facture overdue rappel argent du',
  },
  {
    id: 'import-clients',
    path: '/clients',
    q_fr: 'Puis-je importer ma liste de clients ?',
    q_en: 'Can I import my client list?',
    a_fr: "Oui. Depuis la page Clients, utilisez l'import par fichier CSV. Prévoyez au minimum le nom et un moyen de contact (courriel ou téléphone) par ligne. Écrivez-nous si votre fichier vient d'un autre logiciel, on peut vous aider à le préparer.",
    a_en: 'Yes. From the Clients page, use the CSV import. Each row needs at least a name and one way to reach them (email or phone). Message us if your file comes from another tool — we can help you prep it.',
    tags: 'import importer csv excel migration client contact transferer',
  },
  {
    id: 'mobile',
    path: '/day',
    q_fr: 'Est-ce que Lume fonctionne sur téléphone ?',
    q_en: 'Does Lume work on a phone?',
    a_fr: "Lume se travaille sur ordinateur (tableaux, calendrier de répartition, glisser-déposer). Sur un téléphone, l'app affiche une page d'attente : l'application mobile est en bêta fermée et n'est pas encore publiée. Par contre, tout ce que reçoivent VOS clients fonctionne sur leur téléphone sans rien installer : soumission à approuver, contrat à signer, paiement en ligne, portail et formulaire de demande.",
    a_en: 'Lume is built for a computer screen (tables, dispatch calendar, drag and drop). On a phone, the app shows a waiting page: the mobile app is in closed beta and not published yet. Everything YOUR clients receive works on their phone with nothing to install: quote approval, contract signing, online payment, portal and request form.',
    tags: 'mobile téléphone cellulaire application app ios android testflight hors ligne offline',
  },
  {
    id: 'delete-task',
    path: '/tasks',
    q_fr: 'Comment supprimer une tâche ?',
    q_en: 'How do I delete a task?',
    a_fr: "Dans Tâches, sur la ligne de la tâche, cliquez l'icône corbeille « Supprimer » (ou le menu « … » → « Supprimer »). Pour plusieurs tâches d'un coup : cochez-les, puis « Supprimer ». C'est immédiat, sans confirmation. Si vous parlez d'un travail planifié (une job), c'est dans Jobs : menu « … » → « Supprimer ».",
    a_en: 'In Tasks, on the task row, click the trash icon “Delete” (or the “…” menu → “Delete”). For several at once: tick them, then “Delete”. It is immediate, with no confirmation. If you mean a scheduled job, that is in Jobs: “…” menu → “Delete”.',
    tags: 'tache taches supprimer effacer retirer a-faire todo task delete',
  },
  {
    id: 'delete-job',
    path: '/jobs',
    q_fr: 'Comment supprimer ou archiver une job ?',
    q_en: 'How do I delete or archive a job?',
    a_fr: "Dans Jobs, sur la ligne de la job : menu « … » → « Supprimer », puis confirmez. La job est masquée des vues actives (un bouton « Annuler » apparaît quelques secondes). Il n'y a pas de bouton « Archiver » : l'onglet « Archivé » regroupe automatiquement les jobs complétées ou annulées.",
    a_en: 'In Jobs, on the job row: “…” menu → “Delete”, then confirm. The job is hidden from active views (an “Undo” button shows for a few seconds). There is no “Archive” button: the “Archived” tab automatically groups completed or cancelled jobs.',
    tags: 'job travail supprimer archiver annuler effacer retirer',
  },
  {
    id: 'archive-client',
    path: '/clients',
    q_fr: 'Comment archiver ou supprimer un client ?',
    q_en: 'How do I archive or delete a client?',
    a_fr: "Ouvrez la fiche du client → menu « … » → « Archiver » : ses jobs, factures et devis restent visibles, et vous pouvez le restaurer dans Paramètres → Archives. Pour effacer définitivement (et tout ce qui lui est lié) : fiche → « Modifier » → bouton rouge « Supprimer ».",
    a_en: 'Open the client → “…” menu → “Archive”: their jobs, invoices and quotes stay visible, and you can restore them in Settings → Archives. To erase permanently (with everything linked): client → “Edit” → red “Delete” button.',
    tags: 'client archiver supprimer effacer restaurer archives',
  },
  {
    id: 'void-invoice',
    path: '/finances',
    q_fr: 'Comment annuler une facture ou la marquer payée ?',
    q_en: 'How do I void an invoice or mark it paid?',
    a_fr: "Ouvrez la facture (Finances → Facturation) → menu « … » → « Marquer payée » ou « Annuler », puis confirmez : la facture annulée reste dans l'historique. Pour la retirer de la liste, dans Finances → Facturation, menu « … » de la ligne → « Supprimer » (confirmation).",
    a_en: 'Open the invoice (Finances → Invoicing) → “…” menu → “Mark paid” or “Void”, then confirm: a voided invoice stays in the history. To remove it from the list, in Finances → Invoicing, use the row’s “…” menu → “Delete” (confirmation).',
    tags: 'facture annuler supprimer payee marquer payee void',
  },
  {
    id: 'reschedule-job',
    path: '/calendar',
    q_fr: 'Comment changer la date ou l’heure d’une job ?',
    q_en: 'How do I change the date or time of a job?',
    a_fr: "Le plus rapide : dans le Calendrier, glissez l'événement à sa nouvelle place (ou étirez-le pour changer la durée). Sinon, ouvrez la job → carte de la visite → « Plus d'actions » → « Modifier la visite », changez la date, l'heure ou l'équipe, puis « Enregistrer ».",
    a_en: 'Fastest: in the Calendar, drag the event to its new slot (or stretch it to change the duration). Otherwise open the job → visit card → “More actions” → “Edit visit”, change the date, time or crew, then “Save”.',
    tags: 'job replanifier deplacer date heure calendrier visite horaire reschedule',
  },
  {
    id: 'change-language',
    path: '/settings/profile',
    q_fr: 'Comment changer la langue de Lume ?',
    q_en: 'How do I change the language of Lume?',
    a_fr: "Paramètres → Mon profil, section « Langue de l'interface » : choisissez « Français » ou « English », c'est appliqué tout de suite. La langue des messages envoyés à vos clients se règle à part, dans Automatisations.",
    a_en: 'Settings → My profile, “Interface language” section: pick “Français” or “English”, it applies right away. The language of messages sent to your clients is set separately, in Automations.',
    tags: 'langue language francais anglais english interface profil',
  },
  {
    id: 'two-factor',
    path: '/settings/team',
    q_fr: 'Comment activer la double authentification (2FA) ?',
    q_en: 'How do I turn on two-factor authentication (2FA)?',
    a_fr: "Elle s'active d'elle-même à votre première action sensible, par exemple inviter un membre dans Paramètres → Membres : Lume affiche un code QR à scanner avec une application d'authentification (Google Authenticator, Authy, 1Password ou l'app Mots de passe), puis vous entrez le code à 6 chiffres. Ensuite, un code vous sera demandé pour ces actions.",
    a_en: 'It turns on by itself at your first sensitive action, for example inviting a member in Settings → Members: Lume shows a QR code to scan with an authenticator app (Google Authenticator, Authy, 1Password or the Passwords app), then you enter the 6-digit code. A code is then requested for those actions.',
    tags: '2fa mfa double authentification deux facteurs sécurité code qr authenticator',
  },
  {
    id: 'forgot-password',
    path: '/auth',
    q_fr: "J'ai oublié mon mot de passe, comment me reconnecter ?",
    q_en: 'I forgot my password, how do I sign back in?',
    a_fr: "Sur la page de connexion, cliquez « Mot de passe oublié », entrez votre courriel : vous recevez un lien qui ouvre la page de réinitialisation. Choisissez un nouveau mot de passe et reconnectez-vous. Pas de courriel après quelques minutes ? Vérifiez les indésirables et que l'adresse est bien celle du compte.",
    a_en: 'On the sign-in page, click "Forgot password", enter your email: you receive a link that opens the reset page. Choose a new password and sign in again. No email after a few minutes? Check spam and that the address is the one on the account.',
    tags: 'mot de passe oublié réinitialiser reset password connexion login courriel',
  },
  {
    id: 'taxes-setup',
    path: '/settings/taxes',
    q_fr: 'Comment régler mes taxes (TPS/TVQ) ?',
    q_en: 'How do I set up my taxes (GST/QST)?',
    a_fr: "Paramètres → Taxes : « Ajouter une région » (Québec : TPS 5 % et TVQ 9,975 %), puis « Définir par défaut ». Ces taxes s'appliquent automatiquement aux nouveaux devis, jobs et factures ; un document peut être marqué sans taxes au cas par cas. Modifier une taxe ne change pas les documents déjà émis.",
    a_en: 'Settings → Taxes: "Add a region" (Quebec: GST 5% and QST 9.975%), then "Set as default". These taxes apply automatically to new quotes, jobs and invoices; a document can be marked tax-free case by case. Changing a tax does not alter documents already issued.',
    tags: 'taxes tps tvq gst qst hst région défaut paramètres',
  },
  {
    id: 'leads-vs-clients',
    path: '/quotes',
    q_fr: "C'est quoi la différence entre un prospect (lead) et un client ?",
    q_en: 'What is the difference between a lead and a client?',
    a_fr: "Un prospect est une personne qui n'a pas encore acheté : une demande reçue du formulaire, un appel, un contact de porte-à-porte. Il vit dans le pipeline des soumissions. Dès qu'une soumission est approuvée ou qu'un job est créé, il devient un client avec sa fiche complète (historique, factures, messages). Lumi peut convertir un prospect en client sur demande.",
    a_en: 'A lead is someone who has not bought yet: a form request, a call, a door-to-door contact. It lives in the quotes pipeline. Once a quote is approved or a job is created, it becomes a client with a full profile (history, invoices, messages). Lumi can convert a lead into a client on request.',
    tags: 'lead prospect client pipeline convertir conversion demande',
  },
  {
    id: 'google-reviews',
    path: '/settings/reviews',
    q_fr: 'Comment demander des avis Google à mes clients ?',
    q_en: 'How do I ask my clients for Google reviews?',
    a_fr: "Paramètres → Avis clients : activez « Demander un avis à la fin d'un job » et collez le lien de votre fiche Google. À la fin de chaque job, le client reçoit un texto avec un sondage étoiles ; une bonne note l'envoie vers votre page Google, une mauvaise vous revient en privé. Le message se personnalise au même endroit.",
    a_en: 'Settings → Client reviews: turn on "Ask for a review when a job ends" and paste your Google listing link. At the end of each job the client gets a text with a star survey; a good rating sends them to your Google page, a bad one comes back to you privately. The message is customized in the same place.',
    tags: 'avis google review étoiles sondage réputation fin de job',
  },
  {
    id: 'job-profit',
    path: '/jobs',
    q_fr: 'Comment voir si un job a été rentable ?',
    q_en: 'How do I see whether a job was profitable?',
    a_fr: "Dans la fiche du job, cliquez « Afficher la rentabilité » : revenu facturé, main-d'œuvre (heures pointées × taux), dépenses et profit. Pour enregistrer des dépenses (essence, matériaux, sous-traitant), demandez à Lumi : « ajoute 80 $ de dépenses sur le job 12 ». Le rapport Finances donne la vue d'ensemble par période.",
    a_en: 'In the job sheet, click "Show profitability": billed revenue, labour (clocked hours × rate), expenses and profit. To record expenses (gas, materials, subcontractor), ask Lumi: "add $80 of expenses to job 12". The Finances report gives the overview per period.',
    tags: 'rentabilité profit marge dépenses coûts main-d’œuvre job',
  },
];
