-- Anti-double-paiement des commissions.
-- La protection anti-doublon était PUREMENT applicative (lire puis insérer) :
-- sous concurrence (rejeu de webhook de paiement + génération manuelle admin),
-- deux appels passaient le check « existe déjà ? » avant que l'un insère →
-- DEUX commissions pour la même facture/job = double dette envers le rep.
-- On pose le filet en base : au plus UNE commission active par (org, pièce,
-- rep). Un même job/facture peut légitimement payer PLUSIEURS reps (splits),
-- d'où l'inclusion de user_id ; l'index est PARTIEL (deleted_at is null) pour
-- qu'une entrée soft-deletée ne bloque pas une re-création légitime.
create unique index if not exists fs_commission_entries_uniq_invoice_rep
  on public.fs_commission_entries (org_id, invoice_id, user_id)
  where deleted_at is null and invoice_id is not null;

create unique index if not exists fs_commission_entries_uniq_job_rep
  on public.fs_commission_entries (org_id, job_id, user_id)
  where deleted_at is null and job_id is not null;
