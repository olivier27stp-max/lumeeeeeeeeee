-- ═══════════════════════════════════════════════════════════════
-- Réordonnancement des étapes en une transaction
--
-- Permuter deux étapes, c'est écrire deux positions qui se croisent. La
-- contrainte `pipeline_stages_position_unique` est DEFERRABLE précisément
-- pour ça : les doublons intermédiaires sont tolérés jusqu'au COMMIT.
--
-- Mais PostgREST envoie chaque `update` dans SA PROPRE transaction : le
-- report ne sert alors à rien, et la première écriture échoue sur la
-- position déjà prise. D'où cette fonction — tout le réordonnancement dans
-- une seule transaction.
--
-- SECURITY INVOKER : c'est la RLS de `pipeline_stages` qui décide, et elle
-- réserve l'écriture aux administrateurs. Une étape d'une autre organisation
-- est simplement invisible, donc non modifiable.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_reordonner_etapes(p_ordre jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_n integer;
begin
  if p_ordre is null or jsonb_typeof(p_ordre) <> 'array' then
    raise exception 'p_ordre doit être un tableau [{id, position}]';
  end if;

  -- La contrainte est reportée à la fin de CETTE transaction : les positions
  -- peuvent se croiser le temps des écritures.
  set constraints public.pipeline_stages_position_unique deferred;

  update public.pipeline_stages s
  set position = (e.value ->> 'position')::integer,
      updated_at = now()
  from jsonb_array_elements(p_ordre) as e
  where s.id = (e.value ->> 'id')::uuid;

  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Aucune étape modifiée : vérifier les identifiants et les droits';
  end if;
end;
$fn$;

comment on function public.pipeline_reordonner_etapes(jsonb) is
  'Réécrit les positions des étapes en UNE transaction, pour que la contrainte d''unicité différée puisse jouer son rôle — PostgREST enverrait sinon chaque update séparément et la permutation échouerait.';

commit;
