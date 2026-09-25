-- ───────────────────────────────────────────────────────────────
-- Factures : le total recalculé oubliait le RABAIS.
--
-- invoices_apply_status_logic (BEFORE INSERT/UPDATE) posait
--   total = sous-total + taxes
-- alors que toute l'app (invoiceCalc.calculateInvoiceTotals,
-- recalculate_invoice_totals, l'importeur, la conversion devis → facture)
-- applique   total = sous-total − rabais (plafonné au sous-total) + taxes.
-- Toute facture avec un rabais finissait donc avec un total gonflé du rabais
-- et un faux solde dû. En prod au 2026-09-24 : 8 factures, toutes importées
-- de Jobber (Vision Lavage) — payées chez Jobber, « partiellement payées »
-- chez Lume avec un solde égal au rabais.
--
-- Aussi : le trigger ne se déclenchait pas quand SEUL le rabais changeait
-- (discount_cents absent de sa liste de colonnes) ; et la projection en
-- dollars (sync_invoices_legacy_money) passait AVANT ce recalcul (ordre
-- alphabétique des triggers) : `total` gardait l'ancienne valeur. Renommée
-- zz_… pour passer en dernier.
-- ───────────────────────────────────────────────────────────────

create or replace function public.invoices_apply_status_logic()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.subtotal_cents := greatest(coalesce(new.subtotal_cents, 0), 0);
  new.tax_cents := greatest(coalesce(new.tax_cents, 0), 0);
  -- Même règle que invoiceCalc.calculateInvoiceTotals : le rabais est plafonné au sous-total.
  new.total_cents := greatest(
    new.subtotal_cents - least(greatest(coalesce(new.discount_cents, 0), 0), new.subtotal_cents) + new.tax_cents, 0);
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

drop trigger if exists trg_invoices_apply_status_logic on public.invoices;
create trigger trg_invoices_apply_status_logic
  before insert or update of issued_at, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, balance_cents, status, paid_at
  on public.invoices
  for each row execute function public.invoices_apply_status_logic();

do $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'sync_invoices_legacy_money') then
    alter trigger sync_invoices_legacy_money on public.invoices rename to zz_sync_invoices_legacy_money;
  end if;
end $$;

-- ── Rattrapage ────────────────────────────────────────────────
-- Seulement les factures qui portent la signature du défaut : un rabais,
-- et un total égal à sous-total + taxes alors que la bonne règle donne autre
-- chose. La date de paiement est celle de l'export d'origine quand la
-- facture vient d'une migration (sinon le trigger pose now()).
create temporary table _factures_rabais as
select i.id,
       (select (s.normalized->>'paid_date') || 'T12:00:00'
          from public.migration_import_records r
          join public.migration_staging_records s on s.id = r.staging_record_id
         where r.entity_table = 'invoices' and r.entity_id = i.id
           and (s.normalized->>'paid_date') ~ '^\d{4}-\d{2}-\d{2}$'
         order by r.created_at desc
         limit 1) as paye_le
  from public.invoices i
 where i.deleted_at is null
   and coalesce(i.discount_cents, 0) > 0
   and i.total_cents = i.subtotal_cents + i.tax_cents
   and i.total_cents <> greatest(0, i.subtotal_cents - least(i.discount_cents, i.subtotal_cents) + i.tax_cents);

-- Le trigger refait total, solde, statut ; puis zz_… reprojette les dollars.
update public.invoices i
   set subtotal_cents = i.subtotal_cents,
       paid_at = coalesce(i.paid_at, f.paye_le::timestamptz)
  from _factures_rabais f
 where i.id = f.id;

drop table _factures_rabais;
