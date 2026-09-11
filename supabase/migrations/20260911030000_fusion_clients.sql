-- Fusion de deux fiches clients en double (« deux Marie Tremblay identiques »).
-- ─────────────────────────────────────────────────────────────────────────
-- Tout ce qui pointe sur la fiche absorbée (jobs, devis, factures, paiements,
-- messages, conversations, propriétés, contrats, sondages, tags…, 26 colonnes
-- de clés étrangères relevées sur la prod le 2026-09-11) est réassigné à la
-- fiche gardée, dans UNE transaction ; les champs vides de la fiche gardée
-- sont complétés par ceux de l'absorbée ; l'absorbée est effacée en douceur
-- (deleted_at) — jamais supprimée. Une contrainte d'unicité (même tag deux
-- fois…) fait sauter la ligne en conflit, pas la fusion.
--
-- Appelable par un membre de l'org qui a la permission clients.delete (page
-- Rôles), ou par le serveur (service_role). SECURITY DEFINER : les tables
-- touchées portent chacune une RLS qui, sinon, bloquerait l'une ou l'autre.
create or replace function public.fusionner_clients(p_org uuid, p_garder uuid, p_absorber uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_garder clients%rowtype;
  v_absorber clients%rowtype;
  v_cible record;
  v_n int;
  v_total int := 0;
  v_detail jsonb := '{}'::jsonb;
  v_ignores int := 0;
  v_row record;
begin
  if p_garder = p_absorber then
    raise exception 'fusionner_clients: les deux fiches sont identiques';
  end if;
  -- Autorisation : membre de l'org avec clients.delete, ou service_role (auth.uid() null).
  if v_uid is not null and not public.member_has_permission(v_uid, p_org, 'clients.delete') then
    raise exception 'fusionner_clients: permission clients.delete requise' using errcode = '42501';
  end if;
  select * into v_garder from clients where id = p_garder and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à garder introuvable'; end if;
  select * into v_absorber from clients where id = p_absorber and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à absorber introuvable'; end if;

  -- Toutes les colonnes qui référencent clients(id) — relues dans le catalogue,
  -- donc une future table qui pointe sur clients est prise sans retoucher ici.
  for v_cible in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.clients'::regclass
       and a.attname <> 'org_id'
     group by 1, 2
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', v_cible.tbl, v_cible.col, v_cible.col) using p_garder, p_absorber;
      get diagnostics v_n = row_count;
    exception when unique_violation then
      -- Conflit d'unicité (même tag, même profil…) : ligne par ligne, les doublons restent sur l'absorbée.
      v_n := 0;
      for v_row in execute format('select ctid from %s where %I = $1', v_cible.tbl, v_cible.col) using p_absorber loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', v_cible.tbl, v_cible.col) using p_garder, v_row.ctid;
          v_n := v_n + 1;
        exception when unique_violation then
          v_ignores := v_ignores + 1;
        end;
      end loop;
    end;
    if v_n > 0 then
      v_detail := v_detail || jsonb_build_object(v_cible.tbl || '.' || v_cible.col, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  -- Compléter les trous de la fiche gardée avec ce que l'absorbée savait.
  update clients set
    email      = coalesce(nullif(email, ''), v_absorber.email),
    phone      = coalesce(nullif(phone, ''), v_absorber.phone),
    company    = coalesce(nullif(company, ''), v_absorber.company),
    address    = coalesce(nullif(address, ''), v_absorber.address),
    city       = coalesce(nullif(city, ''), v_absorber.city),
    notes      = case
                   when coalesce(v_absorber.notes, '') = '' then notes
                   when coalesce(notes, '') = '' then v_absorber.notes
                   else notes || E'\n' || v_absorber.notes
                 end,
    updated_at = now()
  where id = p_garder;

  update clients set deleted_at = now(), updated_at = now() where id = p_absorber;

  return jsonb_build_object(
    'merged', true, 'kept_client_id', p_garder, 'absorbed_client_id', p_absorber,
    'rows_reassigned', v_total, 'rows_skipped_unique', v_ignores, 'detail', v_detail
  );
end;
$$;

comment on function public.fusionner_clients(uuid, uuid, uuid) is
  'Fusionne deux fiches clients : réassigne toute clé étrangère vers la fiche gardée (catalogue relu), complète ses champs vides, efface en douceur l''absorbée. clients.delete requis (ou service_role).';

revoke all on function public.fusionner_clients(uuid, uuid, uuid) from public, anon;
grant execute on function public.fusionner_clients(uuid, uuid, uuid) to authenticated, service_role;
