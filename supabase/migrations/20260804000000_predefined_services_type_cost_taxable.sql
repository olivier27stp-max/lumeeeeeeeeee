-- Produits / Services : le catalogue distingue Produit vs Service, porte un
-- coût unitaire optionnel (marge) et un statut taxable. Aucune ligne existante
-- ne change de comportement : défauts service / NULL / taxable.
alter table public.predefined_services
  add column if not exists item_type text not null default 'service',
  add column if not exists default_cost_cents integer,
  add column if not exists taxable boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'predefined_services_item_type_check'
      and conrelid = 'public.predefined_services'::regclass
  ) then
    alter table public.predefined_services
      add constraint predefined_services_item_type_check
      check (item_type in ('product', 'service'));
  end if;
end $$;
