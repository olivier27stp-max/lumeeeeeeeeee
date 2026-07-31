-- ============================================================================
-- N2.7 — Le piège du fuseau horaire (spécifique au Québec, et brutal)
-- ============================================================================
-- CITATION DU PRINCIPE
--   « Un rendez-vous récurrent le mardi 8 h doit rester à 8 h APRÈS le
--     changement d'heure. Si tu stockes seulement l'UTC de la première
--     occurrence et que tu ajoutes 7 jours, tu obtiens 7 h ou 9 h la moitié
--     de l'année. »
--
-- C'est EXACTEMENT ce que fait Lume aujourd'hui.
--
-- PREUVE 1 — schéma : job_recurrence_rules ne porte AUCUNE colonne de fuseau
--   (id, job_id, org_id, frequency, interval_days, day_of_week, day_of_month,
--    start_date, end_date, max_occurrences, occurrences_created, next_run_at,
--    is_active, created_at, updated_at)
--   et ni `orgs` ni `company_settings` ne stockent de timezone.
--
-- PREUVE 2 — code : server/lib/recurringJobScheduler.ts, calculateNextRun()
--   fait `next.setDate(next.getDate() + 7)` sur un Date JS. Cette arithmétique
--   s'applique dans le fuseau du PROCESSUS (UTC en production), pas dans celui
--   du tenant.
--
-- PREUVE 3 — execution reelle (serveur force en UTC, comme en prod) :
--   Occurrence 1 : 2026-10-27 08 h 00  (attendu 08:00)  OK
--   Occurrence 2 : 2026-11-03 07 h 00  (attendu 08:00)  DECALE
--   Occurrence 3 : 2026-11-10 07 h 00  (attendu 08:00)  DECALE
--   Occurrence 4 : 2026-11-17 07 h 00  (attendu 08:00)  DECALE
--   Le 1er novembre 2026, le Quebec repasse a l'heure normale : toutes les
--   visites recurrentes reculent d'une heure et le restent.
--
-- IMPACT METIER : une equipe se presente une heure trop tot chez le client,
-- deux fois par an, sur TOUTES les series recurrentes. Le client, lui, a note
-- 8 h. C'est le genre de bug qu'on attribue a « quelqu'un s'est trompe ».
--
-- CORRECTIF EN DEUX TEMPS
--   Ici (schema)  : stocker le fuseau du tenant et celui de chaque serie.
--   Cote code     : recalculer l'occurrence en heure LOCALE + fuseau, jamais
--                   par arithmetique UTC (voir recurringJobScheduler.ts).
--
-- Defaut 'America/Toronto' : identique a America/Montreal (memes regles DST,
-- meme offset) mais c'est l'identifiant canonique IANA pour l'Est canadien —
-- America/Montreal en est un alias deprecie, absent de certaines distributions.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Fuseau au niveau de l'organisation (N3.8 : aucune constante d'affaires
--    en dur dans le code — le jour ou un client est en Alberta, on ne deploie pas).
-- ----------------------------------------------------------------------------
alter table public.company_settings
  add column if not exists timezone text not null default 'America/Toronto';

-- Un fuseau invalide ne doit pas pouvoir entrer. Postgres refuse une
-- sous-requete dans un CHECK (« cannot use subquery in check constraint ») :
-- on passe donc par une fonction, qui teste la conversion reelle.
create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_tz is null then
    return false;
  end if;
  perform timestamptz '2000-01-01' at time zone p_tz;
  return true;
exception when others then
  return false;
end $$;

comment on function public.is_valid_timezone(text) is
  'Valide un identifiant de fuseau IANA en tentant la conversion. Utilisee en '
  'CHECK : Postgres interdit les sous-requetes sur pg_timezone_names.';

alter table public.company_settings
  drop constraint if exists company_settings_timezone_valid;

alter table public.company_settings
  add constraint company_settings_timezone_valid
  check (public.is_valid_timezone(timezone)) not valid;

alter table public.company_settings
  validate constraint company_settings_timezone_valid;

comment on column public.company_settings.timezone is
  'N2.7 — Fuseau IANA du tenant. Toute generation d''occurrence recurrente doit '
  'passer par ce fuseau, jamais par l''arithmetique UTC.';

-- ----------------------------------------------------------------------------
-- 2. Fuseau + heure locale au niveau de la serie.
--    La regle se stocke en heure LOCALE ; l'instant UTC est derive a la volee.
-- ----------------------------------------------------------------------------
alter table public.job_recurrence_rules
  add column if not exists timezone text;

