/**
 * QA — chaque outil de couverture (170) répond-il à une demande naturelle ?
 *
 *   PORT=3012 LUMI_ROUTEUR=actif LUMI_TOURS_PAR_HEURE=0 node --env-file=.env.local --import tsx server/index.ts
 *   node --env-file=.env.local --import tsx scripts/qa/evaluer-outils.mts [--api http://localhost:3012] [--seulement create_lead,void_invoice] [--sortie fichier.json]
 *
 * Pour chaque outil, une phrase comme un patron l'écrirait, dans une
 * conversation neuve. On note ce que Lumi a fait : l'outil attendu PROPOSÉ
 * (écriture) ou APPELÉ (lecture) = exact ; seulement une lecture voisine (la
 * donnée n'existe pas sur staging, Lumi a bien cherché) = partiel ; rien de
 * tout ça = raté. Le compte QA passe en mode « demander » le temps de la
 * batterie : AUCUNE écriture ne s'exécute, tout reste une carte. Coût ≈ 2 $.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { OUTILS_DOMAINES } from '../../server/lib/agent/outils-domaines';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const API = arg('--api', process.env.QA_API_URL || 'http://localhost:3012').replace(/\/$/, '');
const SEULEMENT = arg('--seulement', '') ? new Set(arg('--seulement', '').split(',')) : null;
const SORTIE = arg('--sortie', 'qa-outils.json');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

/** Une demande par outil. `voisins` : lectures acceptables si la donnée manque sur staging. */
const CAS: Array<{ outil: string; q: string; voisins?: string[] }> = [
  // ── Prospects, demandes, clients ──
  { outil: 'create_lead', q: 'Ajoute un prospect : Julie Fortin, 514-555-0199, intéressée par un lavage de vitres.' },
  { outil: 'update_lead', q: 'Corrige le courriel du prospect Julie Fortin : julie.fortin@exemple.ca', voisins: ['search_leads'] },
  { outil: 'update_lead_status', q: 'Mets le prospect Julie Fortin à l’étape « soumission envoyée ».', voisins: ['search_leads'] },
  { outil: 'delete_lead', q: 'Supprime le prospect Julie Fortin, c’était une erreur.', voisins: ['search_leads'] },
  { outil: 'convert_lead_to_job', q: 'Transforme le prospect Julie Fortin en job directement.', voisins: ['search_leads'] },
  { outil: 'process_request_submission', q: 'Traite la dernière demande reçue du formulaire : assigne-la à mon équipe pour demain 9 h.', voisins: ['list_request_submissions'] },
  { outil: 'delete_request_submission', q: 'Supprime la dernière demande reçue du formulaire, c’est un spam.', voisins: ['list_request_submissions'] },
  { outil: 'delete_client', q: 'Supprime le client Sophie Bouchard et tout son dossier.', voisins: ['search_clients'] },
  { outil: 'list_properties', q: 'Quelles adresses de service a Jean-Pierre Gagnon ?', voisins: ['search_clients', 'get_client_profile'] },
  { outil: 'create_property', q: 'Ajoute une deuxième adresse de service à Jean-Pierre Gagnon : « Chalet », 12 chemin du Lac, Magog.', voisins: ['search_clients'] },
  { outil: 'update_property', q: 'Mets l’adresse « Chalet » de Jean-Pierre Gagnon comme adresse principale.', voisins: ['search_clients', 'list_properties'] },
  { outil: 'delete_property', q: 'Enlève l’adresse « Chalet » de la fiche de Jean-Pierre Gagnon.', voisins: ['search_clients', 'list_properties'] },
  { outil: 'list_notes', q: 'Montre-moi les notes dans l’onglet Notes du client Jean-Pierre Gagnon.', voisins: ['search_clients', 'get_client_profile'] },
  { outil: 'update_note', q: 'Corrige la dernière note de Jean-Pierre Gagnon : remplace le texte par « Code de porte 1234 ».', voisins: ['search_clients', 'list_notes'] },
  { outil: 'delete_note', q: 'Efface la dernière note de l’onglet Notes de Jean-Pierre Gagnon.', voisins: ['search_clients', 'list_notes'] },
  { outil: 'list_custom_fields', q: 'C’est quoi mes champs personnalisés sur les clients ?' },
  { outil: 'set_custom_field', q: 'Mets le champ personnalisé « Référé par » à « Facebook » sur Jean-Pierre Gagnon.', voisins: ['list_custom_fields', 'search_clients'] },
  { outil: 'list_deals', q: 'Montre-moi mon pipeline de ventes, les cartes par étape.' },
  { outil: 'update_deal_stage', q: 'Déplace la carte de Jean-Pierre Gagnon dans le pipeline à l’étape « négociation ».', voisins: ['list_deals', 'search_clients'] },
  { outil: 'delete_deal', q: 'Retire la carte de Jean-Pierre Gagnon du pipeline.', voisins: ['list_deals'] },
  // ── Devis, factures, paiements ──
  { outil: 'update_quote', q: 'Change le titre de la dernière soumission de Jean-Pierre Gagnon pour « Lavage complet » et rends-la valide 45 jours.', voisins: ['list_quotes'] },
  { outil: 'duplicate_quote', q: 'Duplique la dernière soumission de Jean-Pierre Gagnon.', voisins: ['list_quotes'] },
  { outil: 'delete_quote', q: 'Supprime la dernière soumission brouillon.', voisins: ['list_quotes'] },
  { outil: 'unarchive_quote', q: 'Sors de l’archive la soumission archivée de Jean-Pierre Gagnon.', voisins: ['list_quotes'] },
  { outil: 'send_quote_sms', q: 'Envoie la dernière soumission de Jean-Pierre Gagnon par texto.', voisins: ['list_quotes'] },
  { outil: 'convert_quote_to_invoice', q: 'Transforme la dernière soumission approuvée en facture.', voisins: ['list_quotes'] },
  { outil: 'list_quote_presets', q: 'C’est quoi mes préréglages de soumission ?' },
  { outil: 'create_quote_preset', q: 'Crée un préréglage de soumission « Nettoyage printemps » avec lavage de vitres et nettoyage de gouttières.' },
  { outil: 'update_quote_preset', q: 'Renomme mon préréglage « Nettoyage printemps » en « Grand ménage du printemps ».', voisins: ['list_quote_presets'] },
  { outil: 'delete_quote_preset', q: 'Supprime le préréglage « Grand ménage du printemps ».', voisins: ['list_quote_presets'] },
  { outil: 'duplicate_quote_preset', q: 'Duplique mon préréglage de soumission « Nettoyage printemps ».', voisins: ['list_quote_presets'] },
  { outil: 'list_quote_templates', q: 'Montre-moi mes modèles de soumission avec les prix.' },
  { outil: 'create_quote_template', q: 'Crée un modèle de soumission « Vitres résidentiel » avec lavage de vitres à 150 $ et taxes.' },
  { outil: 'update_quote_template', q: 'Dans mon modèle « Vitres résidentiel », monte le lavage de vitres à 175 $.', voisins: ['list_quote_templates'] },
  { outil: 'delete_quote_template', q: 'Supprime le modèle de soumission « Vitres résidentiel ».', voisins: ['list_quote_templates'] },
  { outil: 'update_invoice', q: 'Sur la facture INV-000004, change l’objet pour « Nettoyage de gouttières » et l’échéance au 30 octobre.', voisins: ['list_invoices'] },
  { outil: 'void_invoice', q: 'Annule la facture INV-000015, elle est en double.', voisins: ['list_invoices'] },
  { outil: 'revert_invoice_to_draft', q: 'Remets la facture INV-000006 en brouillon pour la corriger.', voisins: ['list_invoices'] },
  { outil: 'duplicate_invoice', q: 'Duplique la facture INV-000004.', voisins: ['list_invoices'] },
  { outil: 'delete_invoice', q: 'Supprime la facture brouillon INV-000015.', voisins: ['list_invoices'] },
  { outil: 'record_invoice_payment', q: 'Enregistre un paiement partiel de 50 $ comptant sur la facture INV-000004.', voisins: ['list_invoices', 'get_overdue_payments'] },
  { outil: 'list_recurring_invoices', q: 'Quelles factures récurrentes j’ai en place ?' },
  { outil: 'create_recurring_invoice', q: 'Crée une facture récurrente mensuelle pour Jean-Pierre Gagnon : entretien mensuel 120 $, à partir du 1er octobre.', voisins: ['search_clients'] },
  { outil: 'update_recurring_invoice', q: 'Passe la facture récurrente de Jean-Pierre Gagnon en envoi automatique.', voisins: ['list_recurring_invoices'] },
  { outil: 'delete_recurring_invoice', q: 'Arrête la facture récurrente de Jean-Pierre Gagnon.', voisins: ['list_recurring_invoices'] },
  { outil: 'run_recurring_invoice_now', q: 'Génère tout de suite la facture récurrente de Jean-Pierre Gagnon.', voisins: ['list_recurring_invoices'] },
  { outil: 'list_invoice_templates', q: 'Montre-moi mes modèles de facture.' },
  { outil: 'create_invoice_template', q: 'Crée un modèle de facture « Entretien mensuel » avec une ligne entretien à 120 $ et paiement à 15 jours.' },
  { outil: 'update_invoice_template', q: 'Dans le modèle de facture « Entretien mensuel », mets le paiement à 30 jours.', voisins: ['list_invoice_templates'] },
  { outil: 'delete_invoice_template', q: 'Supprime le modèle de facture « Entretien mensuel ».', voisins: ['list_invoice_templates'] },
  { outil: 'create_payment_request', q: 'Envoie un lien de paiement en ligne à Jean-Pierre Gagnon pour la facture INV-000004.', voisins: ['list_invoices'] },
  { outil: 'resend_payment_request', q: 'Renvoie le lien de paiement de la facture INV-000004 par texto.', voisins: ['list_invoices'] },
  { outil: 'refund_payment', q: 'Rembourse le dernier paiement par carte de Sophie Bouchard.', voisins: ['list_payments'] },
  { outil: 'charge_card_on_file', q: 'Charge la carte enregistrée de Jean-Pierre Gagnon pour le solde de la facture INV-000004.', voisins: ['list_invoices'] },
  { outil: 'remove_card_on_file', q: 'Retire la carte enregistrée de Jean-Pierre Gagnon.', voisins: ['search_clients'] },
  { outil: 'update_reminder_settings', q: 'Change mes relances de paiement automatiques : à 3, 10 et 20 jours après l’échéance.' },
  { outil: 'list_payments', q: 'Montre-moi les paiements reçus ce mois-ci.' },
  // ── Jobs, calendrier ──
  { outil: 'delete_job', q: 'Supprime le job 34, c’était un test.', voisins: ['list_jobs'] },
  { outil: 'list_recurrence_rules', q: 'Quels jobs sont récurrents chez moi ?' },
  { outil: 'create_recurrence_rule', q: 'Rends le job 33 récurrent toutes les deux semaines à partir de lundi prochain.', voisins: ['list_jobs'] },
  { outil: 'deactivate_recurrence_rule', q: 'Arrête la récurrence du job 33.', voisins: ['list_recurrence_rules'] },
  { outil: 'create_job_template', q: 'Sauvegarde un modèle de job « Lavage de vitres standard » avec la ligne lavage de vitres 150 $.' },
  { outil: 'schedule_job', q: 'Mets le job 34 au calendrier jeudi prochain à 13 h.', voisins: ['list_jobs'] },
  { outil: 'unschedule_job', q: 'Retire le job 33 du calendrier, on ne sait pas encore quand.', voisins: ['list_jobs'] },
  { outil: 'list_job_checklists', q: 'C’est quoi la liste de vérification du job 33 ?', voisins: ['list_jobs'] },
  { outil: 'create_job_checklist', q: 'Ajoute une liste de vérification au job 33 : photos avant, photos après, clés remises.', voisins: ['list_jobs'] },
  { outil: 'update_job_checklist', q: 'Coche « photos avant » dans la liste de vérification du job 33.', voisins: ['list_job_checklists'] },
  { outil: 'delete_job_checklist', q: 'Enlève la liste de vérification du job 33.', voisins: ['list_job_checklists'] },
  { outil: 'list_checklist_templates', q: 'Quels modèles de listes de vérification j’ai ?' },
  { outil: 'create_checklist_template', q: 'Crée un modèle de liste de vérification « Fin de chantier » : ramasser les outils, photos, signature du client.' },
  { outil: 'update_checklist_template', q: 'Ajoute « vérifier les fenêtres » au modèle « Fin de chantier ».', voisins: ['list_checklist_templates'] },
  { outil: 'delete_checklist_template', q: 'Supprime le modèle de liste « Fin de chantier ».', voisins: ['list_checklist_templates'] },
  { outil: 'list_job_tags', q: 'Quelles étiquettes de job j’ai ?' },
  { outil: 'create_job_tag', q: 'Crée une étiquette de job « Urgent » en rouge.' },
  { outil: 'set_job_tags', q: 'Mets l’étiquette « Urgent » sur le job 33.', voisins: ['list_job_tags', 'list_jobs'] },
  { outil: 'save_job_billing_milestones', q: 'Pour le job 33, facture en deux jalons : 30 % de dépôt et le reste à la fin.', voisins: ['list_jobs'] },
  { outil: 'create_invoice_for_visit', q: 'Facture la visite d’hier du job 33 seulement.', voisins: ['list_jobs', 'get_job'] },
  { outil: 'create_invoice_for_milestone', q: 'Facture le dépôt du job 33.', voisins: ['list_jobs', 'get_job'] },
  { outil: 'list_job_agreements', q: 'Est-ce qu’il y a un contrat sur le job 33 ?', voisins: ['list_jobs'] },
  { outil: 'create_job_agreement', q: 'Prépare un contrat pour le job 33.', voisins: ['list_jobs'] },
  { outil: 'send_agreement_email', q: 'Envoie le contrat du job 33 au client par courriel pour signature.', voisins: ['list_job_agreements'] },
  { outil: 'send_agreement_sms', q: 'Texte le contrat du job 33 au client pour qu’il le signe.', voisins: ['list_job_agreements'] },
  { outil: 'list_availability', q: 'Quelles sont les disponibilités hebdomadaires de mes équipes ?' },
  { outil: 'create_availability', q: 'Ajoute une plage de disponibilité le samedi de 8 h à 12 h pour mon équipe principale.', voisins: ['list_teams', 'list_availability'] },
  { outil: 'delete_availability', q: 'Enlève la plage du samedi matin de mon équipe principale.', voisins: ['list_availability'] },
  { outil: 'set_default_availability', q: 'Remets les disponibilités de mon équipe principale au lundi-vendredi 8 h à 17 h.', voisins: ['list_teams'] },
  { outil: 'reschedule_task', q: 'Mets la tâche « Rappeler Marie Tremblay » vendredi à 14 h.', voisins: ['list_tasks'] },
  { outil: 'duplicate_task', q: 'Duplique la tâche « Rappeler Marie Tremblay ».', voisins: ['list_tasks'] },
  { outil: 'bulk_update_task_status', q: 'Marque toutes mes tâches en cours comme terminées.', voisins: ['list_tasks'] },
  { outil: 'bulk_delete_tasks', q: 'Supprime toutes les tâches qui contiennent « eval lumi ».', voisins: ['list_tasks'] },
  // ── Équipe, heures, paie ──
  { outil: 'list_teams', q: 'Quelles équipes (crews) j’ai ?' },
  { outil: 'list_invitations', q: 'Quelles invitations d’équipe sont encore en attente ?' },
  { outil: 'invite_member', q: 'Invite marc.tremblay@exemple.ca comme technicien.' },
  { outil: 'resend_invitation', q: 'Renvoie l’invitation à marc.tremblay@exemple.ca.', voisins: ['list_invitations'] },
  { outil: 'revoke_invitation', q: 'Annule l’invitation envoyée à marc.tremblay@exemple.ca.', voisins: ['list_invitations'] },
  { outil: 'update_member_role', q: 'Passe le premier technicien de mon équipe au rôle admin.', voisins: ['get_team'] },
  { outil: 'remove_member', q: 'Suspends l’accès du premier technicien de mon équipe.', voisins: ['get_team'] },
  { outil: 'reactivate_member', q: 'Réactive l’accès du membre suspendu.', voisins: ['get_team'] },
  { outil: 'create_team', q: 'Crée une équipe « Équipe Nord ».' },
  { outil: 'update_team', q: 'Renomme l’équipe « Équipe Nord » en « Équipe Rive-Nord ».', voisins: ['list_teams'] },
  { outil: 'delete_team', q: 'Supprime l’équipe « Équipe Rive-Nord ».', voisins: ['list_teams'] },
  { outil: 'set_hourly_rate', q: 'Mets le taux horaire du premier technicien à 24 $.', voisins: ['get_team'] },
  { outil: 'punch_in', q: 'Pointe-moi, je commence ma journée.' },
  { outil: 'start_break', q: 'Je pars en pause.' },
  { outil: 'end_break', q: 'Je reviens de pause.' },
  { outil: 'punch_out', q: 'Pointe-moi dehors, j’ai fini.' },
  { outil: 'approve_timesheet', q: 'Approuve les heures de la semaine passée du premier technicien.', voisins: ['get_team', 'get_timesheets'] },
  { outil: 'add_payroll_adjustment', q: 'Ajoute un bonus de 100 $ sur la paie du premier technicien.', voisins: ['get_team'] },
  { outil: 'mark_payroll_period_paid', q: 'Marque la paie de cette période comme payée pour le premier technicien.', voisins: ['get_team', 'get_payroll_summary'] },
  { outil: 'unmark_payroll_period_paid', q: 'Annule le « payé » sur la paie de cette période du premier technicien.', voisins: ['get_team', 'get_payroll_summary'] },
  { outil: 'update_payroll_settings', q: 'Passe mes périodes de paie aux deux semaines.' },
  { outil: 'update_role_preset', q: 'Permets aux techniciens de voir les prix des soumissions.' },
  { outil: 'set_member_permissions', q: 'Donne au premier technicien le droit de voir les rapports financiers, juste à lui.', voisins: ['get_team'] },
  { outil: 'reset_member_permissions', q: 'Remets les permissions du premier technicien à celles de son rôle.', voisins: ['get_team'] },
  // ── Messages, automatisations, réglages ──
  { outil: 'mark_conversation_read', q: 'Marque la conversation texto avec Jean-Pierre Gagnon comme lue.', voisins: ['get_conversations'] },
  { outil: 'list_email_templates', q: 'Quels modèles de courriel j’ai ?' },
  { outil: 'create_email_template', q: 'Crée un modèle de courriel « Merci » pour après un job : objet « Merci pour votre confiance », corps « Merci d’avoir choisi {{company}} ! ».' },
  { outil: 'update_email_template', q: 'Dans le modèle de courriel « Merci », change l’objet pour « Un gros merci ! ».', voisins: ['list_email_templates'] },
  { outil: 'set_default_email_template', q: 'Mets le modèle « Merci » comme modèle par défaut pour son type.', voisins: ['list_email_templates'] },
  { outil: 'delete_email_template', q: 'Supprime le modèle de courriel « Merci ».', voisins: ['list_email_templates'] },
  { outil: 'duplicate_email_template', q: 'Duplique le modèle de courriel « Merci ».', voisins: ['list_email_templates'] },
  { outil: 'toggle_automation_rule', q: 'Mets en pause la relance de facture à 30 jours.', voisins: ['list_automations'] },
  { outil: 'update_automation_message', q: 'Change le texte de la relance de facture à 7 jours : « Petit rappel, votre facture est due. Merci ! »', voisins: ['list_automations'] },
  { outil: 'update_automation_sms_body', q: 'Change juste le texto de la relance à 14 jours pour « Rappel amical : facture due. »', voisins: ['list_automations'] },
  { outil: 'set_automation_language', q: 'Envoie mes automatisations en anglais à partir de maintenant.' },
  { outil: 'get_tax_config', q: 'C’est quoi mes taxes configurées ?' },
  { outil: 'setup_taxes', q: 'Configure mes taxes pour le Québec, TPS et TVQ.' },
  { outil: 'create_tax_config', q: 'Ajoute une taxe personnalisée « Écofrais » à 2 %.' },
  { outil: 'update_tax_config', q: 'Mets mon numéro de TVQ 1234567890TQ0001 sur la taxe TVQ.', voisins: ['get_tax_config'] },
  { outil: 'delete_tax_config', q: 'Retire la taxe « Écofrais ».', voisins: ['get_tax_config'] },
  { outil: 'set_default_tax_group', q: 'Mets le groupe de taxes du Québec par défaut.', voisins: ['get_tax_config'] },
  { outil: 'create_service', q: 'Ajoute au catalogue « Nettoyage de gouttières » à 200 $.', voisins: ['list_services'] },
  { outil: 'update_service', q: 'Monte le prix du lavage de vitres du catalogue à 175 $.', voisins: ['list_services'] },
  { outil: 'archive_service', q: 'Archive le service « Plantation de fleurs annuelles » du catalogue.', voisins: ['list_services'] },
  { outil: 'list_goals', q: 'C’est quoi mes objectifs d’affaires ?' },
  { outil: 'set_goal', q: 'Fixe-moi un objectif de 50 000 $ de revenus pour octobre.' },
  { outil: 'delete_goal', q: 'Supprime mon objectif de revenus d’octobre.', voisins: ['list_goals'] },
  { outil: 'list_scheduled_reports', q: 'Quels rapports automatiques sont envoyés par courriel ?' },
  { outil: 'create_scheduled_report', q: 'Envoie-moi un rapport chaque lundi matin à will@exemple.ca.' },
  { outil: 'update_scheduled_report', q: 'Passe mon rapport automatique à une fois par mois.', voisins: ['list_scheduled_reports'] },
  { outil: 'delete_scheduled_report', q: 'Arrête mon rapport automatique par courriel.', voisins: ['list_scheduled_reports'] },
  { outil: 'send_scheduled_report_now', q: 'Envoie mon rapport automatique tout de suite.', voisins: ['list_scheduled_reports'] },
  { outil: 'list_notifications', q: 'J’ai tu des notifications ?' },
  { outil: 'mark_notifications_read', q: 'Marque toutes mes notifications comme lues.' },
  { outil: 'delete_notification', q: 'Enlève la dernière notification de la cloche.', voisins: ['list_notifications'] },
  // ── Porte-à-porte, formations ──
  { outil: 'list_houses', q: 'Montre-moi les maisons cognées cette semaine en porte-à-porte.' },
  { outil: 'list_territories', q: 'Quels territoires de porte-à-porte j’ai ?' },
  { outil: 'create_house', q: 'Ajoute une maison en porte-à-porte : 123 rue Principale, Longueuil, latitude 45.53, longitude -73.52.' },
  { outil: 'update_house', q: 'Mets la maison du 123 rue Principale comme « intéressée ».', voisins: ['list_houses'] },
  { outil: 'log_house_event', q: 'Note que j’ai cogné au 123 rue Principale et qu’il n’y avait personne.', voisins: ['list_houses'] },
  { outil: 'create_territory', q: 'Crée un territoire « Vieux-Longueuil » avec les points -73.52,45.53 ; -73.51,45.53 ; -73.51,45.54.' },
  { outil: 'update_territory', q: 'Assigne le territoire « Vieux-Longueuil » au premier représentant.', voisins: ['list_territories'] },
  { outil: 'create_rep', q: 'Enregistre le premier technicien comme représentant porte-à-porte.', voisins: ['get_team'] },
  { outil: 'create_d2d_team', q: 'Crée une équipe terrain « Les Cogneurs » en bleu.' },
  { outil: 'update_d2d_pipeline_item', q: 'Passe la maison du 123 rue Principale à « soumission envoyée » dans le pipeline terrain.', voisins: ['list_houses'] },
  { outil: 'update_d2d_settings', q: 'Active la restriction par territoire en porte-à-porte.' },
  { outil: 'start_field_session', q: 'Démarre ma session terrain, je suis à 45.53, -73.52.' },
  { outil: 'pause_field_session', q: 'Mets ma session terrain en pause.' },
  { outil: 'resume_field_session', q: 'Reprends ma session terrain.' },
  { outil: 'end_field_session', q: 'Termine ma session terrain, je suis à 45.53, -73.52.' },
  { outil: 'create_badge', q: 'Crée un badge « 100 portes » pour les représentants.' },
  { outil: 'create_challenge', q: 'Lance un défi hebdomadaire de portes cognées du 22 au 28 septembre.' },
  { outil: 'create_battle', q: 'Organise une bataille entre moi et le premier technicien sur les ventes, du 22 au 28 septembre.', voisins: ['get_team'] },
  { outil: 'create_course', q: 'Crée une formation « Accueil du client ».' },
  { outil: 'update_course', q: 'Ajoute une description à la formation « Accueil du client » : « Les bases du premier contact ».', voisins: ['list_courses'] },
  { outil: 'publish_course', q: 'Publie la formation « Accueil du client ».', voisins: ['list_courses'] },
  { outil: 'assign_course', q: 'Assigne la formation « Accueil du client » à toute l’équipe.', voisins: ['list_courses', 'get_team'] },
  { outil: 'create_course_module', q: 'Ajoute un module « Se présenter » à la formation « Accueil du client ».', voisins: ['list_courses'] },
  { outil: 'create_course_lesson', q: 'Ajoute une leçon texte « Le sourire » au module « Se présenter » de la formation « Accueil du client ».', voisins: ['list_courses'] },
  { outil: 'update_course_lesson', q: 'Renomme la leçon « Le sourire » en « Le premier sourire ».', voisins: ['list_courses'] },
];

