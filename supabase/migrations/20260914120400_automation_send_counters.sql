-- Audit automatisations 2026-09-13, F11/F13 — migration M4.
-- Plafond quotidien d'envois d'automatisation par org, porté par le forfait.
-- 0 = pas de plafond. Au-delà du plafond, le moteur REPORTE à demain (jamais
-- de perte, jamais d'envoi en trop) et prévient l'entrepreneur à 80 %.
create table if not exists public.automation_send_counters (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  day      date not null,                          -- date de Montréal
  sms      integer not null default 0,
  email    integer not null default 0,
  primary key (org_id, day)
);
alter table public.automation_send_counters enable row level security;
alter table public.automation_send_counters force row level security;
drop policy if exists automation_send_counters_select_org on public.automation_send_counters;
create policy automation_send_counters_select_org on public.automation_send_counters
  as permissive for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));
revoke insert, update, delete on public.automation_send_counters from authenticated, anon;

-- Incrément atomique appelé par le serveur (service_role) avant chaque envoi ;
-- renvoie le nouveau total du canal pour comparaison au plafond du forfait.
create or replace function public.automation_bump_counter(p_org uuid, p_canal text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v integer;
begin
  if p_canal not in ('sms', 'email') then
    raise exception 'canal inconnu: %', p_canal;
  end if;
  insert into public.automation_send_counters (org_id, day, sms, email)
  values (p_org, (now() at time zone 'America/Toronto')::date,
          case when p_canal = 'sms' then 1 else 0 end,
          case when p_canal = 'email' then 1 else 0 end)
  on conflict (org_id, day) do update
    set sms = public.automation_send_counters.sms + excluded.sms,
        email = public.automation_send_counters.email + excluded.email
  returning case when p_canal = 'sms' then sms else email end into v;
  return v;
end;
$$;
revoke all on function public.automation_bump_counter(uuid, text) from public, anon, authenticated;
grant execute on function public.automation_bump_counter(uuid, text) to service_role;

alter table public.plans
  add column if not exists automation_daily_sms_cap integer not null default 0,
  add column if not exists automation_daily_email_cap integer not null default 0;
comment on column public.plans.automation_daily_sms_cap is
  'Plafond quotidien de SMS d''automatisation par org. 0 = illimité. Valeurs par forfait à décider (proposition audit : pro 100, autopilot 300).';
comment on column public.plans.automation_daily_email_cap is
  'Plafond quotidien de courriels d''automatisation par org. 0 = illimité. Proposition audit : pro 300, autopilot 1000.';
