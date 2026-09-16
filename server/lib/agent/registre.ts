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
};

export function attributsEcriture(outil: string): AttributsEcriture | null {
  return REGISTRE_ECRITURES[outil] ?? null;
}

/** Listes dérivées — gardées pour les appelants existants. */
export const ECRITURES_SENSIBLES: ReadonlySet<string> = new Set(Object.entries(REGISTRE_ECRITURES).filter(([, a]) => a.sensible).map(([n]) => n));
export const ECRITURES_ANODINES: ReadonlySet<string> = new Set(Object.entries(REGISTRE_ECRITURES).filter(([, a]) => a.anodine).map(([n]) => n));
