/**
 * Déclencheurs SERVEUR du moteur de commissions (audit 2026-09-30).
 *
 * Avant, la commission d'une facture payée naissait :
 *  - pour Stripe : dans le webhook (ok) ;
 *  - pour « Marquer payée » : dans le NAVIGATEUR, après coup — onglet fermé,
 *    commission jamais créée ;
 *  - pour PayPal : jamais.
 * Et une reprise sur remboursement n'avait lieu que via POST /payments/refund,
 * pas pour un remboursement fait dans le tableau de bord Stripe.
 *
 * Ici, un seul point d'entrée par événement, idempotent (le moteur ne crée
 * jamais deux fois), et tout échec part en lettre morte rejouable au lieu
 * d'un console.error que personne ne lit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadLetter } from '../dead-letter';
import { generateCommissionsForInvoice, handleInvoiceReversal } from './commission-engine';

/** « Échecs » que le moteur renvoie sous forme de skip : à consigner aussi. */
const SKIPS_ECHECS = new Set(['dup_check_failed', 'rules_load_failed', 'period_stats_failed', 'insert_failed']);

export async function commissionsFacturePayee(sc: SupabaseClient, orgId: string, invoiceId: string, source: string) {
  const payload = { org_id: orgId, invoice_id: invoiceId, source };
  const res = await withDeadLetter(`commissions:generate:${source}`, payload, () => generateCommissionsForInvoice(sc, orgId, invoiceId));
  if (res?.skipped && SKIPS_ECHECS.has(res.skipped)) {
    await withDeadLetter(`commissions:generate:${source}`, { ...payload, skipped: res.skipped }, async () => {
      throw new Error(`commission engine skipped: ${res.skipped}`);
    });
  }
  return res;
}

export async function commissionsFactureRemboursee(sc: SupabaseClient, orgId: string, invoiceId: string, raison: string, source: string) {
  return withDeadLetter(`commissions:reversal:${source}`, { org_id: orgId, invoice_id: invoiceId, reason: raison, source },
    () => handleInvoiceReversal(sc, orgId, invoiceId, raison));
}
