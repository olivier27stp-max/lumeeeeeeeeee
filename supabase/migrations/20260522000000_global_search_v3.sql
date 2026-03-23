-- ============================================================
-- Global Search V3 — Phone normalization, address search,
-- form_submissions (requests), and relationship expansion
-- ============================================================

begin;

-- Helper: strip phone to digits only for normalized comparison
create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;

-- Trigram index on form_submissions for search
create index if not exists form_submissions_name_trgm
  on public.form_submissions
  using gin (lower(concat_ws(' ', first_name, last_name, company, email, phone)) gin_trgm_ops);

-- Trigram index on client address
create index if not exists clients_address_trgm
  on public.clients
  using gin (lower(coalesce(address, '')) gin_trgm_ops);

-- Replace search_global_source to add:
-- 1. Phone digit normalization in clients search
-- 2. Address field in clients search
-- 3. form_submissions as "request" entity type
create or replace function public.search_global_source(p_org uuid, p_q text)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  extra_status text,
  extra_amount_cents integer,
  extra_currency text,
  extra_date text,
  extra_client_id uuid,
  extra_client_name text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  with args as (
    select
      p_org as org_id,
      trim(coalesce(p_q, '')) as raw_q,
      lower(trim(coalesce(p_q, ''))) as q,
      public.normalize_phone_digits(p_q) as q_digits,
      auth.uid() as user_id
  ),
  guard as (
    select 1 as ok
    from args a
    where a.raw_q <> ''
      and a.org_id is not null
      and public.has_org_membership(a.user_id, a.org_id)
  ),
  query_terms as (
    select
      a.q,
      a.q_digits,
      ('%' || a.q || '%')::text as pattern,
      plainto_tsquery('simple', a.q) as tsq,
      -- phone digit pattern: if query has 4+ digits, match by digits
      case when length(a.q_digits) >= 4 then ('%' || a.q_digits || '%')::text else null end as phone_pattern
    from args a
    join guard g on true
  ),
  -- Clients (with phone normalization + address)
  clients_ranked as (
    select
      'client'::text as entity_type,
      c.id as entity_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(c.company, ''),
        'Client'
      ) as title,
      coalesce(nullif(c.company, ''), nullif(c.email, ''), nullif(c.phone, ''), nullif(c.address, ''), 'Client') as subtitle,
      c.status as extra_status,
      null::integer as extra_amount_cents,
      null::text as extra_currency,
      null::text as extra_date,
      null::uuid as extra_client_id,
      null::text as extra_client_name,
      c.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q),
            similarity(lower(coalesce(c.email, '')), qt.q),
            similarity(lower(coalesce(c.phone, '')), qt.q),
            similarity(lower(coalesce(c.address, '')), qt.q),
            -- Phone digit match bonus
            case when qt.phone_pattern is not null
                  and public.normalize_phone_digits(c.phone) like qt.phone_pattern
                 then 0.9
                 else 0.0
            end
          )
      )::double precision as rank
    from public.clients c
    join query_terms qt on true
    where c.org_id = p_org
      and c.deleted_at is null
      and (
        lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address))) @@ qt.tsq
        -- Phone digit matching
        or (qt.phone_pattern is not null and public.normalize_phone_digits(c.phone) like qt.phone_pattern)
      )
  ),
  -- Jobs (unchanged from V2)
  jobs_ranked as (
    select
      'job'::text as entity_type,
      j.id as entity_id,
      coalesce(nullif(j.title, ''), nullif(j.job_number, ''), 'Job') as title,
      coalesce(
        nullif(j.client_name, ''),
        nullif(j.property_address, ''),
        nullif(j.status, ''),
        nullif(j.job_number, ''),
        'Job'
      ) as subtitle,
      j.status as extra_status,
      j.total_cents as extra_amount_cents,
      j.currency as extra_currency,
      j.scheduled_at::text as extra_date,
      j.client_id as extra_client_id,
      j.client_name as extra_client_name,
      j.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(j.title, '')), qt.q),
            similarity(lower(coalesce(j.client_name, '')), qt.q),
            similarity(lower(coalesce(j.property_address, '')), qt.q)
          )
      )::double precision as rank
    from public.jobs j
    join query_terms qt on true
    where j.org_id = p_org
      and j.deleted_at is null
      and (
        lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))) @@ qt.tsq
      )
  ),
  -- Leads (via pipeline_deals — unchanged from V2)
  lead_candidates as (
    select
      l.id as entity_id,
      coalesce(
        nullif(pd.title, ''),
        nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''),
        'Lead'
      ) as title,
      coalesce(nullif(pd.stage, ''), nullif(l.phone, ''), nullif(l.email, ''), 'Lead') as subtitle,
      l.status as extra_status,
      pd.value::integer as extra_amount_cents,
      null::text as extra_currency,
      null::text as extra_date,
      null::uuid as extra_client_id,
      null::text as extra_client_name,
      coalesce(pd.created_at, l.created_at) as created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(pd.title, '')), qt.q),
            similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q),
            similarity(lower(coalesce(l.email, '')), qt.q)
          )
      )::double precision as rank,
      row_number() over (
        partition by l.id
        order by
          (
            ts_rank_cd(
              to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))),
              qt.tsq
            ) * 2.0
            + greatest(
                similarity(lower(coalesce(pd.title, '')), qt.q),
                similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q),
                similarity(lower(coalesce(l.email, '')), qt.q)
              )
          ) desc,
          coalesce(pd.created_at, l.created_at) desc
      ) as rn
    from public.pipeline_deals pd
    join public.leads l
      on l.id = pd.lead_id
     and l.org_id = p_org
     and l.deleted_at is null
    join query_terms qt on true
    where pd.org_id = p_org
      and pd.deleted_at is null
      and (
        lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))) @@ qt.tsq
      )
  ),
  leads_ranked as (
    select
      'lead'::text as entity_type,
      lc.entity_id,
      lc.title,
      lc.subtitle,
      lc.extra_status,
      lc.extra_amount_cents,
      lc.extra_currency,
      lc.extra_date,
      lc.extra_client_id,
      lc.extra_client_name,
      lc.created_at,
      lc.rank
    from lead_candidates lc
    where lc.rn = 1
  ),
  -- Invoices (unchanged from V2)
  invoices_ranked as (
    select
      'invoice'::text as entity_type,
      i.id as entity_id,
      coalesce(nullif(i.invoice_number, ''), 'Invoice') as title,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        coalesce(i.subject, 'Invoice')
      ) as subtitle,
      i.status as extra_status,
      i.total_cents as extra_amount_cents,
      'CAD'::text as extra_currency,
      i.due_date::text as extra_date,
      i.client_id as extra_client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown'
      ) as extra_client_name,
      i.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(i.invoice_number, '')), qt.q),
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q)
          )
      )::double precision as rank
    from public.invoices i
    left join public.clients c on c.id = i.client_id and c.org_id = p_org
    join query_terms qt on true
    where i.org_id = p_org
      and i.deleted_at is null
      and (
        lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email))) @@ qt.tsq
      )
  ),
  -- Quotes (unchanged from V2)
  quotes_ranked as (
    select
      'quote'::text as entity_type,
      q2.id as entity_id,
      coalesce(nullif(q2.quote_number, ''), 'Quote') as title,
      coalesce(
        nullif(q2.title, ''),
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Quote')
      ) as subtitle,
      q2.status as extra_status,
      q2.total_cents as extra_amount_cents,
      q2.currency as extra_currency,
      q2.valid_until::text as extra_date,
      q2.client_id as extra_client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''),
        'Unknown'
      ) as extra_client_name,
      q2.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(q2.quote_number, '')), qt.q),
            similarity(lower(coalesce(q2.title, '')), qt.q),
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q)
          )
      )::double precision as rank
    from public.quotes q2
    left join public.clients c on c.id = q2.client_id and c.org_id = p_org
    left join public.leads l on l.id = q2.lead_id and l.org_id = p_org
    join query_terms qt on true
    where q2.org_id = p_org
      and q2.deleted_at is null
      and (
        lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name))) @@ qt.tsq
      )
  ),
  -- Requests (form_submissions)
  requests_ranked as (
    select
      'request'::text as entity_type,
      fs.id as entity_id,
      coalesce(
        nullif(trim(concat_ws(' ', fs.first_name, fs.last_name)), ''),
        'Request'
      ) as title,
      coalesce(
        nullif(fs.company, ''),
        nullif(fs.email, ''),
        nullif(fs.phone, ''),
        nullif(fs.city, ''),
        'Request'
      ) as subtitle,
      null::text as extra_status,
      null::integer as extra_amount_cents,
      null::text as extra_currency,
      fs.created_at::text as extra_date,
      fs.client_id as extra_client_id,
      coalesce(
        nullif(trim(concat_ws(' ', fs.first_name, fs.last_name)), ''),
        'Unknown'
      ) as extra_client_name,
      fs.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company)), qt.q),
            similarity(lower(coalesce(fs.email, '')), qt.q),
            similarity(lower(coalesce(fs.phone, '')), qt.q),
            case when qt.phone_pattern is not null
                  and public.normalize_phone_digits(fs.phone) like qt.phone_pattern
                 then 0.9
                 else 0.0
            end
          )
      )::double precision as rank
    from public.form_submissions fs
    join query_terms qt on true
    where fs.org_id = p_org
      and (
        lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes))) @@ qt.tsq
        or (qt.phone_pattern is not null and public.normalize_phone_digits(fs.phone) like qt.phone_pattern)
      )
  ),
  -- Teams (unchanged from V2)
  teams_ranked as (
    select
      'team'::text as entity_type,
      t.id as entity_id,
      t.name as title,
      null::text as subtitle,
      null::text as extra_status,
      null::integer as extra_amount_cents,
      null::text as extra_currency,
      null::text as extra_date,
      null::uuid as extra_client_id,
      null::text as extra_client_name,
      t.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(coalesce(t.name, ''))),
          qt.tsq
        ) * 2.0
        + similarity(lower(coalesce(t.name, '')), qt.q)
      )::double precision as rank
    from public.teams t
    join query_terms qt on true
    where t.org_id = p_org
      and t.deleted_at is null
      and (
        lower(t.name) ilike qt.pattern
        or similarity(lower(coalesce(t.name, '')), qt.q) > 0.12
        or to_tsvector('simple', lower(coalesce(t.name, ''))) @@ qt.tsq
      )
  ),
  -- Schedule Events (unchanged from V2)
  events_ranked as (
    select
      'event'::text as entity_type,
      se.id as entity_id,
      coalesce(nullif(j.title, ''), nullif(j.job_number, ''), 'Event') as title,
      coalesce(nullif(j.client_name, ''), to_char(se.start_time, 'Mon DD, YYYY HH24:MI')) as subtitle,
      j.status as extra_status,
      null::integer as extra_amount_cents,
      null::text as extra_currency,
      se.start_time::text as extra_date,
      j.client_id as extra_client_id,
      j.client_name as extra_client_name,
      se.created_at,
      (
        ts_rank_cd(
          to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name))),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(j.title, '')), qt.q),
            similarity(lower(coalesce(j.client_name, '')), qt.q)
          )
      )::double precision as rank
    from public.schedule_events se
    join public.jobs j on j.id = se.job_id and j.org_id = p_org
    join query_terms qt on true
    where se.org_id = p_org
      and se.deleted_at is null
      and (
        lower(concat_ws(' ', j.title, j.job_number, j.client_name)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', j.title, j.job_number, j.client_name)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name))) @@ qt.tsq
      )
  )
  select * from clients_ranked
  union all
  select * from jobs_ranked
  union all
  select * from leads_ranked
  union all
  select * from invoices_ranked
  union all
  select * from quotes_ranked
  union all
  select * from requests_ranked
  union all
  select * from teams_ranked
  union all
  select * from events_ranked;
