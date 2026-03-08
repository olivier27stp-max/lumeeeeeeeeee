begin;

create extension if not exists pg_trgm;

create index if not exists clients_name_trgm
  on public.clients
  using gin (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(company, '')
    ) gin_trgm_ops
  );

create index if not exists jobs_title_trgm
  on public.jobs
  using gin (lower(coalesce(title, '')) gin_trgm_ops);

create index if not exists leads_title_trgm
  on public.leads
  using gin (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '')
    ) gin_trgm_ops
  );

create index if not exists pipeline_deals_title_trgm
  on public.pipeline_deals
  using gin (lower(coalesce(title, '')) gin_trgm_ops);

create or replace function public.search_global_source(p_org uuid, p_q text)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public
as $$
  with args as (
    select
      p_org as org_id,
      trim(coalesce(p_q, '')) as raw_q,
      lower(trim(coalesce(p_q, ''))) as q,
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
      ('%' || a.q || '%')::text as pattern,
      plainto_tsquery('simple', a.q) as tsq
    from args a
    join guard g on true
  ),
  clients_ranked as (
    select
      'client'::text as entity_type,
      c.id as entity_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(c.company, ''),
        'Client'
      ) as title,
      coalesce(nullif(c.company, ''), nullif(c.email, ''), nullif(c.phone, ''), 'Client') as subtitle,
      c.created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone))
          ),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q),
            similarity(lower(coalesce(c.email, '')), qt.q),
            similarity(lower(coalesce(c.phone, '')), qt.q)
          )
      )::double precision as rank
    from public.clients c
    join query_terms qt on true
    where c.org_id = p_org
      and c.deleted_at is null
      and (
        lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone))) @@ qt.tsq
      )
  ),
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
      j.created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))
          ),
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
  lead_candidates as (
    select
      l.id as entity_id,
      coalesce(
        nullif(pd.title, ''),
        nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''),
        'Lead'
      ) as title,
      coalesce(nullif(pd.stage, ''), nullif(l.phone, ''), nullif(l.email, ''), 'Lead') as subtitle,
      coalesce(pd.created_at, l.created_at) as created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))
          ),
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
              to_tsvector(
                'simple',
                lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))
              ),
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
      lc.created_at,
      lc.rank
    from lead_candidates lc
    where lc.rn = 1
  )
  select * from clients_ranked
  union all
  select * from jobs_ranked
  union all
  select * from leads_ranked;
$$;

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
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
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
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
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
set search_path = public
as $$
  select s.entity_type, count(*)::bigint as total
  from public.search_global_source(p_org, p_q) s
  group by s.entity_type;
$$;

revoke all on function public.search_global_source(uuid, text) from public;
revoke all on function public.search_global(uuid, text, int, int) from public;
revoke all on function public.search_global_by_type(uuid, text, text, int, int) from public;
revoke all on function public.search_global_counts(uuid, text) from public;

grant execute on function public.search_global(uuid, text, int, int) to authenticated;
grant execute on function public.search_global_by_type(uuid, text, text, int, int) to authenticated;
grant execute on function public.search_global_counts(uuid, text) to authenticated;

commit;
