-- ═══════════════════════════════════════════════════════════════
-- Reprise des deals existants dans le nouveau pipeline
--
-- Plutôt que de laisser l'ancien board derrière et de repartir à zéro, on
-- reprend ce qu'il contient : un client qui ouvre le nouveau pipeline y
-- retrouve ses deals, pas un écran vide.
--
-- État constaté en production le 2026-09-23 : 23 deals actifs, tous dans une
-- seule organisation, aucun rattaché à un pin, un devis ou une job. Les
-- étapes en usage sont `new_prospect` (20), `no_response` (2), `quote_sent`
-- (1) — aucun gagné ni perdu.
--
-- CORRESPONDANCE DES ÉTAPES. L'ancien vocabulaire est figé dans une CHECK ;
-- le nouveau est libre et renommable. On fait correspondre par RANG, jamais
-- par nom — c'est toute la règle du chantier :
--   new_prospect  → 1re étape ouverte
--   no_response   → 2e étape ouverte (relance)
--   quote_sent    → 3e étape ouverte (soumission envoyée)
--   closed_won    → l'étape `won`
--   closed_lost   → l'étape `lost`
-- Si une organisation a moins d'étapes que ça, on retombe sur la dernière
-- étape ouverte disponible : personne ne perd un deal parce qu'il manque une
-- colonne.
--
-- IDEMPOTENTE : `external_id` porte l'identifiant de l'ancien deal, et
-- l'index unique `(org_id, source, external_id)` empêche tout doublon. On
-- peut donc rejouer ce fichier sans rien casser.
--
-- L'ancienne table n'est PAS touchée : `pipeline_deals` garde ses lignes, le
-- board D2D continue de tourner. Le retrait viendra quand la Vente Map et
-- les Commissions auront été rebranchées.
-- ═══════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_org      uuid;
  v_pipeline uuid;
  v_ouvertes uuid[];
  v_won      uuid;
  v_lost     uuid;
  v_cible    uuid;
  v_client   uuid;
  v_deal     record;
  v_repris   integer := 0;
  v_ignores  integer := 0;
begin
  for v_org in
    select distinct org_id from public.pipeline_deals where deleted_at is null
  loop
    -- Le pipeline de l'organisation ; on le sème s'il manque.
    select id into v_pipeline
    from public.pipelines_ventes
    where org_id = v_org and is_default
    limit 1;

    if v_pipeline is null then
      v_pipeline := public.seed_pipeline_ventes(v_org, 'generique');
    end if;

    select array_agg(id order by position) into v_ouvertes
    from public.pipeline_stages
    where pipeline_id = v_pipeline and kind = 'open' and archived_at is null;

    select id into v_won from public.pipeline_stages
    where pipeline_id = v_pipeline and kind = 'won' and archived_at is null limit 1;

    select id into v_lost from public.pipeline_stages
    where pipeline_id = v_pipeline and kind = 'lost' and archived_at is null limit 1;

    if v_ouvertes is null or array_length(v_ouvertes, 1) = 0 then
      raise warning 'Organisation % : aucune étape ouverte, deals non repris', v_org;
      continue;
    end if;

    for v_deal in
      select d.* from public.pipeline_deals d
      where d.org_id = v_org and d.deleted_at is null
      order by d.created_at
    loop
      -- Le contact : `lead_id` contient un id de CLIENT depuis la migration
      -- 20260705000000 (la table `leads` n'existe plus).
      v_client := coalesce(v_deal.client_id, v_deal.lead_id);

      if v_client is null then
        v_ignores := v_ignores + 1;
        continue;
      end if;

      -- Le client doit exister et être vivant, sinon la FK composite refuse.
      if not exists (
        select 1 from public.clients
        where id = v_client and org_id = v_org and deleted_at is null
      ) then
        v_ignores := v_ignores + 1;
        continue;
      end if;

      -- Correspondance par RANG, avec repli sur la dernière étape ouverte.
      v_cible := case lower(coalesce(v_deal.stage, 'new_prospect'))
        when 'closed_won'  then v_won
        when 'closed_lost' then v_lost
        when 'no_response' then coalesce(v_ouvertes[2], v_ouvertes[array_length(v_ouvertes, 1)])
        when 'quote_sent'  then coalesce(v_ouvertes[3], v_ouvertes[array_length(v_ouvertes, 1)])
        else v_ouvertes[1]
      end;

      v_cible := coalesce(v_cible, v_ouvertes[1]);

      insert into public.deals (
        org_id, pipeline_id, stage_id, client_id,
        assigned_user_id, assigned_at,
        source, external_id,
        job_id, quote_id, pin_id, field_rep_id,
        last_activity_at, stage_entered_at,
        won_at, lost_at, lost_reason,
        raw_payload, created_by, created_at
      )
      values (
        v_org, v_pipeline, v_cible, v_client,
        v_deal.rep_id,
        case when v_deal.rep_id is not null then v_deal.created_at end,
        -- `source` marque la provenance ; `external_id` rend la reprise
        -- idempotente et garde le lien vers l'ancienne ligne.
        coalesce(nullif(v_deal.source, ''), 'reprise'),
        v_deal.id::text,
        v_deal.job_id, v_deal.quote_id, v_deal.pin_id, v_deal.rep_id,
        coalesce(v_deal.updated_at, v_deal.created_at),
        coalesce(v_deal.updated_at, v_deal.created_at),
        v_deal.won_at, v_deal.lost_at, v_deal.lost_reason,
        jsonb_build_object(
          'repris_de', 'pipeline_deals',
          'ancien_id', v_deal.id,
          'ancienne_etape', v_deal.stage,
          'titre', v_deal.title,
          'notes', v_deal.notes
        ),
        v_deal.created_by,
        v_deal.created_at
      )
      on conflict (org_id, source, external_id) where external_id is not null and deleted_at is null
      do nothing;

      if found then
        v_repris := v_repris + 1;
      end if;
    end loop;
  end loop;

  raise notice 'Reprise terminée : % deal(s) repris, % ignoré(s) (sans contact valide)', v_repris, v_ignores;
end
$$;

commit;