$$;

-- Recreate dependent functions (they call search_global_source)
create or replace function public.search_global(
  p_org uuid,
  p_q text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  extra_status text,
  extra_amount_cents integer,
  extra_currency text,
  extra_date text,
  extra_client_id uuid,
  extra_client_name text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
    s.extra_status,
    s.extra_amount_cents,
    s.extra_currency,
    s.extra_date,
    s.extra_client_id,
    s.extra_client_name,
    s.created_at,
    s.rank
  from public.search_global_source(p_org, p_q) s
  order by s.rank desc nulls last, s.created_at desc, s.entity_type asc
  limit greatest(1, least(coalesce(p_limit, 20), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.search_global_by_type(
  p_org uuid,
  p_q text,
  p_entity_type text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  extra_status text,
  extra_amount_cents integer,
  extra_currency text,
  extra_date text,
  extra_client_id uuid,
  extra_client_name text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
    s.extra_status,
    s.extra_amount_cents,
    s.extra_currency,
    s.extra_date,
    s.extra_client_id,
    s.extra_client_name,
    s.created_at,
    s.rank
  from public.search_global_source(p_org, p_q) s
  where s.entity_type = lower(trim(coalesce(p_entity_type, '')))
  order by s.rank desc nulls last, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.search_global_counts(p_org uuid, p_q text)
returns table (
  entity_type text,
  total bigint
)
language sql
security definer
set search_path = public, extensions
as $$
  select s.entity_type, count(*)::bigint as total
  from public.search_global_source(p_org, p_q) s
  group by s.entity_type;
$$;

-- Grants
revoke all on function public.normalize_phone_digits(text) from public;
grant execute on function public.normalize_phone_digits(text) to authenticated;

revoke all on function public.search_global_source(uuid, text) from public;
grant execute on function public.search_global(uuid, text, int, int) to authenticated;
grant execute on function public.search_global_by_type(uuid, text, text, int, int) to authenticated;
grant execute on function public.search_global_counts(uuid, text) to authenticated;

commit;
