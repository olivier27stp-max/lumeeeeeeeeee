/**
 * Ce que Lumi veut faire, en mots courants — le titre de la carte de confirmation.
 * ─────────────────────────────────────────────────────────────────────────
 * « Lumi veut <verbe> ». Avant (2026-10-01), 20 outils seulement avaient un verbe ;
 * les 161 autres affichaient le nom de la PERMISSION (« la paie », « l'envoi de devis »),
 * identique pour des actions contraires : marquer la paie payée et annuler ce paiement,
 * ajouter et retirer une étiquette, supprimer un modèle et le mettre par défaut.
 *
 * Un outil d'écriture sans verbe fait échouer tests/lumi-verbes-cartes.test.ts.
 * Fichier de données : aucun import, lisible par l'interface comme par les tests.
 */
export interface VerbeLumi { fr: string; en: string }

export const VERBES_LUMI: Record<string, VerbeLumi> = {
  // ── Clients, prospects, fiches ───────────────────────────────────────────
  create_client: { fr: 'créer un client', en: 'create a client' },
  update_client: { fr: 'modifier un client', en: 'update a client' },
  delete_client: { fr: 'supprimer un client', en: 'delete a client' },
  merge_clients: { fr: 'fusionner deux fiches clients', en: 'merge two client records' },
  create_lead: { fr: 'créer un prospect', en: 'create a lead' },
  update_lead: { fr: 'modifier un prospect', en: 'update a lead' },
  update_lead_status: { fr: 'changer l’étape d’un prospect', en: 'move a lead to another stage' },
  delete_lead: { fr: 'supprimer un prospect', en: 'delete a lead' },
  convert_lead_to_client: { fr: 'convertir un prospect en client', en: 'convert a lead into a client' },
  convert_lead_to_job: { fr: 'convertir un prospect en job', en: 'convert a lead into a job' },
  process_request_submission: { fr: 'traiter une demande reçue', en: 'process an incoming request' },
  delete_request_submission: { fr: 'supprimer une demande reçue', en: 'delete an incoming request' },
  create_property: { fr: 'ajouter une adresse de service', en: 'add a service address' },
  update_property: { fr: 'modifier une adresse de service', en: 'update a service address' },
  delete_property: { fr: 'supprimer une adresse de service', en: 'delete a service address' },
  add_note: { fr: 'ajouter une note', en: 'add a note' },
  update_note: { fr: 'modifier une note', en: 'edit a note' },
  delete_note: { fr: 'supprimer une note', en: 'delete a note' },
  set_custom_field: { fr: 'changer un champ personnalisé', en: 'set a custom field' },
  add_client_tag: { fr: 'ajouter une étiquette à un client', en: 'add a tag to a client' },
  remove_client_tag: { fr: 'retirer une étiquette d’un client', en: 'remove a tag from a client' },
  update_deal_stage: { fr: 'changer un deal d’étape', en: 'move a deal to another stage' },
  delete_deal: { fr: 'abandonner un deal', en: 'abandon a deal' },
  create_deal: { fr: 'créer un deal', en: 'create a deal' },
  update_deal: { fr: 'modifier un deal', en: 'update a deal' },
  set_quote_status: { fr: 'changer le statut d’un devis', en: 'change a quote status' },
  set_quote_discount_deposit: { fr: 'régler le rabais ou le dépôt d’un devis', en: 'set a quote discount or deposit' },
  set_client_consent: { fr: 'changer le consentement commercial d’un client', en: 'change a client’s marketing consent' },
  restore_archived: { fr: 'restaurer un élément archivé', en: 'restore an archived item' },
  update_time_entry: { fr: 'corriger une entrée de temps', en: 'correct a time entry' },
  delete_time_entry: { fr: 'supprimer une entrée de temps', en: 'delete a time entry' },
  force_punch_out: { fr: 'fermer le pointage d’un membre', en: 'close a member’s open shift' },
  approve_commission: { fr: 'approuver une commission', en: 'approve a commission' },
  mark_commission_paid: { fr: 'marquer une commission versée', en: 'mark a commission paid' },
  update_company_settings: { fr: 'modifier les informations de l’entreprise', en: 'update the company details' },
  create_automation_from_template: { fr: 'créer une automatisation à partir d’un modèle', en: 'create an automation from a template' },
  duplicate_automation_rule: { fr: 'dupliquer une automatisation', en: 'duplicate an automation' },
  rename_automation_rule: { fr: 'renommer une automatisation', en: 'rename an automation' },
  delete_automation_rule: { fr: 'mettre une automatisation à la corbeille', en: 'move an automation to the bin' },
  pause_all_automations: { fr: 'arrêter ou reprendre toutes les automatisations', en: 'stop or resume all automations' },

  // ── Devis ────────────────────────────────────────────────────────────────
  create_quote: { fr: 'créer une soumission', en: 'create a quote' },
  update_quote: { fr: 'modifier une soumission', en: 'update a quote' },
  duplicate_quote: { fr: 'dupliquer une soumission', en: 'duplicate a quote' },
  delete_quote: { fr: 'supprimer une soumission', en: 'delete a quote' },
  cancel_quote: { fr: 'marquer une soumission refusée ou archivée', en: 'mark a quote declined or archived' },
  unarchive_quote: { fr: 'sortir une soumission des archives', en: 'unarchive a quote' },
  send_quote: { fr: 'envoyer une soumission par courriel', en: 'email a quote' },
  send_quote_sms: { fr: 'envoyer une soumission par texto', en: 'text a quote' },
  convert_quote_to_job: { fr: 'convertir une soumission en job', en: 'convert a quote into a job' },
  convert_quote_to_invoice: { fr: 'convertir une soumission en facture', en: 'convert a quote into an invoice' },
  create_quote_preset: { fr: 'créer un préréglage de soumission', en: 'create a quote preset' },
  update_quote_preset: { fr: 'modifier un préréglage de soumission', en: 'update a quote preset' },
  delete_quote_preset: { fr: 'supprimer un préréglage de soumission', en: 'delete a quote preset' },
  duplicate_quote_preset: { fr: 'dupliquer un préréglage de soumission', en: 'duplicate a quote preset' },
  create_quote_template: { fr: 'créer un modèle de soumission', en: 'create a quote template' },
  update_quote_template: { fr: 'modifier un modèle de soumission', en: 'update a quote template' },
  delete_quote_template: { fr: 'supprimer un modèle de soumission', en: 'delete a quote template' },

  // ── Factures, paiements ──────────────────────────────────────────────────
  create_invoice: { fr: 'créer une facture', en: 'create an invoice' },
  create_invoice_from_job: { fr: 'facturer un job', en: 'invoice a job' },
  create_invoice_for_visit: { fr: 'facturer une visite', en: 'invoice a visit' },
  create_invoice_for_milestone: { fr: 'facturer un jalon', en: 'invoice a milestone' },
  update_invoice: { fr: 'modifier une facture', en: 'update an invoice' },
  duplicate_invoice: { fr: 'dupliquer une facture', en: 'duplicate an invoice' },
  delete_invoice: { fr: 'supprimer une facture', en: 'delete an invoice' },
  void_invoice: { fr: 'annuler une facture', en: 'void an invoice' },
  revert_invoice_to_draft: { fr: 'remettre une facture en brouillon', en: 'revert an invoice to draft' },
  send_invoice: { fr: 'envoyer une facture', en: 'send an invoice' },
  mark_invoice_paid: { fr: 'marquer une facture payée', en: 'mark an invoice paid' },
  record_invoice_payment: { fr: 'enregistrer un paiement partiel', en: 'record a partial payment' },
  send_payment_reminders: { fr: 'envoyer des relances de paiement', en: 'send payment reminders' },
  create_payment_request: { fr: 'créer un lien de paiement', en: 'create a payment link' },
  resend_payment_request: { fr: 'renvoyer un lien de paiement', en: 'resend a payment link' },
  refund_payment: { fr: 'rembourser un paiement', en: 'refund a payment' },
  charge_card_on_file: { fr: 'prélever la carte au dossier', en: 'charge the card on file' },
  remove_card_on_file: { fr: 'retirer la carte au dossier', en: 'remove the card on file' },
  create_recurring_invoice: { fr: 'créer une facture récurrente', en: 'create a recurring invoice' },
  update_recurring_invoice: { fr: 'modifier une facture récurrente', en: 'update a recurring invoice' },
  delete_recurring_invoice: { fr: 'arrêter une facture récurrente', en: 'stop a recurring invoice' },
  run_recurring_invoice_now: { fr: 'générer maintenant une facture récurrente', en: 'generate a recurring invoice now' },
  create_invoice_template: { fr: 'créer un modèle de facture', en: 'create an invoice template' },
  update_invoice_template: { fr: 'modifier un modèle de facture', en: 'update an invoice template' },
  delete_invoice_template: { fr: 'supprimer un modèle de facture', en: 'delete an invoice template' },
  update_reminder_settings: { fr: 'changer les relances automatiques', en: 'change the automatic reminders' },

  // ── Jobs, visites, calendrier ────────────────────────────────────────────
  create_job: { fr: 'créer un job', en: 'create a job' },
  update_job: { fr: 'modifier un job', en: 'update a job' },
  update_job_status: { fr: 'changer le statut d’un job', en: 'change a job’s status' },
  assign_job: { fr: 'assigner un job à une équipe', en: 'assign a job to a team' },
  archive_job: { fr: 'archiver ou désarchiver un job', en: 'archive or unarchive a job' },
  delete_job: { fr: 'supprimer un job', en: 'delete a job' },
  schedule_job: { fr: 'planifier un job', en: 'schedule a job' },
  unschedule_job: { fr: 'retirer un job du calendrier', en: 'take a job off the calendar' },
  reschedule_job: { fr: 'déplacer une visite', en: 'reschedule a visit' },
  add_visit: { fr: 'ajouter une visite', en: 'add a visit' },
  cancel_visit: { fr: 'annuler une visite', en: 'cancel a visit' },
  apply_day_optimization: { fr: 'réorganiser la journée', en: 'reorganize the day' },
  set_job_expenses: { fr: 'enregistrer une dépense sur un job', en: 'record a job expense' },
  create_recurrence_rule: { fr: 'rendre un job récurrent', en: 'make a job recurring' },
  deactivate_recurrence_rule: { fr: 'arrêter la récurrence d’un job', en: 'stop a job’s recurrence' },
  create_job_template: { fr: 'créer un modèle de job', en: 'create a job template' },
  create_job_checklist: { fr: 'ajouter une liste de vérification à un job', en: 'add a checklist to a job' },
  update_job_checklist: { fr: 'cocher une liste de vérification', en: 'fill in a checklist' },
  delete_job_checklist: { fr: 'retirer une liste de vérification d’un job', en: 'remove a checklist from a job' },
  create_checklist_template: { fr: 'créer un modèle de liste de vérification', en: 'create a checklist template' },
  update_checklist_template: { fr: 'modifier un modèle de liste de vérification', en: 'update a checklist template' },
  delete_checklist_template: { fr: 'supprimer un modèle de liste de vérification', en: 'delete a checklist template' },
  create_job_tag: { fr: 'créer une étiquette de job', en: 'create a job tag' },
  set_job_tags: { fr: 'remplacer les étiquettes d’un job', en: 'replace a job’s tags' },
  save_job_billing_milestones: { fr: 'définir les jalons de facturation d’un job', en: 'set a job’s billing milestones' },
  create_job_agreement: { fr: 'préparer un contrat', en: 'prepare a contract' },
  send_agreement_email: { fr: 'envoyer un contrat par courriel', en: 'email a contract' },
  send_agreement_sms: { fr: 'envoyer un contrat par texto', en: 'text a contract' },
  create_availability: { fr: 'ajouter une plage de disponibilité', en: 'add an availability window' },
  delete_availability: { fr: 'retirer une plage de disponibilité', en: 'remove an availability window' },
  set_default_availability: { fr: 'remettre les disponibilités par défaut', en: 'reset availability to the default' },

  // ── Tâches ───────────────────────────────────────────────────────────────
  create_task: { fr: 'créer une tâche', en: 'create a task' },
  update_task: { fr: 'modifier une tâche', en: 'update a task' },
  update_task_status: { fr: 'terminer ou rouvrir une tâche', en: 'complete or reopen a task' },
  delete_task: { fr: 'supprimer une tâche', en: 'delete a task' },
  reschedule_task: { fr: 'mettre une tâche au calendrier', en: 'put a task on the calendar' },
  duplicate_task: { fr: 'dupliquer une tâche', en: 'duplicate a task' },
  bulk_update_task_status: { fr: 'terminer ou rouvrir plusieurs tâches', en: 'complete or reopen several tasks' },
  bulk_delete_tasks: { fr: 'supprimer plusieurs tâches', en: 'delete several tasks' },

  // ── Équipe, accès, paie, heures ──────────────────────────────────────────
  invite_member: { fr: 'inviter un membre', en: 'invite a member' },
  resend_invitation: { fr: 'renvoyer une invitation', en: 'resend an invitation' },
  revoke_invitation: { fr: 'annuler une invitation', en: 'revoke an invitation' },
  update_member_role: { fr: 'changer le rôle d’un membre', en: 'change a member’s role' },
  remove_member: { fr: 'retirer un membre', en: 'remove a member' },
  reactivate_member: { fr: 'réactiver un membre', en: 'reactivate a member' },
  create_team: { fr: 'créer une équipe', en: 'create a team' },
  update_team: { fr: 'modifier une équipe', en: 'update a team' },
  delete_team: { fr: 'supprimer une équipe', en: 'delete a team' },
  set_hourly_rate: { fr: 'changer un taux horaire', en: 'change an hourly rate' },
  punch_in: { fr: 'pointer ton arrivée', en: 'clock you in' },
  punch_out: { fr: 'pointer ton départ', en: 'clock you out' },
  start_break: { fr: 'commencer ta pause', en: 'start your break' },
  end_break: { fr: 'terminer ta pause', en: 'end your break' },
  approve_timesheet: { fr: 'approuver des heures', en: 'approve time entries' },
  add_payroll_adjustment: { fr: 'ajouter un ajustement de paie', en: 'add a payroll adjustment' },
  mark_payroll_period_paid: { fr: 'marquer une paie payée', en: 'mark a pay period paid' },
  unmark_payroll_period_paid: { fr: 'annuler le paiement d’une paie', en: 'undo a pay period payment' },
  update_payroll_settings: { fr: 'changer le cycle de paie', en: 'change the pay cycle' },
  update_role_preset: { fr: 'changer les permissions d’un rôle', en: 'change a role’s permissions' },
  set_member_permissions: { fr: 'changer les permissions d’un membre', en: 'change a member’s permissions' },
  reset_member_permissions: { fr: 'remettre un membre sur les permissions de son rôle', en: 'reset a member to their role’s permissions' },

  // ── Messages, modèles de courriel ────────────────────────────────────────
  send_sms: { fr: 'envoyer un texto', en: 'send a text message' },
  send_email: { fr: 'envoyer un courriel', en: 'send an email' },
  mark_conversation_read: { fr: 'marquer une conversation lue', en: 'mark a conversation read' },
  create_email_template: { fr: 'créer un modèle de courriel', en: 'create an email template' },
  update_email_template: { fr: 'modifier un modèle de courriel', en: 'update an email template' },
  set_default_email_template: { fr: 'mettre un modèle de courriel par défaut', en: 'make an email template the default' },
  delete_email_template: { fr: 'supprimer un modèle de courriel', en: 'delete an email template' },
  duplicate_email_template: { fr: 'dupliquer un modèle de courriel', en: 'duplicate an email template' },

  // ── Automatisations ──────────────────────────────────────────────────────
  create_automation_from_text: { fr: 'créer une automatisation', en: 'create an automation' },
  toggle_automation_rule: { fr: 'activer ou mettre en pause une automatisation', en: 'turn an automation on or off' },
  update_automation_message: { fr: 'réécrire le message d’une automatisation', en: 'rewrite an automation’s message' },
  update_automation_sms_body: { fr: 'réécrire le texto d’une automatisation', en: 'rewrite an automation’s text message' },
  set_automation_language: { fr: 'changer la langue des messages automatiques', en: 'change the language of automatic messages' },

  // ── Taxes, catalogue, objectifs, rapports, notifications ────────────────
  setup_taxes: { fr: 'configurer les taxes', en: 'set up taxes' },
  create_tax_config: { fr: 'ajouter une taxe', en: 'add a tax' },
  update_tax_config: { fr: 'modifier une taxe', en: 'update a tax' },
  delete_tax_config: { fr: 'supprimer une taxe', en: 'delete a tax' },
  set_default_tax_group: { fr: 'changer le groupe de taxes par défaut', en: 'change the default tax group' },
  create_service: { fr: 'ajouter un service au catalogue', en: 'add a service to the catalog' },
  update_service: { fr: 'modifier un service du catalogue', en: 'update a catalog service' },
  archive_service: { fr: 'archiver un service du catalogue', en: 'archive a catalog service' },
  set_goal: { fr: 'fixer un objectif', en: 'set a goal' },
  delete_goal: { fr: 'supprimer un objectif', en: 'delete a goal' },
  create_scheduled_report: { fr: 'programmer un rapport par courriel', en: 'schedule an emailed report' },
  update_scheduled_report: { fr: 'modifier un rapport programmé', en: 'update a scheduled report' },
  delete_scheduled_report: { fr: 'supprimer un rapport programmé', en: 'delete a scheduled report' },
  send_scheduled_report_now: { fr: 'envoyer un rapport maintenant', en: 'send a report now' },
  mark_notifications_read: { fr: 'marquer des notifications lues', en: 'mark notifications read' },
  delete_notification: { fr: 'retirer une notification', en: 'dismiss a notification' },

  // ── Mémoire de Lumi ──────────────────────────────────────────────────────
  remember_this: { fr: 'retenir quelque chose', en: 'remember something' },
  forget_note: { fr: 'oublier une note', en: 'forget a note' },

  // ── Porte-à-porte, terrain ───────────────────────────────────────────────
  create_house: { fr: 'ajouter une maison sur la carte', en: 'add a house to the map' },
  update_house: { fr: 'modifier une maison', en: 'update a house' },
  log_house_event: { fr: 'noter le résultat d’une porte', en: 'log a door outcome' },
  create_territory: { fr: 'créer un territoire', en: 'create a territory' },
  update_territory: { fr: 'modifier un territoire', en: 'update a territory' },
  create_rep: { fr: 'inscrire un représentant terrain', en: 'register a field rep' },
  create_d2d_team: { fr: 'créer une équipe terrain', en: 'create a field team' },
  update_d2d_pipeline_item: { fr: 'déplacer une carte du pipeline terrain', en: 'move a field pipeline card' },
  update_d2d_settings: { fr: 'changer les réglages du porte-à-porte', en: 'change the door-to-door settings' },
  start_field_session: { fr: 'démarrer ta session terrain', en: 'start your field session' },
  end_field_session: { fr: 'terminer ta session terrain', en: 'end your field session' },
  pause_field_session: { fr: 'mettre ta session terrain en pause', en: 'pause your field session' },
  resume_field_session: { fr: 'reprendre ta session terrain', en: 'resume your field session' },
  create_badge: { fr: 'créer un badge', en: 'create a badge' },
  create_challenge: { fr: 'lancer un défi', en: 'launch a challenge' },
  create_battle: { fr: 'lancer une bataille entre deux représentants', en: 'start a battle between two reps' },

  // ── Formations ───────────────────────────────────────────────────────────
  create_course: { fr: 'créer une formation', en: 'create a course' },
  update_course: { fr: 'modifier une formation', en: 'update a course' },
  publish_course: { fr: 'publier ou dépublier une formation', en: 'publish or unpublish a course' },
  assign_course: { fr: 'assigner une formation', en: 'assign a course' },
  create_course_module: { fr: 'ajouter un module à une formation', en: 'add a module to a course' },
  create_course_lesson: { fr: 'ajouter une leçon à une formation', en: 'add a lesson to a course' },
  update_course_lesson: { fr: 'modifier une leçon', en: 'update a lesson' },
};

