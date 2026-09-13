/**
 * Reçu d'exécution SANS modèle (item 5, étage 0 — F2 de COST_AUDIT.md).
 * ─────────────────────────────────────────────────────────────────
 * Après un clic Confirmer ou Annuler, l'orchestrateur rappelait le modèle
 * pour qu'il dise « c'est fait » : un appel complet (prompt + outils +
 * historique) pour une phrase. Ici la phrase est un gabarit à partir du
 * reçu (la fiche créée, l'erreur métier, l'annulation). Le modèle n'est
 * rappelé que si l'utilisateur écrit ensuite — et il lit alors ce gabarit
 * comme sa propre réponse.
 *
 * Vocabulaire : celui de l'affichage (« Devis Q-0043 », « Tâche « X » »),
 * jamais un nom d'outil ni un statut brut.
 */
import type { ReçuExecution } from './execution';
import { fmtDollars } from './raccourcis';

export interface LigneRecu {
  recu: ReçuExecution;
  /** Erreur métier renvoyée par l'outil (contenu du tool_result), sinon null. */
  erreur: string | null;
  outil: string;
}

const NOMS_ACTION_FR: Record<string, string> = {
  create_job: 'la job', create_task: 'la tâche', create_client: 'la fiche client', create_quote: 'le devis', create_invoice: 'la facture',
  create_invoice_from_job: 'la facture', send_quote: 'l’envoi du devis', send_invoice: 'l’envoi de la facture', send_sms: 'le texto', send_email: 'le courriel',
  send_payment_reminders: 'les relances', mark_invoice_paid: 'le paiement', update_job_status: 'le statut de la job', assign_job: 'l’assignation',
  reschedule_job: 'le déplacement de la visite', cancel_visit: 'l’annulation de la visite', add_visit: 'la visite', merge_clients: 'la fusion',
  update_client: 'la fiche client', update_job: 'la job', update_task: 'la tâche', update_task_status: 'le statut de la tâche', delete_task: 'la suppression de la tâche',
  archive_job: 'l’archivage', cancel_quote: 'l’annulation du devis', convert_quote_to_job: 'la conversion du devis en job', convert_lead_to_client: 'la conversion du prospect',
  add_note: 'la note', set_job_expenses: 'les dépenses', remember_this: 'la note en mémoire', forget_note: 'l’oubli',
};
const NOMS_ACTION_EN: Record<string, string> = {
  create_job: 'the job', create_task: 'the task', create_client: 'the client', create_quote: 'the quote', create_invoice: 'the invoice',
  create_invoice_from_job: 'the invoice', send_quote: 'sending the quote', send_invoice: 'sending the invoice', send_sms: 'the text', send_email: 'the email',
  send_payment_reminders: 'the reminders', mark_invoice_paid: 'the payment', update_job_status: 'the job status', assign_job: 'the assignment',
  reschedule_job: 'moving the visit', cancel_visit: 'cancelling the visit', add_visit: 'the visit', merge_clients: 'the merge',
  update_client: 'the client', update_job: 'the job', update_task: 'the task', update_task_status: 'the task status', delete_task: 'deleting the task',
  archive_job: 'archiving', cancel_quote: 'cancelling the quote', convert_quote_to_job: 'converting the quote', convert_lead_to_client: 'converting the lead',
  add_note: 'the note', set_job_expenses: 'the expenses', remember_this: 'the note', forget_note: 'forgetting it',
};

function nomAction(outil: string, fr: boolean): string {
  return (fr ? NOMS_ACTION_FR : NOMS_ACTION_EN)[outil] ?? (fr ? 'l’action' : 'the action');
}

/** Le texte du reçu, une phrase par action. Pur : testable sans base. */
export function texteRecus(lignes: LigneRecu[], decision: 'confirm' | 'cancel', fr: boolean): string {
  if (decision === 'cancel') return fr ? 'Annulé, rien n’a été fait.' : 'Cancelled, nothing was done.';
  const phrases = lignes.map(({ recu, erreur, outil }) => {
    if (recu.ok) {
      const quoi = recu.fiche?.label ? `${recu.fiche.label}` : nomAction(outil, fr);
      const montant = recu.fiche?.montant_cents !== undefined ? ` (${fmtDollars(recu.fiche.montant_cents, fr)})` : '';
      return fr ? `C’est fait : ${quoi}${montant}.` : `Done: ${quoi}${montant}.`;
    }
    const raison = erreur ? ` ${erreur.replace(/\s+$/, '')}` : '';
    return fr ? `${cap(nomAction(outil, fr))} n’a pas fonctionné.${raison}` : `${cap(nomAction(outil, fr))} did not go through.${raison}`;
  });
  return phrases.join('\n');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
