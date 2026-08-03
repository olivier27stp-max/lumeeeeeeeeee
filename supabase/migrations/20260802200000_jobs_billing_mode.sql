-- Plans de service — Billing and Payments (form de création de job).
-- billing_mode : comment le plan se facture.
--   'per_visit'    → une facture par visite, créée quand la visite est terminée
--   'single'       → une seule facture pour toutes les visites
--   'installments' → échéancier de N paiements (job_billing_milestones,
--                    billing_split = true)
--   NULL           → job ordinaire (comportement inchangé)
-- auto_charge : « Se faire payer automatiquement » — le paiement est demandé
-- sur la carte au dossier du client à chaque facture émise (request a payment
-- on file).
alter table public.jobs
  add column if not exists billing_mode text
    constraint jobs_billing_mode_check
    check (billing_mode is null or billing_mode in ('per_visit', 'single', 'installments')),
  add column if not exists auto_charge boolean not null default false;

comment on column public.jobs.billing_mode is
  'Plan de service : per_visit (facture par visite terminée), single (une facture), installments (échéancier). NULL = job ordinaire.';
comment on column public.jobs.auto_charge is
  'Se faire payer automatiquement : demander le paiement sur la carte au dossier à chaque facture émise.';
