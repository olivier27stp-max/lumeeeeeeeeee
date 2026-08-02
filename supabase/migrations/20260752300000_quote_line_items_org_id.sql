-- ============================================================================
-- D1 — quote_line_items : ajout de org_id + isolation tenant directe (2026-08-01)
-- ============================================================================
-- quote_line_items était la SEULE table de lignes tarifées sans org_id : son
-- isolation ne tenait que par jointure transitive vers quotes. Un quote_id mal
-- réglé pouvait rattacher une ligne au devis d'un autre tenant, non bloqué au
-- niveau DB (recoupe la fuite C1-01).
--
-- Approche identique aux tables soeurs (invoice_items, job_line_items) :
--   1) colonne org_id nullable  2) backfill depuis quotes  3) trigger BEFORE
--   INSERT/UPDATE qui remplit org_id depuis le quote parent (=> l'APP N'A PAS À
--   CHANGER, elle continue d'insérer sans org_id)  4) NOT NULL  5) FK composite
--   (org_id, quote_id) -> quotes(org_id, id) qui rend structurellement
--   impossible d'attacher une ligne au devis d'un autre org.
-- 31 lignes existantes, toutes rattachées à un quote valide (0 orphelin).
-- ============================================================================

begin;

-- 1) colonne nullable
alter table public.quote_line_items add column if not exists org_id uuid;

-- 2) backfill depuis le quote parent
update public.quote_line_items qli
   set org_id = q.org_id
  from public.quotes q
 where q.id = qli.quote_id
   and qli.org_id is null;

-- 3) trigger de synchro org_id (mirroir de invoice_items_sync_org)
create or replace function public.quote_line_items_sync_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
begin
  select org_id into v_org from public.quotes where id = new.quote_id limit 1;
  if v_org is null then
    raise exception 'Quote % introuvable pour la ligne de devis', new.quote_id;
  end if;
  new.org_id := v_org;
  return new;
end;
$function$;

drop trigger if exists trg_quote_line_items_sync_org on public.quote_line_items;
create trigger trg_quote_line_items_sync_org
  before insert or update of quote_id on public.quote_line_items
  for each row execute function public.quote_line_items_sync_org();

-- 4) NOT NULL (backfill + trigger garantissent que toute ligne a un org_id)
alter table public.quote_line_items alter column org_id set not null;

-- 5) FK composite tenant-safe (org_id auto-rempli => toujours cohérent)
alter table public.quote_line_items
  add constraint quote_line_items_org_quote_fkey
  foreign key (org_id, quote_id) references public.quotes(org_id, id) on delete cascade;

commit;
