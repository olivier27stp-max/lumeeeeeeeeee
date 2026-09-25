-- Correctif de 20260928020000 : quand un bureau SE MET à suivre la marque
-- commune, le logo était recopié dans company_settings mais pas dans le miroir
-- orgs.logo_url (qui n'était mis à jour qu'au prochain changement de la marque
-- commune). Constaté en prod sur Vision Lavage le 2026-09-25.

create or replace function public.miroir_logo_suivi_marque()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.suit_marque_entreprise and (tg_op = 'INSERT' or not old.suit_marque_entreprise) then
    update public.orgs set logo_url = new.logo_url where id = new.org_id and logo_url is distinct from new.logo_url;
  end if;
  return new;
end;
$function$;
revoke all on function public.miroir_logo_suivi_marque() from public, anon, authenticated;

drop trigger if exists trg_company_settings_miroir_logo_marque on public.company_settings;
create trigger trg_company_settings_miroir_logo_marque
  after insert or update of suit_marque_entreprise on public.company_settings
  for each row execute function public.miroir_logo_suivi_marque();

-- Rattrapage : bureaux qui suivent déjà la marque (prod : Vision Lavage).
update public.orgs o
   set logo_url = cs.logo_url
  from public.company_settings cs
 where cs.org_id = o.id and cs.suit_marque_entreprise and o.logo_url is distinct from cs.logo_url;
