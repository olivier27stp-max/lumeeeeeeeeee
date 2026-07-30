-- ============================================================================
-- N3.3 — FK composites (org_id, x) : protection structurelle anti-melange
-- ============================================================================
-- Constat audit : 0 FK composite sur toute la base.
-- La RLS empeche de LIRE chez le voisin ; elle n'empeche pas de POINTER dessus.
-- Une FK composite est la seule protection structurelle contre le melange.
--
-- ETAT DES DONNEES (verifie en prod avant ecriture de cette migration) :
--   Les 25 relations les plus sensibles testees : 0 violation cross-tenant.
--   Les contraintes sont donc ajoutees NOT VALID puis VALIDATE (N5.3), ce qui
--   evite un verrou ACCESS EXCLUSIVE prolonge sur les tables chaudes.
--
-- STRATEGIE :
--   1. unique (org_id, id) sur chaque table parent  -> cible de la FK composite
--   2. FK composite (org_id, fk_col) -> parent (org_id, id), NOT VALID
--   3. VALIDATE CONSTRAINT (verrou SHARE UPDATE EXCLUSIVE, non bloquant en lecture)
--
-- EXCLUSIONS AUTOMATIQUES :
--   - enfant dont org_id est NULLABLE : une FK composite y serait silencieusement
--     inoperante (MATCH SIMPLE ignore la ligne des qu'une colonne est NULL).
--     Ces tables sont corrigees dans 20260751100400_org_id_not_null.sql ; leurs
--     FK composites sont ajoutees ensuite par 20260751100500_composite_fk_phase2.sql.
--   - auto-references (conrelid = confrelid)
--   - relations deja composites
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- ETAPE 1 — unique (org_id, id) sur les tables parents
-- ----------------------------------------------------------------------------
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
                    where x.attrelid = c.conrelid and x.attname = 'org_id' and not x.attisdropped
                      and x.attnotnull)
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.confrelid and x.attname = 'org_id' and not x.attisdropped)
     order by 1
  loop
    -- Deja present ?
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

    execute format(
      'alter table %s add constraint %I unique (org_id, id)',
      r.parent, r.parent || '_org_id_id_uq'
    );
    n := n + 1;
  end loop;

  raise notice 'ETAPE 1 : % contrainte(s) unique (org_id, id) ajoutee(s).', n;
end $$;

-- ----------------------------------------------------------------------------
-- ETAPE 2 — FK composites NOT VALID
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_name text;
  n int := 0;
  skipped int := 0;
begin
  for r in
    select c.conrelid::regclass::text  as child,
           c.confrelid::regclass::text as parent,
           a.attname                   as fkcol,
           c.confdeltype
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> c.confrelid
       -- enfant : org_id present ET NOT NULL (sinon FK composite inoperante)
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
      skipped := skipped + 1;
      continue;
    end if;

    -- ON DELETE : on reprend l'action de la FK simple existante.
    -- CASCADE/SET NULL sur une FK composite dont org_id fait partie de la cle
    -- ecraserait org_id ; on retombe donc sur NO ACTION, la FK simple d'origine
    -- restant en place pour porter le comportement de suppression.
    execute format(
      'alter table %s add constraint %I foreign key (org_id, %I) '
      'references %s (org_id, id) not valid',
      r.child, v_name, r.fkcol, r.parent
    );
    n := n + 1;
  end loop;

  raise notice 'ETAPE 2 : % FK composite(s) ajoutee(s) NOT VALID, % deja presente(s).', n, skipped;
end $$;

-- ----------------------------------------------------------------------------
-- ETAPE 3 — VALIDATE (verrou SHARE UPDATE EXCLUSIVE : lectures/ecritures OK)
-- ----------------------------------------------------------------------------
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
      -- Une validation qui echoue = donnees cross-tenant reelles sur cette
      -- relation. On la signale sans faire echouer toute la migration ; la
      -- contrainte reste NOT VALID (elle protege deja les ECRITURES futures).
      failed := failed || (r.child || '.' || r.conname || ' -> ' || sqlerrm);
    end;
  end loop;

  raise notice 'ETAPE 3 : % FK composite(s) validee(s).', n;

  if array_length(failed, 1) > 0 then
    raise warning 'FK composites NON validees (donnees cross-tenant existantes) : %',
      array_to_string(failed, ' | ');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Index de couverture : la FK composite (org_id, fk_col) beneficie d'un index
-- prefixe par org_id (N3.6). On ne cree que ceux reellement absents.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_idx text;
  n int := 0;
begin
  for r in
    select c.conrelid::regclass::text as child,
           a.attname as fkcol,
           c.conrelid
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[2]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.conname like '%\_same\_org'
     order by 1
  loop
    if exists (
      select 1 from pg_index i
       where i.indrelid = r.conrelid
         and i.indnatts >= 2
         and (i.indkey::int2[])[0] = (select attnum from pg_attribute
                                       where attrelid = r.conrelid and attname = 'org_id')
         and (i.indkey::int2[])[1] = (select attnum from pg_attribute
                                       where attrelid = r.conrelid and attname = r.fkcol)
    ) then
      continue;
    end if;

    v_idx := format('idx_%s_org_%s', r.child, r.fkcol);
    if length(v_idx) > 63 then
      v_idx := left(v_idx, 55) || '_' || substr(md5(v_idx), 1, 7);
    end if;

    execute format('create index if not exists %I on %s (org_id, %I)',
                   v_idx, r.child, r.fkcol);
    n := n + 1;
  end loop;

  raise notice 'Index de couverture : % cree(s).', n;
end $$;
