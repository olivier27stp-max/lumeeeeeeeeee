-- ═══════════════════════════════════════════════════════════════
-- Créer un deal depuis le board
--
-- `ingest_lead` est révoquée pour `authenticated` : elle prend `p_org_id` en
-- paramètre, et une fonction SECURITY DEFINER qui accepte l'organisation en
-- argument ne doit jamais être appelable depuis un navigateur — n'importe qui
-- pourrait écrire dans une autre entreprise en changeant l'uuid.
--
-- Plutôt que d'ouvrir ces droits, on expose une porte étroite : cette
-- fonction-ci ne prend PAS d'organisation. Elle la dérive de la session, puis
-- délègue à `ingest_lead`. Le vendeur crée donc son deal par le même chemin
-- que le formulaire public — rapprochement sur téléphone ou courriel, première
-- étape ouverte, non assigné — sans qu'aucun paramètre ne permette d'en sortir.
--
-- SECURITY DEFINER, mais avec deux garde-fous explicites : l'organisation vient
-- de `current_org_id()`, et l'appelant doit avoir la permission `leads.create`
-- de la page Rôles. Un technicien qui n'a pas le droit de créer un lead ne peut
-- pas le contourner par le board.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_creer_deal(
  p_first_name text,
  p_last_name  text default null,
  p_email      text default null,
  p_phone      text default null,
  p_address    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;

  if not member_has_permission(v_uid, v_org, 'leads.create') then
    raise exception 'Vous n''avez pas la permission de créer un lead';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' then
    raise exception 'Le nom est requis';
  end if;

  return public.ingest_lead(
    p_org_id     => v_org,
    p_source     => 'manual',
    p_first_name => btrim(p_first_name),
    p_last_name  => nullif(btrim(coalesce(p_last_name, '')), ''),
    p_email      => nullif(btrim(coalesce(p_email, '')), ''),
    p_phone      => nullif(btrim(coalesce(p_phone, '')), ''),
    p_address    => nullif(btrim(coalesce(p_address, '')), ''),
    p_created_by => v_uid
  );
end;
$fn$;

-- Seuls les utilisateurs connectés : ni `anon`, ni `public`.
revoke all on function public.pipeline_creer_deal(text, text, text, text, text) from public, anon;
grant execute on function public.pipeline_creer_deal(text, text, text, text, text) to authenticated;

comment on function public.pipeline_creer_deal(text, text, text, text, text) is
  'Crée un deal depuis le board, par le même chemin que le formulaire public. L''organisation vient de la session — jamais d''un paramètre — et la permission « leads.create » est vérifiée.';

commit;
