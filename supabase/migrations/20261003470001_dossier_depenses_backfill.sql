-- Backfill du dossier « Dépenses » (suite de 20261003470000_dossier_depenses).
-- ⚠ NON APPLIQUÉE : en attente de l'approbation de Rafba (règle de la mission).
--
-- 1. Chaque entreprise existante reçoit le dossier et ses 10 champs de base.
-- 2. L'ancien total de dépenses d'un job (jobs.expenses_cents > 0) est recopié
--    dans « Autres dépenses » (depense_autres), sauf si le job a déjà une valeur
--    dans ce champ. Le calculateur ne lit jobs.expenses_cents QUE pour un job
--    sans aucun champ Dépenses rempli : après cette copie, le montant est compté
--    une seule fois (jamais les deux).
--
-- Mesuré le 2026-09-30 : 0 job avec expenses_cents > 0 en prod (audit de la
-- mission) ; 0 dossier nommé « Dépenses »/« Expenses » sur staging (à revérifier
-- en prod juste avant l'application). La copie (2) ne toucherait donc aucune
-- ligne aujourd'hui ; elle reste pour les montants saisis d'ici l'application.
--
-- jobs.expenses_cents n'est PAS remis à zéro (aucune donnée détruite).

begin;

select public.cf_assurer_dossier_depenses(o.id) from public.orgs o;

insert into public.custom_field_values (org_id, field_id, object_type, job_id, value_money_cents, value_currency)
select j.org_id, f.id, 'job', j.id, j.expenses_cents, 'CAD'
  from public.jobs j
  join public.custom_field_folders d
    on d.org_id = j.org_id and d.object_type = 'job' and d.cle_systeme = 'depenses'
  join public.custom_fields f
    on f.org_id = j.org_id and f.object_type = 'job' and f.key = 'depense_autres'
   and f.folder_id = d.id and f.field_type = 'monetary' and f.archived_at is null
 where j.expenses_cents > 0
   and j.deleted_at is null
   and not exists (select 1 from public.custom_field_values v where v.field_id = f.id and v.job_id = j.id)
on conflict do nothing;

commit;
