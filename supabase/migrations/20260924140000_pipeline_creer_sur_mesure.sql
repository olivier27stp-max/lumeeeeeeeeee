-- ═══════════════════════════════════════════════════════════════
-- Créer un pipeline avec SES étapes
--
-- `creer_pipeline_ventes` part d'un modèle figé (générique, nettoyage,
-- construction). C'est le bon défaut pour démarrer, et ça reste. Mais
-- l'écran de création demandé laisse écrire les étapes une par une, avec
-- leur probabilité — un pipeline de contrats saisonniers n'a pas le même
-- parcours qu'un pipeline de soumissions résidentielles, et choisir entre
-- trois modèles ne remplace pas de pouvoir l'écrire.
--
-- CE QUE CETTE FONCTION GARANTIT, et que le client ne peut pas garantir
-- seul : les deux étapes terminales. Un pipeline sans étape « gagné » rend
-- le taux de closing incalculable et le badge « Job à créer » impossible ;
-- sans étape « perdue », la raison de perte n'a nulle part où aller. Si
-- l'appelant ne les fournit pas, elles sont AJOUTÉES — on ne crée jamais un
-- pipeline qui ne peut pas se terminer.
--
-- L'organisation vient de la session, jamais d'un paramètre : c'est la même
-- porte étroite que `pipeline_creer_deal`.
-- ═══════════════════════════════════════════════════════════════

begin;

drop function if exists public.creer_pipeline_sur_mesure(text, jsonb);

create function public.creer_pipeline_sur_mesure(
  p_nom    text,
  -- [{ "nom_fr": "...", "nom_en": "...", "kind": "open|won|lost",
  --    "probability": 20, "show_in_reports": true }, ...]
  p_etapes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := current_org_id();
  v_uid      uuid := auth.uid();
  v_pipeline uuid;
  v_nom      text := btrim(coalesce(p_nom, ''));
  v_etape    jsonb;
  v_position integer := 0;
  v_a_gagne  boolean := false;
  v_a_perdu  boolean := false;
  v_kind     text;
  v_nb       integer := 0;
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;

  -- Créer un pipeline est un geste d'administration : il s'impose à toute
  -- l'équipe et décide où atterrissent les leads.
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent créer un pipeline';
  end if;

  if v_nom = '' then
    raise exception 'Le nom du pipeline est requis';
  end if;

  if jsonb_typeof(p_etapes) is distinct from 'array' then
    raise exception 'Les étapes doivent être une liste';
  end if;

  insert into public.pipelines_ventes (org_id, name, is_default)
  values (v_org, v_nom, false)
  returning id into v_pipeline;

  for v_etape in select * from jsonb_array_elements(p_etapes)
  loop
    v_kind := coalesce(v_etape ->> 'kind', 'open');
    if v_kind not in ('open', 'won', 'lost') then
      raise exception 'Type d''étape inconnu : %', v_kind;
    end if;
    if btrim(coalesce(v_etape ->> 'nom_fr', '')) = '' then
      raise exception 'Chaque étape doit avoir un nom';
    end if;

    v_position := v_position + 1;
    v_nb := v_nb + 1;
    if v_kind = 'won'  then v_a_gagne := true; end if;
    if v_kind = 'lost' then v_a_perdu := true; end if;

    insert into public.pipeline_stages (
      org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en,
      position, kind, probability, show_in_reports
    )
    values (
      v_org, v_pipeline,
      btrim(v_etape ->> 'nom_fr'),
      coalesce(nullif(btrim(coalesce(v_etape ->> 'nom_en', '')), ''), btrim(v_etape ->> 'nom_fr')),
      coalesce(v_etape ->> 'guidance_fr', ''),
      coalesce(v_etape ->> 'guidance_en', ''),
      v_position,
      v_kind::public.pipeline_stage_kind,
      -- Gagné et perdu valent 100 % et 0 % : des faits, pas des estimations.
      case v_kind
        when 'won'  then 100
        when 'lost' then 0
        else nullif(v_etape ->> 'probability', '')::integer
      end,
      coalesce((v_etape ->> 'show_in_reports')::boolean, true)
    );
  end loop;

  if v_nb = 0 then
    raise exception 'Un pipeline a besoin d''au moins une étape';
  end if;

  -- Les deux étapes terminales, ajoutées si elles manquent. Un pipeline
  -- qu'on ne peut pas terminer casse le closing, le badge « Job à créer » et
  -- la raison de perte — c'est un état dont on ne sort plus.
  if not v_a_gagne then
    v_position := v_position + 1;
    insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
    values (v_org, v_pipeline, 'Gagné', 'Won', v_position, 'won', 100);
  end if;

  if not v_a_perdu then
    v_position := v_position + 1;
    insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
    values (v_org, v_pipeline, 'Perdu', 'Lost', v_position, 'lost', 0);
  end if;

  return v_pipeline;
end;
$fn$;

revoke all on function public.creer_pipeline_sur_mesure(text, jsonb) from public, anon;
grant execute on function public.creer_pipeline_sur_mesure(text, jsonb) to authenticated;

comment on function public.creer_pipeline_sur_mesure(text, jsonb) is
  'Crée un pipeline avec ses propres étapes. L''organisation vient de la session, jamais d''un paramètre. Les étapes « gagné » et « perdu » sont ajoutées si elles manquent : un pipeline qu''on ne peut pas terminer casse le closing et la raison de perte.';

commit;
