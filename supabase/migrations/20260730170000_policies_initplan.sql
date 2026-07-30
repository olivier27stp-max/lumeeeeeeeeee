-- ═══════════════════════════════════════════════════════════════
-- Performance RLS — `auth.uid()` évalué une fois par requête
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
-- Idempotent : ne touche que les policies encore non optimisées.
--
-- PROBLÈME : `auth.uid()` appelé nu dans un prédicat de policy est
-- réévalué pour CHAQUE LIGNE examinée. Entouré de `(select ...)`, Postgres
-- en fait un initPlan calculé une seule fois par requête. Le résultat est
-- identique — c'est une optimisation pure, aucun changement de sémantique —
-- mais le coût cesse de croître avec le nombre de lignes.
--
-- L'écart ne se voit pas sur les volumes actuels (table la plus grosse :
-- 2162 lignes). Il devient une panne de performance à mesure que les
-- organisations s'accumulent, et c'est exactement le genre de dette qu'on
-- ne diagnostique plus une fois qu'elle fait mal : la requête est lente
-- « depuis toujours » et rien ne pointe vers la RLS.
--
-- 28 policies étaient concernées sur 399 utilisant `auth.uid()` — les 371
-- autres étaient déjà correctes. Une première détection par recherche
-- textuelle en avait annoncé 399 : Postgres normalise le texte des
-- policies (`(select auth.uid())` ressort en `( SELECT auth.uid() AS uid)`),
-- donc chercher la forme littérale produit des faux positifs massifs.
--
-- Vérifié après application : isolation intacte (222 relations testées
-- contre anon, 177 avec org_id, 45 tables enfants — aucune fuite),
-- 10/10 écritures réelles, 12/12 pages en navigateur.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_sql text;
  n int := 0;
begin
  for p in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and qual is not null
      and qual ~* 'auth\.uid\(\)'
      and qual !~* 'SELECT +auth\.uid'
    order by tablename, policyname
  loop
    -- Ne remplace que les occurrences PAS déjà précédées de `select`,
    -- sinon on produirait `(select (select auth.uid()))`.
    v_qual  := regexp_replace(p.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi');
    v_check := case
                 when p.with_check is null then null
                 else regexp_replace(p.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi')
               end;

    if p.cmd = 'INSERT' then
      v_sql := format('alter policy %I on public.%I with check (%s)',
                      p.policyname, p.tablename, coalesce(v_check, v_qual));
    elsif p.with_check is not null then
      v_sql := format('alter policy %I on public.%I using (%s) with check (%s)',
                      p.policyname, p.tablename, v_qual, v_check);
    else
      v_sql := format('alter policy %I on public.%I using (%s)',
                      p.policyname, p.tablename, v_qual);
    end if;

    execute v_sql;
    n := n + 1;
  end loop;

  raise notice 'initPlan applique a % policy(ies)', n;
end $$;
