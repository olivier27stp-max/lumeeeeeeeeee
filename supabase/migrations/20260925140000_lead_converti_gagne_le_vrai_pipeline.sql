-- ═══════════════════════════════════════════════════════════════
-- Créer une job depuis un lead doit gagner le deal du VRAI pipeline
--
-- LE DÉFAUT. `/api/leads/convert-to-job` marquait le deal gagné dans
-- `pipeline_deals` — l'ANCIEN pipeline D2D — et jamais dans `deals`, celui
-- que la page « Ventes » (/ventes) affiche.
--
-- Mesuré en production :
--
--     pipeline_deals : 123 deals, 98 gagnés, dernier le 2026-08-21
--     deals          :  26 deals,  1 gagné,  dernier le 2026-09-25
--
-- L'ancien pipeline est mort depuis cinq semaines ; le nouveau est vivant.
-- Autrement dit : chaque vente conclue depuis un lead gagnait une table que
-- plus personne ne regarde, pendant que le pipeline affiché restait vide.
-- Rien ne plantait — la vente disparaissait, c'est tout.
--
-- CE QU'ON NE FAIT PAS. On ne retire pas l'écriture dans `pipeline_deals` :
-- 22 fichiers la lisent encore (Tableau de bord, Clients, Classement,
-- Commissions, rapports terrain). La couper réparerait une page et en
-- casserait quatre. Les deux pipelines coexistent — c'est documenté dans
-- App.tsx — donc on écrit dans les DEUX.
--
-- CE QUE LA FONCTION FAIT. Pour le client d'un lead converti :
--   · s'il a déjà un deal vivant dans le pipeline de ventes → on le déplace
--     vers l'étape « Gagné » et on y rattache la job ;
--   · sinon → on crée le deal, déjà gagné et rattaché.
-- Dans les deux cas le deal porte la job : le badge « Job à créer », qui est
-- dérivé de (kind = 'won' ET job_id IS NULL), ne s'affiche donc pas — la job
-- existe, il n'y a rien à créer.
--
-- Idempotente : rappelée avec la même job, elle ne crée pas de second deal.
--
-- ROLLBACK :
--   drop function if exists public.lead_converti_gagne_pipeline(uuid, uuid, uuid);
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.lead_converti_gagne_pipeline(
  p_org_id uuid,
  p_client_id uuid,
  p_job_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pipeline uuid;
  v_won uuid;
  v_deal uuid;
begin
  if p_org_id is null or p_client_id is null or p_job_id is null then
    return null;
  end if;

  -- Déjà fait ? On ressort le deal tel quel : rappeler la conversion ne doit
  -- pas créer un second deal pour la même job.
  select id into v_deal
  from public.deals
  where org_id = p_org_id and job_id = p_job_id and deleted_at is null
  limit 1;
  if v_deal is not null then
    return v_deal;
  end if;

  -- Le pipeline par défaut de l'organisation, sinon le plus ancien : une org
  -- a toujours un défaut en production, mais s'en remettre à ça seul ferait
  -- échouer la conversion en silence le jour où ce n'est plus vrai.
  select id into v_pipeline
  from public.pipelines_ventes
  where org_id = p_org_id
  order by is_default desc, created_at asc
  limit 1;
  if v_pipeline is null then
    return null;  -- Pas de pipeline de ventes : rien à gagner, ce n'est pas une erreur.
  end if;

  select id into v_won
  from public.pipeline_stages
  where pipeline_id = v_pipeline and kind = 'won' and archived_at is null
  order by position asc
  limit 1;
  if v_won is null then
    return null;
  end if;

  -- Un deal vivant pour ce client ? On le fait gagner plutôt que d'en ouvrir
  -- un second : la vente est la même, et deux cartes pour un client feraient
  -- compter la vente en double dans les prévisions.
  select id into v_deal
  from public.deals
  where org_id = p_org_id and client_id = p_client_id and deleted_at is null
  order by created_at desc
  limit 1;

  if v_deal is not null then
    update public.deals
    set stage_id = v_won,
        job_id = p_job_id,
        won_at = coalesce(won_at, now()),
        stage_entered_at = now(),
        last_activity_at = now(),
        updated_at = now()
    where id = v_deal;
  else
    insert into public.deals (
      org_id, pipeline_id, stage_id, client_id, source, job_id, won_at
    )
    values (
      p_org_id, v_pipeline, v_won, p_client_id, 'lead', p_job_id, now()
    )
    returning id into v_deal;
  end if;

  return v_deal;
end;
$fn$;

comment on function public.lead_converti_gagne_pipeline(uuid, uuid, uuid) is
  'Convertir un lead en job gagne le deal du pipeline de ventes (`deals`) : sans ça la vente n''était inscrite que dans l''ancien `pipeline_deals`, invisible dans /ventes (2026-09-25).';

-- Appelée par le serveur (service_role) uniquement : le navigateur passe par
-- l'API, jamais par cette fonction. `security definer` sans révocation
-- nommée resterait exécutable par `anon` et `authenticated` — les defaults
-- Supabase accordent EXECUTE à PUBLIC.
revoke all on function public.lead_converti_gagne_pipeline(uuid, uuid, uuid) from public;
revoke all on function public.lead_converti_gagne_pipeline(uuid, uuid, uuid) from anon;
revoke all on function public.lead_converti_gagne_pipeline(uuid, uuid, uuid) from authenticated;
grant execute on function public.lead_converti_gagne_pipeline(uuid, uuid, uuid) to service_role;

commit;
