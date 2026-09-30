-- ═══════════════════════════════════════════════════════════════
-- Les étapes « Soumission envoyée » / « Soumission ouverte » gardent leur rôle
--
-- Les déplacements automatiques (devis envoyé → « Soumission envoyée »,
-- ouvert → « Soumission ouverte ») visent l'étape par son RÔLE
-- (`pipeline_stages.role_systeme`), pas par son nom. Constaté le 2026-09-30 :
-- 5 pipelines sur 14 n'avaient aucune étape « soumission_envoyee » — les
-- copies (`pipeline_dupliquer`, `pipeline_copier_vers_bureaux`, via
-- `_pipeline_copier`) ne recopiaient pas le rôle, et un pipeline sur mesure
-- n'en recevait jamais. Un devis envoyé n'y déplaçait rien.
--
--   1. `pipeline_role_d_apres_nom` : le rôle d'après le nom de l'étape.
--   2. `_pipeline_copier` recopie `role_systeme`.
--   3. `creer_pipeline_sur_mesure` pose le rôle d'après le nom.
--   4. Rattrapage : dans chaque pipeline sans le rôle, la première étape
--      ouverte au nom correspondant le reçoit (aucune étape créée, aucun deal
--      déplacé).
--
-- Corps des fonctions repris de la prod (pg_get_functiondef, identiques en
-- staging, 2026-09-30) ; seules les lignes commentées changent.
--
-- ROLLBACK : rejouer les deux fonctions depuis 20260925230000 / leurs
-- définitions d'avant, et `drop function public.pipeline_role_d_apres_nom(text)`.
-- Le rattrapage : update pipeline_stages set role_systeme = null where id in (…).
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_role_d_apres_nom(p_nom text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when n in ('soumission envoyee', 'soumission envoye', 'devis envoye', 'devis envoyes', 'quote sent', 'estimate sent')
      then 'soumission_envoyee'
    when n in ('soumission ouverte', 'devis ouvert', 'quote opened', 'quote viewed', 'estimate opened')
      then 'soumission_ouverte'
  end
  from (select btrim(regexp_replace(lower(translate(coalesce(p_nom, ''),
    'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç', 'AAAEEEEIIOOUUUCaaaeeeeiioouuuc')), '\s+', ' ', 'g')) as n) t;
$$;

comment on function public.pipeline_role_d_apres_nom(text) is
  'Rôle système d''une étape de pipeline d''après son nom (« Soumission envoyée » → soumission_envoyee), ou null.';

CREATE OR REPLACE FUNCTION public._pipeline_copier(p_source uuid, p_org uuid, p_nom text, p_uid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nouveau uuid;
begin
  insert into public.pipelines_ventes (org_id, name, is_default, color_mode, use_deal_probability)
  select p_org, public._pipeline_nom_libre(p_org, p_nom), false, s.color_mode, s.use_deal_probability
  from public.pipelines_ventes s
  where s.id = p_source
  returning id into v_nouveau;

  if v_nouveau is null then
    raise exception 'Pipeline introuvable';
  end if;

  insert into public.pipeline_stages (
    org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en,
    position, kind, probability, show_in_reports, show_in_pie, role_systeme
  )
  select
    p_org, v_nouveau, e.name_fr, e.name_en, e.guidance_fr, e.guidance_en,
    row_number() over (order by e.position), e.kind, e.probability,
    e.show_in_reports, e.show_in_pie,
    -- Le rôle suit l'étape : sans lui, « devis envoyé → Soumission envoyée »
    -- ne trouvait plus sa colonne dans la copie (2026-09-30).
    e.role_systeme
  from public.pipeline_stages e
  where e.pipeline_id = p_source and e.archived_at is null;

  perform public.pipeline_resynchroniser_defaut(p_org);
  return v_nouveau;
end;
$function$;

CREATE OR REPLACE FUNCTION public.creer_pipeline_sur_mesure(p_nom text, p_etapes jsonb, p_color_mode text DEFAULT 'none'::text, p_use_deal_probability boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_mode     text := coalesce(nullif(btrim(coalesce(p_color_mode, '')), ''), 'none');
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

  if v_mode not in ('none', 'dot', 'tint') then
    raise exception 'Mode de couleur inconnu : %', v_mode;
  end if;

  if jsonb_typeof(p_etapes) is distinct from 'array' then
    raise exception 'Les étapes doivent être une liste';
  end if;

  insert into public.pipelines_ventes (org_id, name, is_default, color_mode, use_deal_probability)
  values (v_org, v_nom, false, v_mode, coalesce(p_use_deal_probability, false))
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
      position, kind, probability, show_in_reports, role_systeme
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
        else nullif(v_etape ->> 'probability', '')::numeric
      end,
      coalesce((v_etape ->> 'show_in_reports')::boolean, true),
      -- Une étape nommée « Soumission envoyée » / « Soumission ouverte » reçoit
      -- son rôle : c'est ce que visent les déplacements automatiques. Une
      -- seule par pipeline (index unique) : la première l'emporte.
      case when v_kind = 'open' and not exists (
        select 1 from public.pipeline_stages x
        where x.pipeline_id = v_pipeline
          and x.role_systeme = public.pipeline_role_d_apres_nom(v_etape ->> 'nom_fr')
      ) then public.pipeline_role_d_apres_nom(v_etape ->> 'nom_fr') end
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
$function$;


-- Rattrapage des pipelines existants.
update public.pipeline_stages s
   set role_systeme = r.role
  from (
    select distinct on (e.pipeline_id, public.pipeline_role_d_apres_nom(e.name_fr))
           e.id, public.pipeline_role_d_apres_nom(e.name_fr) as role
      from public.pipeline_stages e
     where e.archived_at is null
       and e.kind = 'open'
       and e.role_systeme is null
       and public.pipeline_role_d_apres_nom(e.name_fr) is not null
       and not exists (
         select 1 from public.pipeline_stages x
          where x.pipeline_id = e.pipeline_id
            and x.archived_at is null
            and x.role_systeme = public.pipeline_role_d_apres_nom(e.name_fr)
       )
     order by e.pipeline_id, public.pipeline_role_d_apres_nom(e.name_fr), e.position
  ) r
 where s.id = r.id;

commit;
