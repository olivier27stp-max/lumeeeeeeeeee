-- ============================================================================
-- export_user_data() : audit_events.org_id codé en dur à NULL
-- ============================================================================
-- DÉCOUVERT en testant l'export DSR réparé par 20260751101900 :
--   export_user_data -> ERROR: null value in column "org_id" of relation
--                              "audit_events" violates not-null constraint
--
-- CAUSE
-- La fonction journalise son propre appel avec `values (null, v_caller, ...)`.
-- Tant que audit_events.org_id était nullable, la ligne passait — mais elle
-- était alors inexploitable : un événement d'audit sans org n'est rattachable
-- à aucun tenant, donc invisible dans toute consultation filtrée par org.
--
-- La migration 20260751100400 (org_id NOT NULL) a transformé ce défaut
-- silencieux en échec franc. C'est le comportement souhaité — mieux vaut une
-- erreur qu'un journal d'audit qui se remplit de lignes orphelines — mais il
-- faut maintenant fournir la vraie valeur.
--
-- CORRECTIF
-- Résoudre l'org de l'utilisateur exporté via memberships. Si l'utilisateur
-- appartient à plusieurs orgs, on prend celle du caller quand elle est connue
-- (cas admin exportant pour un membre), sinon la première de l'utilisateur.
-- Si aucune org n'existe (compte orphelin), on n'insère pas de ligne d'audit
-- plutôt que d'échouer : l'export lui-même est un droit légal et ne doit pas
-- être bloqué par sa propre journalisation.
-- ============================================================================

create or replace function public.export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
  v_org    uuid;
begin
  -- Appel serveur (service_role) : auth.uid() est NULL et l'autorisation est
  -- faite en amont dans server/routes/dsr.ts. Appel utilisateur : la
  -- verification v_caller != p_user_id ci-dessous s'applique normalement.
  if v_caller is not null and v_caller <> p_user_id then
    if not exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = v_caller
        and m2.user_id = p_user_id
        and public.has_org_admin_role(v_caller, m1.org_id)
    ) then
      raise exception 'Not authorized to export this user data' using errcode = '42501';
    end if;
  end if;

  select jsonb_build_object(
    'exported_at',       now(),
    'user_id',           p_user_id,
    'profile',           (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
    'memberships',       (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.memberships m where m.user_id = p_user_id),
    'consents',          (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb) from public.consents c where c.subject_type = 'user' and c.subject_id = p_user_id),
    'audit_events_as_actor', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb) from public.audit_events a where a.actor_id = p_user_id),
    'dsar_requests',     (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb) from public.dsar_requests d where d.requested_by = p_user_id or (d.subject_type='user' and d.subject_id = p_user_id))
  ) into v_result;

  -- N3.1 — org_id etait code en dur a NULL : la ligne d'audit n'etait
  -- rattachee a aucun tenant, donc invisible dans toute consultation filtree.
  select m.org_id into v_org
    from public.memberships m
   where m.user_id = p_user_id
     and (v_caller is null or m.org_id in (
           select m2.org_id from public.memberships m2 where m2.user_id = v_caller))
   order by m.created_at
   limit 1;

  if v_org is null then
    select m.org_id into v_org
      from public.memberships m
     where m.user_id = p_user_id
     order by m.created_at
     limit 1;
  end if;

  -- Compte sans aucune org : on n'echoue pas. L'export est un droit legal
  -- (Loi 25 art. 27), il ne doit pas dependre de sa propre journalisation.
  if v_org is not null then
    insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_org, v_caller, 'dsr_export', 'user', p_user_id,
            jsonb_build_object('requested_by', v_caller));
  end if;

  return v_result;
end $$;

comment on function public.export_user_data(uuid) is
  'Loi 25 art. 27 / RGPD art. 20 — export de portabilite d''un utilisateur. '
  'Garde d''appartenance sur appel utilisateur ; sur appel serveur '
  '(auth.uid() NULL) l''autorisation est faite dans server/routes/dsr.ts.';

-- ----------------------------------------------------------------------------
-- Verification.
-- ----------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_res  jsonb;
begin
  select user_id into v_user from public.memberships limit 1;
  if v_user is null then
    raise notice 'Aucun membership pour tester.';
    return;
  end if;

  v_res := public.export_user_data(v_user);

  if v_res is null or v_res->>'user_id' is null then
    raise exception 'export_user_data ne retourne rien.';
  end if;

  raise notice 'Export utilisateur fonctionnel (% octets).', length(v_res::text);
end $$;
