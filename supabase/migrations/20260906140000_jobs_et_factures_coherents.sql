-- ═══════════════════════════════════════════════════════════════
-- Trois triggers qui laissaient les données mentir.
--
-- MÉTHODE (2026-09-06, prod, lecture seule)
-- 35 invariants métier passés sur la base : totaux, soldes, statuts,
-- dates, doublons. Neuf violés. Six sont des résidus de tests (juin à
-- août). Trois viennent de TRIGGERS qui écrivent la mauvaise colonne
-- ou n'en écrivent pas assez — donc reviendraient sur chaque nouveau
-- dossier d'un vrai client.
--
-- 1. LE SOUS-TOTAL D'UN JOB RESTAIT À ZÉRO
--    recalculate_job_totals_from_items écrivait `subtotal` (dollars,
--    projection) et `total_cents`, mais jamais `subtotal_cents` — la
--    source de vérité. Or sync_legacy_money_columns recalcule ensuite
--    `subtotal` DEPUIS `subtotal_cents`, soit 0. Prod : jobs 14 et 15,
--    total 760 $ / 350 $, sous-total 0 $. Le trigger n'écrit plus que les
--    cents ; la projection suit toute seule, comme partout ailleurs.
--
-- 2. UN JOB TERMINÉ N'AVAIT PAS DE DATE DE FIN
--    `completed_at` n'est posé que par finish_job (RPC). Le changement de
--    statut depuis l'interface est un UPDATE direct qui ne le pose pas.
--    Prod : 6 jobs terminés sur 6, completed_at vide. Or scheduler.ts
--    déclenche « X jours après un job terminé » (un an avec nous, rappel
--    saisonnier, relance des inactifs) SUR completed_at : ces messages ne
--    seraient jamais partis, pour personne. Un trigger le pose au passage
--    à « completed », quel que soit le chemin.
--
-- 3. UNE FACTURE PAYÉE RESTAIT « BROUILLON »
--    invoices_apply_status_logic force `draft` tant que issued_at est
--    vide — avant même de regarder le solde. « Marquer payée » sur une
--    facture jamais émise donnait : 1 535 $ encaissés, solde 0, statut
--    brouillon (prod, facture n° 2). Invisible des payées, absente des
--    revenus. Une facture qui a reçu de l'argent a de fait été émise :
--    issued_at prend la date du paiement.
--
-- RATTRAPAGE
--    Les 2 jobs retrouvent leur sous-total, les 6 jobs terminés reçoivent
--    completed_at = updated_at (date du dernier changement de statut, la
--    meilleure information disponible), la facture n° 2 devient payée.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Les cents, rien que les cents ─────────────────────────────
create or replace function public.recalculate_job_totals_from_items()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job_id uuid;
  v_subtotal_cents bigint;
begin
  if tg_op = 'DELETE' then v_job_id := old.job_id;
  else v_job_id := new.job_id; end if;
  if v_job_id is null then return coalesce(new, old); end if;

  select coalesce(sum(greatest(round(qty * unit_price_cents), 0)), 0)
    into v_subtotal_cents
    from public.job_line_items
   where job_id = v_job_id
     and deleted_at is null;

  -- Source de vérité : *_cents. Les colonnes en dollars (subtotal, total,
  -- total_amount, tax_total) sont des projections posées par
  -- sync_legacy_money_columns, BEFORE UPDATE sur jobs — jamais ici.
  update public.jobs
     set subtotal_cents = v_subtotal_cents,
         total_cents    = v_subtotal_cents + coalesce(tax_cents, 0),
         updated_at     = now()
   where id = v_job_id;

  return coalesce(new, old);
end;
$function$;

-- ── 2. completed_at suit le statut ───────────────────────────────
create or replace function public.jobs_set_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_jobs_set_completed_at on public.jobs;
create trigger trg_jobs_set_completed_at
  before insert or update of status on public.jobs
  for each row execute function public.jobs_set_completed_at();

-- ── 3. Une facture encaissée a été émise ─────────────────────────
create or replace function public.invoices_apply_status_logic()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.subtotal_cents := greatest(coalesce(new.subtotal_cents, 0), 0);
  new.tax_cents := greatest(coalesce(new.tax_cents, 0), 0);
  new.total_cents := greatest(new.subtotal_cents + new.tax_cents, 0);
  new.paid_cents := greatest(coalesce(new.paid_cents, 0), 0);

  if new.paid_cents > new.total_cents then
    new.paid_cents := new.total_cents;
  end if;

  new.balance_cents := greatest(new.total_cents - new.paid_cents, 0);

  if coalesce(new.status, '') = 'void' then
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  -- De l'argent est entré : la facture a de fait été émise. Sans cette
  -- ligne, « marquer payée » sur un brouillon laissait la facture en
  -- brouillon, solde 0, invisible des payées et des revenus.
  if new.issued_at is null and new.paid_cents > 0 then
    new.issued_at := coalesce(new.paid_at, now());
  end if;

  if new.issued_at is null then
    new.status := 'draft';
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  if new.balance_cents = 0 then
    new.status := 'paid';
    if new.paid_at is null then
      new.paid_at := now();
    end if;
    return new;
  end if;

  if new.paid_cents > 0 then
    new.status := 'partial';
  else
    new.status := 'sent';
  end if;

  if new.balance_cents > 0 then
    new.paid_at := null;
  end if;

  return new;
end;
$function$;

-- ── Rattrapage ───────────────────────────────────────────────────
-- Jobs dont le sous-total ne suit pas ses lignes.
update public.jobs j
   set subtotal_cents = s.somme,
       total_cents    = s.somme + coalesce(j.tax_cents, 0)
  from (select job_id, coalesce(sum(greatest(round(qty * unit_price_cents), 0)), 0) as somme
          from public.job_line_items where deleted_at is null group by job_id) s
 where s.job_id = j.id
   and j.deleted_at is null
   and j.subtotal_cents is distinct from s.somme;

-- Jobs terminés sans date de fin.
update public.jobs
   set completed_at = coalesce(closed_at, updated_at)
 where status = 'completed'
   and completed_at is null
   and deleted_at is null;

-- Factures encaissées jamais émises : un simple UPDATE rejoue le trigger.
update public.invoices
   set updated_at = now()
 where issued_at is null
   and paid_cents > 0
   and deleted_at is null;

commit;
