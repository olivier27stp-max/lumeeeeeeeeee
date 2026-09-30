/* ══════════════════════════════════════════════════════════════
   LE NOM D'UNE AUTOMATISATION, EN FRANÇAIS.

   Les préréglages sont semés en base avec un nom ANGLAIS
   (« Appointment Confirmation ») : 275 des 500 règles actives en
   portent un. La LISTE les traduisait à l'affichage, mais la table
   vivait dans le fichier de la page — l'ÉDITEUR n'y avait pas accès.

   Résultat, constaté le 2026-09-25 : on cliquait sur
   « Confirmation de rendez-vous » et l'éditeur s'ouvrait sur
   « Appointment Confirmation ». Le même objet, deux noms, dont un dans
   la mauvaise langue.

   La table est ici pour que TOUT écran puisse s'en servir.

   Pourquoi traduire à l'affichage plutôt que renommer en base : le nom
   stocké est ce que l'entreprise peut modifier elle-même. Une migration
   qui l'écrase effacerait les renommages des clients, et les 275 règles
   concernées appartiennent à des entreprises différentes.
   ═════════════════════════════════════════════════════════════ */

export const AUTOMATION_NAME_FR: Record<string, string> = {
  // Contrats — le seul preset dont le nom semé en anglais restait tel quel
  // dans l'interface française (2026-09-23).
  'Contract Signed': 'Contrat signé',
  // Leads
  'Lead — Welcome': 'Prospect — Bienvenue',
  'Welcome New Lead': 'Bienvenue au nouveau prospect',
  'Lead Alert — 7 Days Stale': 'Alerte prospect — 7 jours inactif',
  'Stale Lead Alert — 7 Days': 'Alerte prospect inactif — 7 jours',
  'Stale Lead — 7 Days': 'Prospect inactif — 7 jours',
  'Lead Final Follow-Up — 14 Days': 'Dernier suivi prospect — 14 jours',
  'Lead Follow-Up — 1 Day': 'Suivi prospect — 1 jour',
  'Lead Follow-Up — 3 Days': 'Suivi prospect — 3 jours',
  'Lost Lead Re-engagement — 90 Days': 'Réengagement prospect perdu — 90 jours',
  'Lost Lead Re-engagement': 'Réengagement prospect perdu',
  'Lost Lead — Re-engagement': 'Prospect perdu — Réengagement',
  // Quotes / Estimates
  'Estimate Follow-Up': "Suivi d'estimation",
  'Estimate Follow-Up (3 days)': "Suivi d'estimation (3 jours)",
  'Quote Follow-Up — 1 Day': 'Suivi de devis — 1 jour',
  'Quote Follow-Up — 1 Day After Sent': 'Suivi de devis — 1 jour après envoi',
  'Quote Follow-Up — 3 Days': 'Suivi de devis — 3 jours',
  'Quote Follow-Up — 7 Days': 'Suivi de devis — 7 jours',
  'Quote Follow-Up — 14 Days': 'Suivi de devis — 14 jours',
  'Quote Follow-Up — 21 Days': 'Suivi de devis — 21 jours',
  'Quote Follow-Up — 21 Days (Final)': 'Suivi de devis — 21 jours (final)',
  // Jobs / Scheduling
  'Appointment Confirmation': 'Confirmation de rendez-vous',
  'Job Reminder — 1 Week Before': 'Rappel de rendez-vous — 1 semaine avant',
  'Job Reminder — 7 Days Before': 'Rappel de rendez-vous — 7 jours avant',
  'Job Reminder — 1 Day Before': 'Rappel de rendez-vous — 1 jour avant',
  'Job Reminder — 2 Hours Before': 'Rappel de rendez-vous — 2 heures avant',
  'No-Show / Cancellation Follow-Up': "Suivi d'absence / annulation",
  'No-Show Follow-Up': "Suivi d'absence",
  // Invoices
  'Invoice Reminder — 1 Day': 'Rappel de facture — 1 jour',
  'Invoice Reminder — 1 Day After Sent': 'Rappel de facture — 1 jour après envoi',
  'Invoice Reminder — 3 Days': 'Rappel de facture — 3 jours',
  'Invoice Reminder — 3 Days After Sent': 'Rappel de facture — 3 jours après envoi',
  'Invoice Reminder — 7 Days': 'Rappel de facture — 7 jours',
  'Invoice Reminder — 7 Days After Sent': 'Rappel de facture — 7 jours après envoi',
  'Invoice Reminder — 14 Days': 'Rappel de facture — 14 jours',
  'Invoice Final Reminder — 30 Days': 'Dernier rappel de facture — 30 jours',
  'Invoice Final Reminder — 30 Days After Sent': 'Dernier rappel de facture — 30 jours après envoi',
  // Semé par `seed_automation_presets` (baseline SQL) — absent jusqu'ici :
  // la liste française affichait l'anglais (audit V2, A-16).
  'Invoice Reminder — 30 Days': 'Rappel de facture — 30 jours',
  'Invoice Reminder (J+1)': 'Rappel de facture (J+1)',
  'Invoice Reminder (J+3)': 'Rappel de facture (J+3)',
  'Invoice Reminder (J+5)': 'Rappel de facture (J+5)',
  'Invoice Reminder (J+15)': 'Rappel de facture (J+15)',
  'Invoice Reminder (J+30)': 'Rappel de facture (J+30)',
  // Payments
  'Payment Confirmation': 'Confirmation de paiement',
  'Payment Confirmation — Thank You': 'Confirmation de paiement — Merci',
  'Deposit Received': 'Dépôt reçu',
  'Deposit Received Confirmation': 'Confirmation de dépôt reçu',
  'Deposit Reminder — Quote Approved': 'Rappel de dépôt — Devis accepté',
  'Deposit Follow-Up — 2 Days': 'Suivi de dépôt — 2 jours',
  // Follow-up
  'Thank You After Job': 'Merci après le job',
  'Thank You — After Job Completed': 'Merci — Job terminé',
  'Cross-Sell — 30 Days After Job': 'Vente croisée — 30 jours après le job',
  'Cross-Sell Follow-Up — 30 Days After Job': 'Suivi de vente croisée — 30 jours après le job',
  'Cross-Sell — 30 Days': 'Vente croisée — 30 jours',
  'Re-Engagement — 90 Days': 'Réengagement — 90 jours',
  'Post-Job Survey': 'Sondage après le job',
  'Post-Appointment Survey': 'Sondage après rendez-vous',
  'Post-Appointment Satisfaction Check': 'Vérification de satisfaction après rendez-vous',
  // Reviews
  'Google Review Request': "Demande d'avis Google",
  'Review Request — After Job': "Demande d'avis — Après le job",
  'Review Reminder — 7 Days': "Rappel d'avis — 7 jours",
  // Client
  'Client Anniversary': 'Anniversaire client',
  'Client Anniversary — 1 Year': 'Anniversaire client — 1 an',
  'Seasonal Reminder — 6 Months': 'Rappel saisonnier — 6 mois',
  'Seasonal Reminder — 6 Months After Job': 'Rappel saisonnier — 6 mois après le job',
};

