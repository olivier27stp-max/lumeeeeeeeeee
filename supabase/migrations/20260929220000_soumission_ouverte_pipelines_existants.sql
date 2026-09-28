-- ═══════════════════════════════════════════════════════════════
-- « Soumission ouverte » dans les pipelines par défaut EXISTANTS
--
-- ⚠ TOUCHE DES DONNÉES EXISTANTES (décale les positions des étapes) : ne
-- s'applique EN PROD qu'avec l'accord explicite de Rafba (mission du
-- 2026-09-28). Appliquée sur staging pour les tests.
--
-- Pour chaque pipeline PAR DÉFAUT actif :
--   · on cherche UNE ET UNE SEULE étape ouverte nommée « Soumission
--     envoyée », « Estimation envoyée » ou « Devis envoyé » (casse et
--     espaces ignorés) ;
--   · on insère juste après « Soumission ouverte » (« Estimation ouverte »
--     si l'étape parle d'estimation), probabilité = milieu de ses deux
--     voisines ; les étapes suivantes reculent d'un rang ;
--   · on pose les rôles système (soumission_envoyee / soumission_ouverte).
-- On NE TOUCHE PAS un pipeline :
--   · sans étape « envoyée » reconnaissable, ou avec plusieurs (ambigu) ;
--   · qui a déjà un rôle posé, ou déjà une étape « … ouverte ».
-- La liste des pipelines laissés de côté se lit avec la requête du rapport.
--
-- ROLLBACK (par pipeline) : archiver l'étape de rôle soumission_ouverte si
-- elle est vide, puis remettre les rôles à null :
--   update pipeline_stages set archived_at = now() where role_systeme = 'soumission_ouverte'
--     and not exists (select 1 from deals d where d.stage_id = pipeline_stages.id and d.deleted_at is null);
--   update pipeline_stages set role_systeme = null where role_systeme is not null;
-- ═══════════════════════════════════════════════════════════════

begin;

do $mig$
declare
  p record;
  v_envoyee record;
  v_suivante record;
  v_nb integer;
  v_nom_fr text;
  v_nom_en text;
  v_proba numeric;
begin
  for p in
    select id, org_id from public.pipelines_ventes
    where is_default and archived_at is null
  loop
    -- Déjà traité (ou rôles posés à la main) : on n'y touche plus.
    if exists (select 1 from public.pipeline_stages s
               where s.pipeline_id = p.id and s.archived_at is null
                 and (s.role_systeme is not null
                      or lower(btrim(s.name_fr)) in ('soumission ouverte', 'estimation ouverte', 'devis ouvert'))) then
      continue;
    end if;

    select count(*) into v_nb from public.pipeline_stages s
    where s.pipeline_id = p.id and s.archived_at is null and s.kind = 'open'
      and lower(btrim(s.name_fr)) in ('soumission envoyée', 'estimation envoyée', 'devis envoyé');
    if v_nb <> 1 then
      continue;  -- introuvable ou ambigu : on s'abstient
    end if;

    select id, name_fr, position, probability into v_envoyee from public.pipeline_stages s
    where s.pipeline_id = p.id and s.archived_at is null and s.kind = 'open'
      and lower(btrim(s.name_fr)) in ('soumission envoyée', 'estimation envoyée', 'devis envoyé');

    select id, position, probability, kind into v_suivante from public.pipeline_stages s
    where s.pipeline_id = p.id and s.archived_at is null and s.position > v_envoyee.position
    order by s.position limit 1;

    if lower(v_envoyee.name_fr) like 'estimation%' then
      v_nom_fr := 'Estimation ouverte'; v_nom_en := 'Estimate opened';
    else
      v_nom_fr := 'Soumission ouverte'; v_nom_en := 'Quote opened';
    end if;

    v_proba := case
      when v_envoyee.probability is not null and v_suivante.probability is not null
        then round((v_envoyee.probability + v_suivante.probability) / 2.0, 2)
      else v_envoyee.probability
    end;

    -- Décaler les suivantes en deux temps (index partiel unique sur la position).
    update public.pipeline_stages set position = position + 100000
    where pipeline_id = p.id and archived_at is null and position > v_envoyee.position;
    update public.pipeline_stages set position = position - 99999
    where pipeline_id = p.id and archived_at is null and position > 100000;

    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind, probability, role_systeme)
    values (p.org_id, p.id, v_nom_fr, v_nom_en,
      'Le client vient d''ouvrir le document : appelle maintenant, pendant qu''il a le prix sous les yeux.',
      'The client just opened it: call now, while the price is in front of them.',
      v_envoyee.position + 1, 'open', v_proba, 'soumission_ouverte');

    update public.pipeline_stages set role_systeme = 'soumission_envoyee' where id = v_envoyee.id;
  end loop;
end
$mig$;

commit;
