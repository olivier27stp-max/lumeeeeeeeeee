/**
 * Carte de l'app pour l'assistant de support : routes et libellés EXACTS,
 * relevés dans le code (src/App.tsx, src/i18n/fr.ts, pages) le 2026-09-15.
 * C'est ce qui permet à Lumi de répondre à un « comment faire » banal sans
 * transférer à l'équipe. Règle : rien ici qui n'existe pas dans l'interface.
 * À mettre à jour quand un écran change (test : tests/support/support-ia).
 */
export const CARTE_APP = `Vocabulaire : « tâches » = à-faire de la page Tâches (/tasks) ; « travaux » / « jobs » = travail planifié (/jobs) ; « devis » = soumission (/quotes) ; « facture » (/finances, onglet Facturation).

Tâches (/tasks) : sur la ligne de la tâche, icône corbeille « Supprimer » ou menu « … » → « Supprimer » ; plusieurs tâches : cases à cocher → « Supprimer ». Aucune confirmation, suppression immédiate (toast « Tâche supprimée »), pas de restauration.
Jobs (/jobs) : ligne → menu « … » → « Supprimer » → confirmation « Supprimer cette job ? » (la job est masquée des vues actives, bouton « Annuler » dans le toast quelques secondes). En lot : cases à cocher → « Supprimer ». Il n'y a PAS de bouton « Archiver » ni « Annuler la job » : l'onglet « Archivé » de /jobs montre les jobs complétées ou annulées. Sur /jobs/:id, « Plus d'actions » offre : Fermer le job, Envoyer une confirmation / un suivi / un courriel, Créer une facture, Dupliquer le job, Télécharger le PDF, Imprimer.
Replanifier une job : dans le calendrier (/calendar), glisser l'événement (ou l'étirer) ; ou /jobs/:id → carte de la visite → « Plus d'actions » → « Modifier la visite » (date, heure, équipe) → « Enregistrer » ; « Retirer la visite » au même endroit.
Clients (/clients, fiche /clients/:id) : archiver = fiche → « … » → « Archiver » (confirmation : ses jobs, factures et devis restent visibles) ; restaurer ou supprimer définitivement dans Paramètres → Archives (/settings/archives). Supprimer définitivement = /clients/:id/edit → bouton rouge « Supprimer » (efface tous les enregistrements liés). Notes : bloc « Notes » en bas de la fiche, enregistré au clic hors du champ ou « Enregistrer ». « Exporter les données » et « Supprimer les données (Loi 25) » dans le menu « … » de la fiche. Import CSV de clients : /clients → « Importer ». Il n'y a pas d'export CSV de la liste des clients.
Devis (/quotes) : ligne → « … » → « Archiver » / « Désarchiver » (sans confirmation) ou « Supprimer » (confirmation). Sur /quotes/:id : « Supprimer », ou marquer la soumission comme refusée. Il n'y a pas de bouton « Annuler le devis ».
Factures (/finances → onglet Facturation, fiche /invoices/:id) : menu « … » → « Marquer payée » (confirmation) ou « Annuler » (annule la facture, confirmation). Il n'existe PAS de suppression de facture : on l'annule. Export : bouton « CSV » sur l'onglet Facturation ; aussi /jobs, /finances → Paiements, /timesheets, Paramètres → Paie (« Exporter (QuickBooks CSV) »).
Produits & Services (Paramètres → Produits & Services, /settings/products) : « Nouveau service » → « Enregistrer » ; crayon « Modifier » ; corbeille « Supprimer » (confirmation).
Langue de l'interface : Paramètres → Mon profil (/settings/profile), section « Langue de l'interface », boutons « Français » / « English », appliqué tout de suite. (Ne pas dire « Paramètres → Langue ».) La langue des messages envoyés AUX CLIENTS se choisit dans /automations.
Entreprise : Paramètres → Paramètres entreprise (/settings/company) : logo (enregistré dès le téléversement), nom et coordonnées → « Enregistrer ».
Équipe : Paramètres → Membres (/settings/team) → « Inviter un membre » (courriel + rôle dans le même formulaire) ; changer un rôle plus tard : « Changer le rôle » (admin, représentant, technicien). Ce qu'un rôle peut voir : Paramètres → Rôles (/settings/roles).
Automatisations (/automations) : interrupteur à droite de chaque règle (« Activer » / « Désactiver »), sans confirmation ; filtres « Actives » / « Inactives » / « Toutes ».
Forfait : Paramètres → Forfait & facturation (/settings/billing). Textos : Paramètres → Messagerie (/settings/messaging). Calendrier : /calendar. Paiements en ligne : /payments et Paramètres → Lume Payments.`;
