-- ============================================================================
-- N1.7 / N1.4 / erreur n°7 — L'argent : une seule source de verite
-- ============================================================================
-- CONSTAT
-- `jobs` porte QUATRE representations du meme montant :
--     total_cents  integer  <- source de verite (ecrite par l'app)
--     total        numeric  <- heritee
--     total_amount numeric  <- heritee, laissee a 0.00 sur 17 jobs / 33
--     subtotal, tax_total numeric <- heritees
-- `invoices` porte la meme dualite : *_cents (vrais) et total/subtotal/tax_total
-- (numeric, toutes a 0).
--
-- CONSEQUENCE REELLE MESUREE : dashboardApi.moneyFromRow() testait total_amount
-- en premier ; comme il vaut 0.00 (et non NULL) sur 17 jobs, le tableau de bord
-- affichait 0 $ au lieu du vrai montant sur 9 jobs (2 590 $ manquants).
-- Corrige cote code dans le meme lot que cette migration.
--
-- RECONCILIATION VERIFIEE EN PROD AVANT ECRITURE :
--   jobs : round(total*100) = total_cents sur 33/33 lignes. 0 desaccord.
--   jobs : subtotal*100 = somme des job_line_items inclus (verifie par echantillon).
--   invoices : toutes les colonnes numeric sont a 0, les *_cents sont justes.
--   => `*_cents` est la source de verite. Les colonnes numeric sont derivees.
--
-- STRATEGIE : EXPAND / CONTRACT (N5.2). Cette migration ne fait que l'ETAPE 1
-- (expand) + l'etape 2 (backfill + coherence forcee). Le DROP des colonnes
-- heritees est volontairement laisse a une migration ULTERIEURE, une fois le
-- code deploye et observe. On ne supprime pas des colonnes d'argent le meme
-- jour qu'on change le code qui les lit.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- ETAPE 1 (expand) — jobs.subtotal_cents / tax_cents manquaient completement.
-- Leur absence forcait server/routes/agreements.ts a lire `jobs.subtotal`
-- (numeric) pour composer des documents CONTRACTUELS.
-- ----------------------------------------------------------------------------
alter table public.jobs add column if not exists subtotal_cents integer;
alter table public.jobs add column if not exists tax_cents      integer;

comment on column public.jobs.subtotal_cents is
  'Sous-total en cents. Source de verite (N1.4 : argent en entier, jamais float).';
comment on column public.jobs.tax_cents is
  'Taxes en cents. Source de verite.';

-- ----------------------------------------------------------------------------
-- ETAPE 2 (backfill) — deriver les cents depuis les colonnes numeric existantes.
-- On arrondit une seule fois, au centime : round() sur numeric est exact
-- (pas de binaire flottant), donc le backfill est deterministe.
-- ----------------------------------------------------------------------------
update public.jobs
   set subtotal_cents = round(coalesce(subtotal, 0) * 100)::integer
 where subtotal_cents is null;

update public.jobs
   set tax_cents = round(coalesce(tax_total, 0) * 100)::integer
 where tax_cents is null;

-- Cas mesure : subtotal = 0 alors que le job a des lignes et un total.
-- On reconstruit depuis les lignes, seule source fiable dans ce cas.
update public.jobs j
   set subtotal_cents = sub.lines_cents
  from (
    select li.job_id, coalesce(sum(li.total_cents), 0)::integer as lines_cents
      from public.job_line_items li
     where li.deleted_at is null
       and li.included is not false
     group by li.job_id
  ) sub
 where sub.job_id = j.id
   and coalesce(j.subtotal_cents, 0) = 0
   and sub.lines_cents > 0;

-- Dernier recours : ni numeric ni lignes -> subtotal = total - taxes.
update public.jobs
   set subtotal_cents = greatest(0, coalesce(total_cents, 0) - coalesce(tax_cents, 0))
 where coalesce(subtotal_cents, 0) = 0
   and coalesce(total_cents, 0) > 0;

alter table public.jobs alter column subtotal_cents set default 0;
alter table public.jobs alter column tax_cents      set default 0;
update public.jobs set subtotal_cents = 0 where subtotal_cents is null;
update public.jobs set tax_cents      = 0 where tax_cents      is null;
alter table public.jobs alter column subtotal_cents set not null;
alter table public.jobs alter column tax_cents      set not null;

-- ----------------------------------------------------------------------------
-- ETAPE 3 — Resynchroniser les colonnes HERITEES depuis les cents.
-- Tant qu'elles existent, elles doivent etre justes : un rapport, un export ou
-- un agent qui lit `total_amount` ne doit plus voir 0 $.
-- ----------------------------------------------------------------------------
update public.jobs
   set total_amount = round(coalesce(total_cents, 0) / 100.0, 2),
       total        = round(coalesce(total_cents, 0) / 100.0, 2),
       subtotal     = round(subtotal_cents / 100.0, 2),
       tax_total    = round(tax_cents / 100.0, 2)
 where total_amount is distinct from round(coalesce(total_cents, 0) / 100.0, 2)
    or total        is distinct from round(coalesce(total_cents, 0) / 100.0, 2)
    or subtotal     is distinct from round(subtotal_cents / 100.0, 2)
    or tax_total    is distinct from round(tax_cents / 100.0, 2);

update public.invoices
   set total     = round(coalesce(total_cents, 0)    / 100.0, 2),
       subtotal  = round(coalesce(subtotal_cents, 0) / 100.0, 2),
       tax_total = round(coalesce(tax_cents, 0)      / 100.0, 2)
 where total     is distinct from round(coalesce(total_cents, 0)    / 100.0, 2)
    or subtotal  is distinct from round(coalesce(subtotal_cents, 0) / 100.0, 2)
    or tax_total is distinct from round(coalesce(tax_cents, 0)      / 100.0, 2);

-- ----------------------------------------------------------------------------
-- ETAPE 4 — Empecher la derive de revenir.
-- Un trigger recalcule les colonnes heritees a chaque ecriture : elles
-- deviennent de simples projections, plus des valeurs saisissables. C'est ce
-- qui rend le futur DROP sans risque.
-- ----------------------------------------------------------------------------
create or replace function public.sync_legacy_money_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'jobs' then
    new.total_amount := round(coalesce(new.total_cents, 0) / 100.0, 2);
    new.total        := round(coalesce(new.total_cents, 0) / 100.0, 2);
    new.subtotal     := round(coalesce(new.subtotal_cents, 0) / 100.0, 2);
    new.tax_total    := round(coalesce(new.tax_cents, 0) / 100.0, 2);
  elsif tg_table_name = 'invoices' then
    new.total     := round(coalesce(new.total_cents, 0)    / 100.0, 2);
    new.subtotal  := round(coalesce(new.subtotal_cents, 0) / 100.0, 2);
    new.tax_total := round(coalesce(new.tax_cents, 0)      / 100.0, 2);
  end if;
  return new;
end $$;

comment on function public.sync_legacy_money_columns() is
  'N1.7 — Les colonnes numeric heritees (total, subtotal, tax_total, '
  'total_amount) sont des PROJECTIONS de *_cents, jamais des sources. '
  'A supprimer avec les colonnes, une fois tout le code bascule sur *_cents.';

drop trigger if exists sync_jobs_legacy_money on public.jobs;
create trigger sync_jobs_legacy_money
  before insert or update on public.jobs
  for each row execute function public.sync_legacy_money_columns();

drop trigger if exists sync_invoices_legacy_money on public.invoices;
create trigger sync_invoices_legacy_money
  before insert or update on public.invoices
  for each row execute function public.sync_legacy_money_columns();

-- ----------------------------------------------------------------------------
-- ETAPE 5 — Contraintes de coherence (N1.5 : la DB est la seule couche que
-- personne ne contourne). Montants negatifs interdits.
-- ----------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_money_non_negative;
alter table public.jobs add constraint jobs_money_non_negative
  check (coalesce(total_cents, 0) >= 0
     and subtotal_cents >= 0
     and tax_cents >= 0) not valid;
alter table public.jobs validate constraint jobs_money_non_negative;

alter table public.invoices drop constraint if exists invoices_money_non_negative;
alter table public.invoices add constraint invoices_money_non_negative
  check (coalesce(total_cents, 0) >= 0
     and coalesce(subtotal_cents, 0) >= 0
     and coalesce(tax_cents, 0) >= 0
     and coalesce(paid_cents, 0) >= 0) not valid;
alter table public.invoices validate constraint invoices_money_non_negative;

-- ----------------------------------------------------------------------------
-- Verification finale : plus aucun desaccord entre cents et numeric.
-- ----------------------------------------------------------------------------
do $$
declare
  v_jobs int;
  v_inv  int;
begin
  select count(*) into v_jobs from public.jobs
   where deleted_at is null
     and (total_amount is distinct from round(coalesce(total_cents,0)/100.0, 2)
       or total        is distinct from round(coalesce(total_cents,0)/100.0, 2));

  select count(*) into v_inv from public.invoices
   where deleted_at is null
     and total is distinct from round(coalesce(total_cents,0)/100.0, 2);

  if v_jobs > 0 or v_inv > 0 then
    raise exception 'Desaccord persistant : % job(s), % facture(s).', v_jobs, v_inv;
  end if;

  raise notice 'Argent reconcilie : jobs et invoices coherents.';
end $$;