interface Resultat { outil: string; question: string; verdict: 'exact' | 'partiel' | 'rate' | 'erreur'; proposition: string | null; outils: string[]; cout_cents: number; duree_ms: number; reponse: string; erreur?: string }

async function session(email: string) {
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await anon().auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
  const { data: m } = await admin.from('memberships').select('org_id, lumi_mode').eq('user_id', s.session.user.id).eq('status', 'active').limit(1).maybeSingle();
  if (!m) throw new Error('aucune org');
  return { access_token: s.session.access_token, userId: s.session.user.id, orgId: m.org_id as string, mode: (m as any).lumi_mode as string | null };
}

async function demander(H: Record<string, string>, message: string): Promise<Omit<Resultat, 'outil' | 'question' | 'verdict'>> {
  const debut = Date.now();
  const res = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ conversation_id: null, message, language: 'fr' }) });
  const brut = await res.text();
  const r = { proposition: null as string | null, outils: [] as string[], cout_cents: 0, duree_ms: 0, reponse: '', erreur: undefined as string | undefined };
  if (!res.ok) { r.erreur = `${res.status} ${brut.slice(0, 160)}`; r.duree_ms = Date.now() - debut; return r; }
  for (const ev of brut.split('\n\n')) {
    const t = /event: (\w+)/.exec(ev)?.[1]; const d = /data: (.*)/.exec(ev)?.[1]; if (!t || !d) continue;
    let j: any; try { j = JSON.parse(d); } catch { continue; }
    if (t === 'text') r.reponse += j.delta;
    else if (t === 'tool' && j.statut === 'debut') r.outils.push(j.name);
    else if (t === 'proposal') { r.proposition = j.tool; for (const g of j.groupe ?? []) if (g.tool && !r.outils.includes(g.tool)) r.outils.push(`groupe:${g.tool}`); }
    else if (t === 'done') r.cout_cents = j.cost_cents ?? 0;
    else if (t === 'error') r.erreur = j.message;
  }
  r.duree_ms = Date.now() - debut;
  return r;
}