/**
 * Le verbe exact quand l'argument change le sens de l'action : « archiver » et
 * « désarchiver » ne peuvent pas partager un titre.
 */
export function verbeLumi(tool: string, args: Record<string, unknown> | null | undefined): VerbeLumi | null {
  const a = args ?? {};
  switch (tool) {
    case 'pause_all_automations':
      return a.paused === false ? { fr: 'reprendre toutes les automatisations', en: 'resume all automations' } : { fr: 'arrêter toutes les automatisations', en: 'stop all automations' };
    case 'set_quote_status':
      if (a.status === 'approved') return { fr: 'marquer un devis approuvé', en: 'mark a quote approved' };
      if (a.status === 'awaiting_response') return { fr: 'remettre un devis en attente de réponse', en: 'put a quote back to awaiting response' };
      return VERBES_LUMI[tool];
    case 'set_client_consent':
      if (a.granted === true) return { fr: 'enregistrer le consentement d’un client', en: 'record a client’s consent' };
      if (a.granted === false) return { fr: 'retirer le consentement d’un client', en: 'withdraw a client’s consent' };
      return VERBES_LUMI[tool];
    case 'archive_job':
      return a.restore === true ? { fr: 'désarchiver un job', en: 'unarchive a job' } : { fr: 'archiver un job', en: 'archive a job' };
    case 'toggle_automation_rule':
      if (a.is_active === true) return { fr: 'activer une automatisation', en: 'turn an automation on' };
      if (a.is_active === false) return { fr: 'mettre une automatisation en pause', en: 'pause an automation' };
      break;
    case 'update_task_status':
    case 'bulk_update_task_status': {
      const plusieurs = tool === 'bulk_update_task_status';
      if (a.status === 'done') return plusieurs ? { fr: 'terminer plusieurs tâches', en: 'complete several tasks' } : { fr: 'terminer une tâche', en: 'complete a task' };
      if (a.status === 'open') return plusieurs ? { fr: 'rouvrir plusieurs tâches', en: 'reopen several tasks' } : { fr: 'rouvrir une tâche', en: 'reopen a task' };
      break;
    }
    case 'cancel_quote':
      // Sans raison, l'outil archive (son défaut) : le titre le dit.
      return a.reason === 'declined' ? { fr: 'marquer une soumission refusée', en: 'mark a quote declined' } : { fr: 'archiver une soumission', en: 'archive a quote' };
    case 'publish_course':
      return a.publish === false ? { fr: 'dépublier une formation', en: 'unpublish a course' } : { fr: 'publier une formation', en: 'publish a course' };
    case 'update_job_status': {
      const s: Record<string, VerbeLumi> = {
        completed: { fr: 'marquer un job terminé', en: 'mark a job completed' },
        cancelled: { fr: 'annuler un job', en: 'cancel a job' },
        in_progress: { fr: 'marquer un job en cours', en: 'mark a job in progress' },
        scheduled: { fr: 'remettre un job à « planifié »', en: 'set a job back to scheduled' },
        draft: { fr: 'remettre un job en brouillon', en: 'set a job back to draft' },
      };
      if (typeof a.status === 'string' && s[a.status]) return s[a.status];
      break;
    }
    case 'refund_payment':
      return a.amount_cents == null ? { fr: 'rembourser un paiement au complet', en: 'refund a payment in full' } : { fr: 'rembourser une partie d’un paiement', en: 'partially refund a payment' };
    default:
  }
  return VERBES_LUMI[tool] ?? null;
}
