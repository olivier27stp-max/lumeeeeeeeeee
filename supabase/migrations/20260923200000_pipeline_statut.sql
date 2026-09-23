-- ═══════════════════════════════════════════════════════════════
-- Un statut, distinct de l'étape
--
-- Constat de l'analyse des concurrents (2026-09-23) : Jobber, Pipedrive et
-- GoHighLevel ont tous un statut SÉPARÉ de l'étape. GHL distingue quatre
-- valeurs fixes — ouvert, gagné, perdu, ABANDONNÉ — et c'est la dernière qui
-- manque vraiment ici.
--
-- Pourquoi ça compte : « perdu » veut dire que le client a dit non.
-- « Abandonné » veut dire qu'il ne répond plus et qu'on arrête de relancer.
-- Confondus, le taux de closing compte comme défaite commerciale un deal qui
-- n'a jamais été arbitré — et « pourquoi on perd » devient illisible.
--
-- Le statut ne REMPLACE pas `kind` : il le précise. `kind` reste ce à quoi la
-- logique s'accroche (une étape gagnée reste gagnée) ; le statut dit comment
-- le deal est sorti. C'est pour ça qu'il est dérivé automatiquement du `kind`
-- par défaut, et que seul « abandonné » demande un geste explicite.
--
-- Les statistiques existantes ne changent pas de comportement : elles lisent
-- `kind`, pas le statut. Une migration suivante pourra affiner le taux de
-- closing en excluant les abandonnés — décision produit, pas technique.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Le statut
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'deal_statut') then
    create type public.deal_statut as enum ('ouvert', 'gagne', 'perdu', 'abandonne');
  end if;
end
$$;

alter table public.deals
  add column if not exists statut public.deal_statut not null default 'ouvert';

comment on column public.deals.statut is
  'Précise comment le deal est sorti, sans remplacer le kind de l''étape. « abandonné » = plus de relance prévue, différent de « perdu » où le client a dit non (distinction reprise de GoHighLevel, 2026-09-23).';

-- Les stats filtreront sur le statut : sans index, chaque appel scannerait.
create index if not exists idx_deals_org_statut
  on public.deals (org_id, statut)
  where deleted_at is null;

-- ───────────────────────────────────────────────────────────────
-- 2. Le statut suit le `kind` de l'étape, SAUF quand il a été posé à la main
--
--    Un deal déplacé vers « Gagné » devient « gagné » sans qu'on le demande.
--    Mais un deal marqué « abandonné » reste abandonné même s'il est déplacé
--    dans une autre étape perdue : c'est une décision humaine, pas un effet
--    de bord du déplacement.
-- ───────────────────────────────────────────────────────────────
create or replace function public.deals_deduire_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind public.pipeline_stage_kind;
begin
  -- Le statut a été fixé explicitement dans CETTE écriture : on n'y touche pas.
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select kind into v_kind from public.pipeline_stages where id = new.stage_id;

  new.statut := case v_kind
    when 'won'  then 'gagne'::public.deal_statut
    -- Un deal déjà abandonné qui change d'étape perdue le reste.
    when 'lost' then (case when tg_op = 'UPDATE' and old.statut = 'abandonne'
                           then 'abandonne'::public.deal_statut
                           else 'perdu'::public.deal_statut end)
    else 'ouvert'::public.deal_statut
  end;

  return new;
end;
$fn$;

drop trigger if exists trg_deals_deduire_statut on public.deals;
create trigger trg_deals_deduire_statut
  before insert or update of stage_id, statut on public.deals
  for each row execute function public.deals_deduire_statut();

-- ───────────────────────────────────────────────────────────────
-- 3. Les deals existants prennent le statut de leur étape
-- ───────────────────────────────────────────────────────────────
update public.deals d
set statut = case s.kind
  when 'won'  then 'gagne'::public.deal_statut
  when 'lost' then 'perdu'::public.deal_statut
  else 'ouvert'::public.deal_statut
end
from public.pipeline_stages s
where s.id = d.stage_id
  and d.deleted_at is null
  and d.statut is distinct from (case s.kind
    when 'won'  then 'gagne'::public.deal_statut
    when 'lost' then 'perdu'::public.deal_statut
    else 'ouvert'::public.deal_statut
  end);

-- ───────────────────────────────────────────────────────────────
-- 4. Marquer un deal abandonné, sans le déplacer
--
--    Le vendeur n'a pas à choisir une étape pour dire « j'arrête » : il le
--    dit, et le deal va dans l'étape perdue du pipeline. Un aller-retour par
--    l'étape obligerait à deviner laquelle, et rendrait le geste ambigu.
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_abandonner_deal(
  p_deal_id uuid,
  p_raison  text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_etape uuid;
  v_pipeline uuid;
begin
  select pipeline_id into v_pipeline from public.deals where id = p_deal_id;
  if v_pipeline is null then
    raise exception 'Deal introuvable';
  end if;

  select id into v_etape
  from public.pipeline_stages
  where pipeline_id = v_pipeline and kind = 'lost' and archived_at is null
  order by position
  limit 1;

  if v_etape is null then
    raise exception 'Aucune étape « perdu » active dans ce pipeline';
  end if;

  -- `statut` est écrit dans la MÊME instruction que `stage_id` : le trigger
  -- voit un statut explicite et ne le réécrit pas en « perdu ».
  update public.deals
  set stage_id = v_etape,
      statut = 'abandonne',
      lost_reason = coalesce(nullif(btrim(coalesce(p_raison, '')), ''), lost_reason)
  where id = p_deal_id;
end;
$fn$;

comment on function public.pipeline_abandonner_deal(uuid, text) is
  'Marque un deal abandonné (plus de relance prévue) et le place dans l''étape perdue du pipeline. Différent de « perdu », où le client a dit non.';

commit;