/*
 * L'INVERSE : les modèles semés directement en FRANÇAIS (préréglages du
 * pipeline, sondage d'avis, pack de base) s'affichaient en français à un
 * utilisateur anglais (audit V2, A-16). Même principe : on traduit à
 * l'affichage, jamais en base.
 *
 * L'éditeur enregistre le nom AFFICHÉ : un modèle ouvert en anglais puis
 * modifié garde donc son nom anglais en base. Chaque libellé anglais d'ici
 * est aussi versé dans la table française (boucle ci-dessous) : il revient
 * en français pour un utilisateur français.
 */
export const AUTOMATION_NAME_EN: Record<string, string> = {
  'Me notifier quand un client ouvre sa soumission': 'Notify me when a client opens their quote',
  'Avancer le deal quand la soumission est envoyée': 'Move the deal forward when the quote is sent',
  'Avancer le deal quand le client ouvre sa soumission': 'Move the deal forward when the client opens their quote',
  'Passer le deal à « Gagné » quand la soumission est acceptée': 'Mark the deal “Won” when the quote is accepted',
  "Sondage d'avis — dès la fin de la job": 'Review survey — as soon as the job is done',
  'Rendez-vous — confirmation et rappels': 'Appointments — confirmation and reminders',
  'Relance de devis — 1, 2, 5, 10 et 30 jours': 'Quote follow-up — 1, 2, 5, 10 and 30 days',
  'Relance de facture — 3, 7, 14 et 30 jours': 'Invoice follow-up — 3, 7, 14 and 30 days',
  'Nouveau prospect — bienvenue et suivis': 'New lead — welcome and follow-ups',
  'Dépôt — demande et rappel': 'Deposit — request and reminder',
};

// Le chemin retour : un libellé anglais d'ici redevient français.
for (const [nomFr, nomEn] of Object.entries(AUTOMATION_NAME_EN)) {
  if (!(nomEn in AUTOMATION_NAME_FR)) AUTOMATION_NAME_FR[nomEn] = nomFr;
}

export function localizeAutomationName(name: string, lang: string): string {
  if (lang !== 'fr') return AUTOMATION_NAME_EN[name] ?? name;
  return AUTOMATION_NAME_FR[name] ?? name;
}
