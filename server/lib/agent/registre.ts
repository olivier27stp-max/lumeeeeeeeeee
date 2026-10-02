/**
 * Registre des ÉCRITURES de l'agent — une seule source d'attributs (item 4, B2).
 * ─────────────────────────────────────────────────────────────────
 * Avant : « sensible » vivait dans execution.ts (ECRITURES_SENSIBLES),
 * « anodine » dans orchestrateur.ts (ECRITURES_ANODINES), « réversible »
 * nulle part. Trois listes pour dire une chose : ce qu'une écriture engage.
 *
 * - sensible   : de l'argent, un envoi au client ou un geste irréversible →
 *                carte même en mode « argent » (execution.ts).
 * - anodine    : ne touche que la mémoire de Lumi → jamais de carte.
 * - reversible : on peut défaire dans l'application (archiver, replanifier)
 *                — un envoi, un paiement enregistré, une fusion ne se
 *                défont pas. Sert aux gabarits et à l'escalade.
 * - vers_client: l'effet atteint le client (texto, courriel, document).
 *
 * Le test tests/lumi-registre.test.ts vérifie que chaque outil d'écriture
 * de TOOLS_BY_NAME a une entrée ici, et rien d'autre.
 */
import { REGISTRE_DOMAINES } from './outils-domaines';

export interface AttributsEcriture {
  sensible: boolean;
  anodine: boolean;
  reversible: boolean;
  vers_client: boolean;
}

const S = (a: Partial<AttributsEcriture>): AttributsEcriture => ({ sensible: false, anodine: false, reversible: true, vers_client: false, ...a });

export const REGISTRE_ECRITURES: Readonly<Record<string, AttributsEcriture>> = {
  // Clients
  create_client:            S({}),
  update_client:            S({}),
  convert_lead_to_client:   S({}),
  merge_clients:            S({ sensible: true, reversible: false }),
  add_note:                 S({}),
  // Jobs et horaire
  create_job:               S({}),
  update_job:               S({}),
  update_job_status:        S({}),                    // devient sensible si une automatisation parle au client (execution.ts)
  assign_job:               S({}),
  archive_job:              S({ sensible: true }),
  set_job_expenses:         S({}),
  add_visit:                S({}),
  apply_day_optimization:   S({ sensible: true }),               // replanifie plusieurs rendez-vous clients d'un coup (audit Agenda 2026-09-30)
  reschedule_job:           S({ sensible: true }),               // touche un rendez-vous convenu avec le client (audit 2026-09-16)
  cancel_visit:             S({ sensible: true, reversible: false }),
  // Devis
  create_quote:             S({ sensible: true }),
  send_quote:               S({ sensible: true, reversible: false, vers_client: true }),
  cancel_quote:             S({ sensible: true, reversible: false }),
  convert_quote_to_job:     S({ sensible: true }),
  // Factures et paiements
  create_invoice:           S({ sensible: true }),
  create_invoice_from_job:  S({ sensible: true }),
  send_invoice:             S({ sensible: true, reversible: false, vers_client: true }),
  mark_invoice_paid:        S({ sensible: true, reversible: false }),
  send_payment_reminders:   S({ sensible: true, reversible: false, vers_client: true }),
  // Messages
  send_sms:                 S({ sensible: true, reversible: false, vers_client: true }),
  send_email:               S({ sensible: true, reversible: false, vers_client: true }),
  // Tâches
  create_task:              S({}),
  update_task:              S({}),
  update_task_status:       S({}),
  delete_task:              S({}),                    // soft delete (deleted_at)
  // Mémoire de Lumi
  remember_this:            S({ anodine: true }),
  forget_note:              S({ anodine: true }),
  // Domaines (tools-leads, tools-argent, tools-terrain, tools-equipe, tools-reglages, tools-d2d-formations).
  ...Object.fromEntries(Object.entries(REGISTRE_DOMAINES).map(([n, a]) => [n, S(a)])),
};

export function attributsEcriture(outil: string): AttributsEcriture | null {
  return REGISTRE_ECRITURES[outil] ?? null;
}

/**
 * Écritures qui ne partent JAMAIS sans carte (audit 2026-09-30), quels que
 * soient le mode (« argent », « tout ») et les « toujours confirmer » : ce qui
 * atteint le client, ce qui ne se défait pas, l'argent et les droits d'accès.
 * Un clic de trop coûte une seconde ; l'inverse coûte un remboursement, un
 * texto envoyé ou un accès donné par erreur.
 */
const ARGENT_ET_DROITS = [
  'refund_payment', 'charge_card_on_file', 'mark_invoice_paid', 'record_invoice_payment', 'void_invoice', 'delete_invoice',
  'create_payment_request', 'resend_payment_request', 'remove_card_on_file', 'run_recurring_invoice_now',
  'set_hourly_rate', 'add_payroll_adjustment', 'mark_payroll_period_paid', 'unmark_payroll_period_paid', 'approve_timesheet',
  'update_member_role', 'set_member_permissions', 'reset_member_permissions', 'update_role_preset',
  'invite_member', 'remove_member', 'reactivate_member', 'revoke_invitation', 'resend_invitation',
  'create_scheduled_report', 'update_scheduled_report', 'send_scheduled_report_now',
  // Ce qui PARLERA au client plus tard, sans autre confirmation : modèles de
  // courriel, textes et interrupteurs des automatisations, conditions d'un contrat.
  'create_email_template', 'update_email_template', 'set_default_email_template',
  'create_automation_from_text', 'toggle_automation_rule', 'update_automation_message', 'update_automation_sms_body',
  'create_job_agreement',
  // Lots du 2026-10-01. La paie et les commissions (argent d'un employé), le consentement (preuve
  // légale), le statut d'un devis dit au nom du client, et tout ce qui fait partir ou repartir
  // des messages d'automatisation plus tard.
  'update_time_entry', 'mark_commission_paid', 'approve_commission',
  'set_client_consent', 'set_quote_status', 'set_quote_discount_deposit',
  'pause_all_automations', 'create_automation_from_template', 'delete_automation_rule',
  // Mission finale (2026-10-02). Modifier une automatisation PUBLIÉE change ce que ses clients
  // recevront dès le prochain envoi ; changer la langue des messages aussi. « Sensible » ne
  // suffisait pas : en mode « tout », ces deux outils s'exécutaient sans carte.
  'update_automation_from_text', 'set_automation_language',
];
export const JAMAIS_D_OFFICE: ReadonlySet<string> = new Set([
  ...Object.entries(REGISTRE_ECRITURES).filter(([, a]) => a.vers_client || !a.reversible).map(([n]) => n),
  ...ARGENT_ET_DROITS.filter((n) => n in REGISTRE_ECRITURES),
]);

/** Ce que la carte doit dire en plus de l'aperçu : irréversible, part chez le client, jamais d'office. */
export function drapeauxEcriture(outil: string): { irreversible: boolean; vers_client: boolean; jamais_d_office: boolean } {
  const a = REGISTRE_ECRITURES[outil];
  return { irreversible: a ? !a.reversible : false, vers_client: a?.vers_client ?? false, jamais_d_office: JAMAIS_D_OFFICE.has(outil) };
}

/** Listes dérivées — gardées pour les appelants existants. */
export const ECRITURES_SENSIBLES: ReadonlySet<string> = new Set(Object.entries(REGISTRE_ECRITURES).filter(([, a]) => a.sensible).map(([n]) => n));
export const ECRITURES_ANODINES: ReadonlySet<string> = new Set(Object.entries(REGISTRE_ECRITURES).filter(([, a]) => a.anodine).map(([n]) => n));
