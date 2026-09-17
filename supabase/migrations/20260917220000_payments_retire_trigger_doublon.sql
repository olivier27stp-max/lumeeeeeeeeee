-- Retire trg_payment_to_invoice_paid (AFTER INSERT ON payments).
--
-- Ce déclencheur appelait webhook_payment_received(), qui ré-insérait un
-- paiement dans payments SANS created_by, puis recalculait la facture à la
-- main et posait une notification 'invoice_paid'. Trois problèmes :
--   1. crm_enforce_scope exige created_by hors session : toute insertion de
--      paiement par le serveur (webhook Stripe, capture PayPal) échouait
--      « created_by is required when no auth context » → webhook 500,
--      Stripe rejoue 3 jours, la facture reste due. Découvert le 2026-09-17
--      par un paiement de bout en bout sur staging ; la prod n'avait encore
--      reçu AUCUN paiement en ligne (3 paiements manuels, dernier en avril).
--   2. Le solde de la facture est déjà recalculé depuis payments par
--      trg_payments_recalculate_invoice (source de vérité), et le serveur
--      appelle apply_invoice_payment : ce déclencheur ajoutait une troisième
--      écriture concurrente du même montant.
--   3. La notification « Paiement reçu » est déjà posée par ac_track_payments ;
--      le type 'invoice_paid' n'est lu par aucun écran.
-- La fonction webhook_payment_received est conservée (aucun autre appelant
-- connu ; grep code + pg_proc) mais plus rien ne la déclenche.

begin;

drop trigger if exists trg_payment_to_invoice_paid on public.payments;

comment on function public.webhook_payment_received(uuid, uuid, text, text, integer, text) is
  'Héritage : n''est plus déclenchée (trigger retiré le 2026-09-17, voir migration 20260917220000). Le solde des factures vient de trg_payments_recalculate_invoice.';

commit;