(async () => {
  const connus = new Set(OUTILS_DOMAINES.map((t) => t.declaration.name));
  const inconnus = CAS.filter((c) => !connus.has(c.outil)).map((c) => c.outil);
  const sansCas = [...connus].filter((n) => !CAS.some((c) => c.outil === n));
  if (inconnus.length) throw new Error(`cas sur des outils inconnus : ${inconnus.join(', ')}`);
  if (sansCas.length) console.log(`⚠ outils sans cas : ${sansCas.join(', ')}`);
  const s = await session(COMPTE);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, 'x-org-id': s.orgId };
  // Mode « demander » le temps de la batterie : aucune écriture ne s'exécute.
  await admin.from('memberships').update({ lumi_mode: 'demander' }).eq('user_id', s.userId).eq('org_id', s.orgId);
  const resultats: Resultat[] = [];
  try {
    for (const c of CAS) {
      if (SEULEMENT && !SEULEMENT.has(c.outil)) continue;
      const r = await demander(H, c.q);
      const propose = r.proposition === c.outil || r.outils.includes(`groupe:${c.outil}`);
      const appele = r.outils.includes(c.outil);
      const voisin = (c.voisins ?? []).some((v) => r.outils.includes(v));
      const verdict: Resultat['verdict'] = r.erreur ? 'erreur' : (propose || appele) ? 'exact' : voisin ? 'partiel' : 'rate';
      resultats.push({ outil: c.outil, question: c.q, verdict, ...r });
      const ico = verdict === 'exact' ? 'OK   ' : verdict === 'partiel' ? 'PART ' : verdict === 'erreur' ? 'ERR  ' : 'RATE ';
      console.log(`${ico} ${c.outil.padEnd(30)} ${(r.proposition ? 'propose ' + r.proposition : r.outils.length ? 'lit ' + r.outils.join(',') : 'rien').padEnd(52)} ${r.cout_cents.toFixed(2)} ¢${r.erreur ? ' ' + r.erreur : ''}`);
    }
  } finally {
    await admin.from('memberships').update({ lumi_mode: s.mode }).eq('user_id', s.userId).eq('org_id', s.orgId);
  }
  const n = (v: Resultat['verdict']) => resultats.filter((r) => r.verdict === v).length;
  const cout = resultats.reduce((a, r) => a + r.cout_cents, 0);
  const bilan = { total: resultats.length, exact: n('exact'), partiel: n('partiel'), rate: n('rate'), erreur: n('erreur'), cout_cents: Math.round(cout * 100) / 100, cout_moyen_cents: resultats.length ? Math.round((cout / resultats.length) * 100) / 100 : 0 };
  console.log(`\nTOTAL ${bilan.exact} exact · ${bilan.partiel} partiel · ${bilan.rate} raté · ${bilan.erreur} erreur / ${bilan.total} · ${(cout / 100).toFixed(2)} $ (${bilan.cout_moyen_cents} ¢ par demande)`);
  const rates = resultats.filter((r) => r.verdict === 'rate' || r.verdict === 'erreur');
  if (rates.length) console.log('\nRatés :\n' + rates.map((r) => `  ${r.outil} — ${r.proposition ? 'a proposé ' + r.proposition : r.outils.length ? 'a lu ' + r.outils.join(',') : 'rien'} — ${r.reponse.slice(0, 120).replace(/\n/g, ' ')}`).join('\n'));
  writeFileSync(SORTIE, JSON.stringify({ date: new Date().toISOString(), api: API, bilan, resultats }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
