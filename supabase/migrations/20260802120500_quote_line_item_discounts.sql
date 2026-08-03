-- Rabais par ligne sur les items de devis.
alter table public.quote_line_items
  add column if not exists discount_type text check (discount_type in ('percentage','fixed')),
  add column if not exists discount_value numeric(12,2) not null default 0;

-- Le total de ligne devient net du rabais; tout l'aval (rpc_recalculate_quote,
-- vue publique, PDF, conversions job/facture) lit total_cents et suit.
create or replace function public.quote_line_items_set_total()
returns trigger language plpgsql as $$
declare
  v_gross numeric;
  v_disc numeric;
begin
  v_gross := NEW.quantity * NEW.unit_price_cents;
  if NEW.discount_type = 'percentage' then
    v_disc := v_gross * coalesce(NEW.discount_value, 0) / 100;
  elsif NEW.discount_type = 'fixed' then
    v_disc := coalesce(NEW.discount_value, 0) * 100;
  else
    v_disc := 0;
  end if;
  NEW.total_cents := greatest(0, round(v_gross - v_disc))::integer;
  return NEW;
end;
$$;

drop trigger if exists trg_quote_line_items_set_total on public.quote_line_items;
create trigger trg_quote_line_items_set_total
  before insert or update of quantity, unit_price_cents, discount_type, discount_value
  on public.quote_line_items
  for each row execute function public.quote_line_items_set_total();
