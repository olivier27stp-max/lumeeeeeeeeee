-- ============================================================================
-- N1.6 — updated_at maintenu par TRIGGER, jamais par l'application
-- ============================================================================
-- Constat audit : 127 colonnes updated_at, 50 triggers seulement.
-- 64 tables laissent l'application maintenir updated_at. Ce champ sera donc
-- faux le jour ou l'ecriture vient d'ailleurs : script de maintenance, import,
-- migration, agent IA, RPC SECURITY DEFINER — c'est-a-dire precisement le jour
-- ou on en a besoin pour debugger.
--
-- On reutilise public.set_updated_at(), deja en place sur 36 tables, plutot
-- que d'introduire une 21e variante de la meme fonction.
--
-- Le trigger est BEFORE UPDATE et ecrase toute valeur fournie par le client :
-- c'est voulu (la DB est la seule couche que personne ne contourne).
-- ============================================================================

set lock_timeout = '5s';

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.oid, c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'updated_at'
                      and not a.attisdropped)
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and not t.tgisinternal
                          and pg_get_triggerdef(t.oid) ilike '%updated_at%')
     order by c.relname
  loop
    execute format(
      'create trigger set_%s_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()',
      left(r.relname, 40), r.relname
    );
    n := n + 1;
  end loop;

  raise notice 'N1.6 : % trigger(s) updated_at cree(s).', n;
end $$;

-- ----------------------------------------------------------------------------
-- Verification : plus aucune table avec updated_at sans trigger.
-- ----------------------------------------------------------------------------
do $$
declare
  v int;
begin
  select count(*) into v
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped)
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = c.oid and not t.tgisinternal
                        and pg_get_triggerdef(t.oid) ilike '%updated_at%');

  if v > 0 then
    raise exception 'updated_at : % table(s) encore sans trigger.', v;
  end if;
end $$;
