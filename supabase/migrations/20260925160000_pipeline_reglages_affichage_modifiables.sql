-- ═══════════════════════════════════════════════════════════════
-- Les réglages d'affichage d'un pipeline deviennent modifiables
--
-- LE DÉFAUT. `color_mode` et `use_deal_probability` ne se posaient qu'à la
-- CRÉATION (`creer_pipeline_sur_mesure`). Après coup, plus aucun chemin ne
-- permettait de les changer : il fallait recréer le pipeline — donc perdre
-- ses deals — pour passer d'un affichage gris à un affichage teinté.
--
-- Deux réglages que GoHighLevel met en haut de sa page « Pipelines », et que
-- le nôtre stockait sans jamais laisser y revenir.
--
-- CE QU'ELLE FAIT. Écrit les deux champs sur un pipeline de l'organisation
-- courante. Rien d'autre : ni étapes, ni deals, ni nom.
--
-- Un paramètre laissé à NULL n'est PAS écrit — on peut changer la couleur
-- sans toucher au mode de probabilité, et inversement. Sans ça, l'écran
-- devrait renvoyer les deux valeurs à chaque fois et écraserait celle qu'un
-- autre onglet vient de changer.
--
-- GARDE. `has_org_admin_role` — LA MÊME que la policy d'écriture existante
-- (`pipelines_ventes_admin_write`). Cette fonction est `security definer` :
-- sans ce contrôle explicite elle contournerait la RLS et n'importe quel
-- membre pourrait reconfigurer le pipeline de son organisation.
--
-- On réutilise la garde en place plutôt que d'en inventer une : deux règles
-- pour un même geste finissent par diverger.
--
-- ROLLBACK :
--   drop function if exists public.pipeline_definir_affichage(uuid, text, boolean);
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_definir_affichage(
  p_pipeline_id uuid,
  p_color_mode text default null,
  p_use_deal_probability boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid;
begin
  select org_id into v_org
  from public.pipelines_ventes
  where id = p_pipeline_id;

  if v_org is null then
    raise exception 'Ce pipeline n''existe pas.' using errcode = 'P0002';
  end if;

  -- La même garde que la policy d'écriture de la table.
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Tu n''as pas le droit de modifier ce pipeline.' using errcode = '42501';
  end if;

  -- Bornes : `color_mode` est un texte libre en base. Une valeur inconnue
  -- ferait retomber l'affichage sur un défaut silencieux — on refuse plutôt.
  if p_color_mode is not null
     and p_color_mode not in ('none', 'dot', 'tint') then
    raise exception 'Mode de couleur inconnu : %', p_color_mode using errcode = '22023';
  end if;

  update public.pipelines_ventes
  set color_mode = coalesce(p_color_mode, color_mode),
      use_deal_probability = coalesce(p_use_deal_probability, use_deal_probability),
      updated_at = now()
  where id = p_pipeline_id;
end;
$fn$;

comment on function public.pipeline_definir_affichage(uuid, text, boolean) is
  'Règle l''affichage d''un pipeline après sa création (couleurs, probabilité par opportunité) : ces deux champs n''étaient posés qu''à la création et devenaient impossibles à changer (2026-09-25).';

-- `security definer` : révoquer nommément. Un `revoke ... from public` ne
-- suffit pas — les defaults Supabase accordent EXECUTE à anon et
-- authenticated, qui survivraient à la seule révocation de PUBLIC.
revoke all on function public.pipeline_definir_affichage(uuid, text, boolean) from public;
revoke all on function public.pipeline_definir_affichage(uuid, text, boolean) from anon;
grant execute on function public.pipeline_definir_affichage(uuid, text, boolean) to authenticated;
grant execute on function public.pipeline_definir_affichage(uuid, text, boolean) to service_role;

commit;
