-- Marque d'entreprise (plan multi-bureaux, étape 7 ; Q3 par défaut : logo et
-- couleur communs, chaque bureau peut garder les siens).
--
-- Choix technique : la marque commune vit dans company_groups ; chaque bureau
-- a un interrupteur company_settings.suit_marque_entreprise. Les ~225 endroits
-- qui lisent company_settings.logo_url / brand_color (courriels, PDF, pages
-- publiques, portail) ne changent PAS : la marque commune est RECOPIÉE dans
-- les bureaux qui la suivent, par trigger, à chaque changement.
--   * company_groups.logo_url / brand_color : modifiables par un propriétaire
--     (policy existante company_groups_update_proprietaire) ;
--   * suivre la marque (interrupteur à vrai) recopie la marque commune dans le
--     bureau ; ne plus la suivre laisse le bureau avec ses valeurs actuelles ;
--   * orgs.logo_url (miroir du logo) suit aussi.
-- Par défaut aucun bureau ne suit : rien ne change tant qu'on ne l'active pas.

alter table public.company_groups
  add column if not exists logo_url text,
  add column if not exists brand_color text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.company_groups drop constraint if exists company_groups_brand_color_format;
alter table public.company_groups
  add constraint company_groups_brand_color_format
  check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
comment on column public.company_groups.logo_url is 'Logo commun de l''entreprise, recopié dans les bureaux qui suivent la marque.';
comment on column public.company_groups.brand_color is 'Couleur commune (#rrggbb), recopiée dans les bureaux qui suivent la marque.';

grant update (logo_url, brand_color) on public.company_groups to authenticated;

alter table public.company_settings
  add column if not exists suit_marque_entreprise boolean not null default false;
comment on column public.company_settings.suit_marque_entreprise is
  'Vrai : ce bureau affiche le logo et la couleur de l''entreprise (company_groups), recopiés automatiquement.';

-- Un bureau qui se met à suivre la marque reçoit la marque commune.
create or replace function public.appliquer_marque_entreprise_bureau()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  g record;
begin
  if not new.suit_marque_entreprise then return new; end if;
  if tg_op = 'UPDATE' and old.suit_marque_entreprise then return new; end if;
  select cg.logo_url, cg.brand_color into g
    from public.company_groups cg
    join public.orgs o on o.company_group_id = cg.id
   where o.id = new.org_id;
  if g.logo_url is not null then new.logo_url := g.logo_url; end if;
  if g.brand_color is not null then new.brand_color := g.brand_color; end if;
  return new;
end;
$function$;
revoke all on function public.appliquer_marque_entreprise_bureau() from public, anon, authenticated;

drop trigger if exists trg_company_settings_suit_marque on public.company_settings;
create trigger trg_company_settings_suit_marque
  before insert or update of suit_marque_entreprise on public.company_settings
  for each row execute function public.appliquer_marque_entreprise_bureau();

-- La marque commune change : tous les bureaux qui la suivent la reçoivent.
create or replace function public.propager_marque_entreprise()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.logo_url is not distinct from old.logo_url and new.brand_color is not distinct from old.brand_color then
    return new;
  end if;
  update public.company_settings cs
     set logo_url = new.logo_url,
         brand_color = new.brand_color,
         updated_at = now()
    from public.orgs o
   where o.id = cs.org_id
     and o.company_group_id = new.id
     and cs.suit_marque_entreprise;
  update public.orgs o
     set logo_url = new.logo_url
   where o.company_group_id = new.id
     and exists (select 1 from public.company_settings cs where cs.org_id = o.id and cs.suit_marque_entreprise);
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.propager_marque_entreprise() from public, anon, authenticated;

drop trigger if exists trg_company_groups_propager_marque on public.company_groups;
create trigger trg_company_groups_propager_marque
  before update of logo_url, brand_color on public.company_groups
  for each row execute function public.propager_marque_entreprise();