alter table public.job_recurrence_rules
  add column if not exists local_time time;

comment on column public.job_recurrence_rules.timezone is
  'N2.7 — Fuseau IANA de la serie. NULL = heriter de company_settings.timezone.';

comment on column public.job_recurrence_rules.local_time is
  'N2.7 — Heure LOCALE de la visite (ex. 08:00). C''est elle qui doit rester '
  'stable a travers le changement d''heure, pas l''instant UTC.';

-- ----------------------------------------------------------------------------
-- 3. Backfill : deriver l'heure locale des series existantes depuis next_run_at.
-- ----------------------------------------------------------------------------
update public.job_recurrence_rules r
   set timezone = coalesce(r.timezone, cs.timezone, 'America/Toronto'),
       local_time = coalesce(
         r.local_time,
         (r.next_run_at at time zone coalesce(cs.timezone, 'America/Toronto'))::time
       )
  from public.company_settings cs
 where cs.org_id = r.org_id
   and (r.timezone is null or r.local_time is null);

-- Series dont l'org n'a pas de company_settings : defaut.
update public.job_recurrence_rules
   set timezone = coalesce(timezone, 'America/Toronto'),
       local_time = coalesce(local_time, (next_run_at at time zone 'America/Toronto')::time)
 where timezone is null or local_time is null;

-- ----------------------------------------------------------------------------
-- 4. Fonction canonique de calcul de la prochaine occurrence.
--    Toute l'arithmetique se fait sur la DATE LOCALE, puis on recompose
--    l'instant en appliquant le fuseau. C'est ce qui garantit que 8 h reste 8 h.
-- ----------------------------------------------------------------------------
create or replace function public.next_recurrence_at(
  p_from        timestamptz,
  p_frequency   text,
  p_interval    integer default 7,
  p_timezone    text default 'America/Toronto',
  p_local_time  time default null
)
returns timestamptz
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_local_ts   timestamp;
  v_local_date date;
  v_time       time;
  v_next_date  date;
begin
  -- 1. Passer en heure locale du tenant.
  v_local_ts   := p_from at time zone p_timezone;
  v_local_date := v_local_ts::date;
  v_time       := coalesce(p_local_time, v_local_ts::time);

  -- 2. Avancer la DATE (jamais l'instant) selon la frequence.
  v_next_date := case p_frequency
    when 'daily'    then v_local_date + 1
    when 'weekly'   then v_local_date + 7
    when 'biweekly' then v_local_date + 14
    when 'monthly'  then (v_local_date + interval '1 month')::date
    when 'custom'   then v_local_date + greatest(coalesce(p_interval, 7), 1)
    else                 v_local_date + 7
  end;

  -- 3. Recomposer l'instant : date locale + heure locale, interprete dans le
  --    fuseau du tenant. Postgres applique le bon offset DST automatiquement.
  return (v_next_date + v_time) at time zone p_timezone;
end $$;

comment on function public.next_recurrence_at(timestamptz, text, integer, text, time) is
  'N2.7 — Calcule la prochaine occurrence en heure LOCALE + fuseau. '
  'Remplace l''arithmetique UTC (setDate(+7)) qui decalait les visites d''une '
  'heure a chaque changement d''heure. Testee sur la transition du 1er nov 2026.';

-- ----------------------------------------------------------------------------
-- 5. Verification : la transition du 1er novembre 2026 (fin de l'heure avancee).
-- ----------------------------------------------------------------------------
do $$
declare
  v_from timestamptz := timestamptz '2026-10-27 08:00:00-04';  -- mardi 8 h HAE
  v_n1 timestamptz;
  v_n2 timestamptz;
  v_h1 time;
  v_h2 time;
begin
  v_n1 := public.next_recurrence_at(v_from, 'weekly', 7, 'America/Toronto', time '08:00');
  v_n2 := public.next_recurrence_at(v_n1,   'weekly', 7, 'America/Toronto', time '08:00');

  v_h1 := (v_n1 at time zone 'America/Toronto')::time;
  v_h2 := (v_n2 at time zone 'America/Toronto')::time;

  if v_h1 <> time '08:00' or v_h2 <> time '08:00' then
    raise exception
      'N2.7 : le changement d''heure decale encore la recurrence (% puis %).',
      v_h1, v_h2;
  end if;

  raise notice 'N2.7 OK : 8 h reste 8 h a travers la transition (% et %).', v_n1, v_n2;
end $$;
