-- ═══════════════════════════════════════════════════════════════
-- Suite de 20260906140000 : le rattrapage de la facture encaissée
-- jamais émise touchait `updated_at` pour « rejouer le trigger ». Or
-- trg_invoices_apply_status_logic est déclaré UPDATE OF issued_at,
-- subtotal_cents, tax_cents, total_cents, paid_cents, status… —
-- updated_at n'en fait pas partie, le trigger n'a pas bougé. Prod :
-- facture n° 2 toujours brouillon, 1 535 $ encaissés.
--
-- On réécrit paid_cents à sa propre valeur : colonne surveillée, valeur
-- inchangée, trigger rejoué. Idempotent.
-- ═══════════════════════════════════════════════════════════════

begin;

update public.invoices
   set paid_cents = paid_cents
 where issued_at is null
   and paid_cents > 0
   and deleted_at is null;

commit;
