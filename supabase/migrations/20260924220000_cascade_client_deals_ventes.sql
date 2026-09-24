-- ═══════════════════════════════════════════════════════════════
-- Supprimer un client doit emporter SES DEUX pipelines
--
-- Il y a deux tables de deals, et ce n'est pas une erreur :
--   · `pipeline_deals` — le pipeline porte-à-porte (étapes figées
--     new_prospect → closed_won), utilisé par le Tableau de bord, la page
--     Clients et le D2D ;
--   · `deals`          — le pipeline de ventes de la page /ventes, avec
--     ses étapes configurables.
--
-- Seule la PREMIÈRE était cascadée à la suppression d'un client. Résultat :
-- on supprimait un client, et sa carte restait sur le board des ventes, son
-- montant restait dans les prévisions, et son deal apparaissait encore dans
-- les statistiques. Le client, lui, était introuvable — la carte affichait
-- un nom qui n'existait plus.
--
-- Trois chemins mènent à la suppression d'un client ; ils doivent se
-- comporter pareil, sinon supprimer depuis Lumi ne ferait pas la même chose
-- que supprimer depuis l'écran :
--   1. `POST /api/clients/soft-delete`  → corrigé dans server/routes/leads.ts
--   2. `soft_delete_client()`           → corrigé ici
--   3. le trigger `trg_clients_cascade_pipeline_soft_delete` → corrigé ici,
--      c'est le filet : il rattrape TOUTE écriture directe sur `clients`,
--      d'où qu'elle vienne.
--
-- Aucun deal orphelin n'existe aujourd'hui (vérifié sur prod et staging) :
-- ce correctif empêche le problème d'arriver, il n'a rien à réparer.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Le trigger de cascade ────────────────────────────────────
--
-- C'est le filet de sécurité : il s'applique à toute mise à jour de
-- `clients.deleted_at`, y compris un UPDATE direct en SQL.
create or replace function public.pipeline_deals_cascade_client_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    -- Le pipeline porte-à-porte.
    update public.pipeline_deals
    set deleted_at = now(), updated_at = now()
    where client_id = new.id
      and deleted_at is null;

    -- Le pipeline de ventes (/ventes). Sans lui, la carte survit au client.
    update public.deals
    set deleted_at = now(), updated_at = now()
    where client_id = new.id
      and deleted_at is null;
  end if;
  return new;
end;
$fn$;

comment on function public.pipeline_deals_cascade_client_soft_delete() is
  'Supprimer un client emporte ses deals dans LES DEUX pipelines : pipeline_deals (porte-à-porte) et deals (page /ventes). Filet de sécurité pour toute écriture directe sur clients.deleted_at.';

-- ── 2. Le RPC de suppression ────────────────────────────────────
--
-- Utilisé par Lumi, le MCP et les scripts. Il renvoie un décompte que
-- l'appelant affiche : il doit donc compter les deux tables, sinon on
-- annonce « 0 deal supprimé » après en avoir supprimé trois.
create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_now timestamptz := now();
  v_client integer := 0;
  v_jobs integer := 0;
  v_pipeline_deals integer := 0;
  v_deals_ventes integer := 0;
begin
  if v_uid = '00000000-0000-0000-0000-000000000000'::uuid then
    null;
  elsif not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = v_now, updated_at = v_now
  where id = p_client_id and org_id = p_org_id and deleted_at is null;
  get diagnostics v_client = row_count;

  update public.jobs
  set deleted_at = v_now, updated_at = v_now
  where client_id = p_client_id and org_id = p_org_id and deleted_at is null;
  get diagnostics v_jobs = row_count;

  update public.pipeline_deals
  set deleted_at = v_now, updated_at = v_now
  where client_id = p_client_id and org_id = p_org_id and deleted_at is null;
  get diagnostics v_pipeline_deals = row_count;

  -- Le pipeline de ventes. Le trigger ci-dessus l'aurait déjà fait, mais on
  -- ne s'appuie pas dessus : le décompte doit être juste même si quelqu'un
  -- désactive le trigger, et `row_count` vaudra simplement 0 si c'est déjà
  -- fait.
  update public.deals
  set deleted_at = v_now, updated_at = v_now
  where client_id = p_client_id and org_id = p_org_id and deleted_at is null;
  get diagnostics v_deals_ventes = row_count;

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', 0,
    -- Les deux pipelines réunis : l'appelant veut savoir combien de cartes
    -- ont disparu, pas dans quelle table elles vivaient.
    'pipeline_deals', v_pipeline_deals + v_deals_ventes,
    'other_rows', 0
  );
end;
$fn$;

comment on function public.soft_delete_client(uuid, uuid) is
  'Soft-delete d''un client et de ce qui en dépend : jobs, deals du porte-à-porte ET deals de la page /ventes. Réservé aux propriétaires et administrateurs.';

commit;
