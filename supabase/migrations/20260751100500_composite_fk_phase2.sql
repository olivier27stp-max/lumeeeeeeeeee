-- ============================================================================
-- N3.3 (phase 2) — FK composites sur les tables dont org_id vient de devenir
--                  NOT NULL dans 20260751100400_org_id_not_null.sql
-- ============================================================================
-- La phase 1 (...100200) excluait volontairement ces tables : une FK composite
-- dont une colonne est NULLABLE est silencieusement inoperante (MATCH SIMPLE
-- ignore toute ligne ou une colonne de la cle vaut NULL). Elle aurait donne
-- une fausse impression de protection.
--
-- Maintenant que org_id y est NOT NULL, la meme logique generique s'applique.
-- Ce fichier reutilise exactement l'algorithme de la phase 1 ; il ne traite que
-- ce qui reste a faire (il est donc naturellement idempotent).
-- ============================================================================

set lock_timeout = '5s';

-- ETAPE 1 — unique (org_id, id) sur les parents encore depourvus
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct c.confrelid::regclass::text as parent
      from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> c.confrelid
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.conrelid and x.attname = 'org_id'
                      and not x.attisdropped and x.attnotnull)
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.confrelid and x.attname = 'org_id' and not x.attisdropped)
     order by 1
  loop
    if exists (
      select 1 from pg_constraint u
       where u.conrelid = r.parent::regclass
         and u.contype in ('u','p')
         and (select array_agg(a.attname::text order by a.attname::text)
                from unnest(u.conkey) k join pg_attribute a
                  on a.attrelid = u.conrelid and a.attnum = k) = array['id','org_id']::text[]
    ) then
      continue;
    end if;

    execute format('alter table %s add constraint %I unique (org_id, id)',
                   r.parent, r.parent || '_org_id_id_uq');
    n := n + 1;
  end loop;

  raise notice 'Phase 2 / etape 1 : % unique(org_id, id) ajoutee(s).', n;
end $$;

-- ETAPE 2 — FK composites NOT VALID
do $$
declare
  r record;
  v_name text;
  n int := 0;
begin
  for r in
    select c.conrelid::regclass::text  as child,
           c.confrelid::regclass::text as parent,
           a.attname                   as fkcol
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> c.confrelid
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.conrelid and x.attname = 'org_id'
                      and not x.attisdropped and x.attnotnull)
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.confrelid and x.attname = 'org_id' and not x.attisdropped)
     order by 1, 3
  loop
    v_name := format('%s_%s_same_org', r.child, r.fkcol);
    if length(v_name) > 63 then
      v_name := left(v_name, 55) || '_' || substr(md5(v_name), 1, 7);
    end if;

    if exists (select 1 from pg_constraint
                where conname = v_name and conrelid = r.child::regclass) then
      continue;
    end if;

    execute format(
      'alter table %s add constraint %I foreign key (org_id, %I) '
      'references %s (org_id, id) not valid',
      r.child, v_name, r.fkcol, r.parent
    );
    n := n + 1;
  end loop;

  raise notice 'Phase 2 / etape 2 : % FK composite(s) ajoutee(s).', n;
end $$;

-- ETAPE 3 — VALIDATE
do $$
declare
  r record;
  n int := 0;
  failed text[] := '{}';
begin
  for r in
    select c.conrelid::regclass::text as child, c.conname
      from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.conname like '%\_same\_org'
       and not c.convalidated
     order by 1
  loop
    begin
      execute format('alter table %s validate constraint %I', r.child, r.conname);
      n := n + 1;
    exception when others then
      failed := failed || (r.child || '.' || r.conname || ' -> ' || sqlerrm);
    end;
  end loop;

  raise notice 'Phase 2 / etape 3 : % FK composite(s) validee(s).', n;

  if array_length(failed, 1) > 0 then
    raise warning 'FK composites NON validees : %', array_to_string(failed, ' | ');
  end if;
end $$;
