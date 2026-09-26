-- ═══════════════════════════════════════════════════════════════
-- Créer un deal À PARTIR d'un client ou d'un devis existant,
-- et dans le pipeline de son choix
--
-- LE PROBLÈME, MESURÉ. Le formulaire « Nouveau deal » ne sait faire qu'une
-- chose : retaper un contact à la main. Trois conséquences prouvées sur
-- staging le 2026-09-25 :
--
--  1. UN NOM SEUL CRÉE UN DOUBLON, EN SILENCE. Le rapprochement d'ingest_lead
--     (§2c) ne regarde QUE le téléphone et le courriel. Or le formulaire
--     n'exige que le prénom. Deux appels successifs avec le même nom et sans
--     téléphone ni courriel ont donné DEUX clients distincts et DEUX deals,
--     « fusionne=false » les deux fois. Le vendeur qui saisit « Marc Tremblay »
--     deux fois obtient deux fiches Marc Tremblay, sans aucun avertissement.
--
--  2. IMPOSSIBLE DE PARTIR D'UN CLIENT DÉJÀ CONNU. L'information est en base,
--     et on la ressaisit en espérant que le rapprochement tombe juste.
--
--  3. IMPOSSIBLE DE PARTIR D'UN DEVIS. La fonction fait l'inverse : elle
--     FABRIQUE un devis brouillon « EST-… » depuis le montant tapé. Quand le
--     vrai devis existe déjà, on s'en retrouve avec un second, bidon, à côté.
--
-- Et le pipeline : « ingest_lead » accepte « p_pipeline_id » depuis 2026-09-25
-- (formulaires multiples), mais « pipeline_creer_deal » ne le transmettait
-- jamais. Un deal créé à la main tombait donc toujours dans le pipeline par
-- défaut. Le board compensait en BASCULANT de pipeline après coup, avec un
-- toast « on t'y amène » — un contournement de l'effet, pas la cause.
--
-- CE QUI NE CHANGE PAS. « ingest_lead » n'est pas touchée : elle sait déjà
-- tout faire. Le montant reste DÉRIVÉ, jamais écrit sur le deal. Le
-- rapprochement de contacts reste le chemin par défaut.
--
-- ADDITIF. Les trois paramètres sont optionnels et en DERNIÈRE position ; les
-- appels à 9 arguments existants continuent de fonctionner à l'identique.
--
-- ROLLBACK :
--   drop function if exists public.pipeline_creer_deal(
--     text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid);
--   puis rejouer 20260925100000_creer_deal_enrichi.sql tel quel.
--   Aucune donnée n'est migrée : rien à restaurer.
-- ═══════════════════════════════════════════════════════════════

begin;

-- Signature REMPLACÉE, pas doublée : deux surcharges laisseraient PostgREST
-- choisir, et un appel enrichi pourrait retomber en silence sur la version
-- courte (42725 « function is not unique » au mieux, mauvais pipeline au pire).
drop function if exists public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text);

create function public.pipeline_creer_deal(
  p_first_name text,
  p_last_name  text default null::text,
  p_email      text default null::text,
  p_phone      text default null::text,
  p_address    text default null::text,
  p_montant_cents        bigint default null,
  p_assigne_a            uuid   default null,
  p_date_fermeture_visee date   default null,
  p_source               text   default null,
  -- Nouveau : partir de l'existant au lieu de le retaper.
  p_client_id   uuid default null,
  p_quote_id    uuid default null,
  p_pipeline_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org     uuid := current_org_id();
  v_uid     uuid := auth.uid();
  v_res     jsonb;
  v_deal_id uuid;
  v_source  text := nullif(btrim(coalesce(p_source, '')), '');
  v_client  uuid;
  v_quote   uuid;
  v_montant bigint := p_montant_cents;
  v_prenom  text := p_first_name;
  v_nom     text := p_last_name;
  v_courriel text := p_email;
  v_tel     text := p_phone;
  v_adresse text := p_address;
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;

  if not member_has_permission(v_uid, v_org, 'leads.create') then
    raise exception 'Vous n''avez pas la permission de créer un lead';
  end if;

  if p_montant_cents is not null and p_montant_cents < 0 then
    raise exception 'Le montant ne peut pas être négatif';
  end if;

  if p_assigne_a is not null
     and not exists (
       select 1 from public.memberships m
       where m.user_id = p_assigne_a and m.org_id = v_org
     ) then
    raise exception 'La personne assignée ne fait pas partie de l''organisation';
  end if;

  -- ── Le devis choisi donne son client ET son montant ──────────
  -- Un devis porte déjà les deux. Les redemander au vendeur, c'est l'inviter
  -- à saisir un chiffre qui divergera du document.
  if p_quote_id is not null then
    select q.id, q.client_id, q.total_cents
      into v_quote, v_client, v_montant
    from public.quotes q
    where q.id = p_quote_id and q.org_id = v_org and q.deleted_at is null;

    if v_quote is null then
      raise exception 'Devis introuvable';
    end if;
    if v_client is null then
      raise exception 'Ce devis n''est rattaché à aucun client';
    end if;
  end if;

  -- ── Le client choisi fournit le contact ──────────────────────
  -- On LIT la fiche au lieu de faire confiance à ce qui a été retapé : c'est
  -- ce qui garantit zéro doublon. « p_client_id » gagne sur le devis seulement
  -- s'il est cohérent avec lui.
  if p_client_id is not null then
    if v_client is not null and v_client <> p_client_id then
      raise exception 'Le client choisi ne correspond pas à celui du devis';
    end if;
    v_client := p_client_id;
  end if;

  if v_client is not null then
    select
      coalesce(nullif(btrim(coalesce(c.first_name, '')), ''), 'Client'),
      c.last_name, c.email, c.phone, c.address
      into v_prenom, v_nom, v_courriel, v_tel, v_adresse
    from public.clients c
    where c.id = v_client and c.org_id = v_org and c.deleted_at is null;

    if v_prenom is null then
      raise exception 'Client introuvable';
    end if;
  end if;

  if btrim(coalesce(v_prenom, '')) = '' then
    raise exception 'Le nom est requis';
  end if;

  -- Le pipeline cible est VALIDÉ ici : ingest_lead retomberait sur le pipeline
  -- par défaut sans rien dire si l'identifiant venait d'ailleurs, et le deal
  -- atterrirait dans le mauvais tableau. (« pipelines_ventes » n'a pas
  -- d'archivage : l'existence dans l'organisation suffit.)
  if p_pipeline_id is not null
     and not exists (
       select 1 from public.pipelines_ventes p
       where p.id = p_pipeline_id and p.org_id = v_org
     ) then
    raise exception 'Pipeline introuvable';
  end if;

  if v_client is null then
    -- Nouveau contact : le rapprochement d'ingest_lead, inchangé.
    v_res := public.ingest_lead(
      p_org_id      => v_org,
      p_source      => coalesce(v_source, 'manual'),
      p_first_name  => btrim(v_prenom),
      p_last_name   => nullif(btrim(coalesce(v_nom, '')), ''),
      p_email       => nullif(btrim(coalesce(v_courriel, '')), ''),
      p_phone       => nullif(btrim(coalesce(v_tel, '')), ''),
      p_address     => nullif(btrim(coalesce(v_adresse, '')), ''),
      p_created_by  => v_uid,
      p_pipeline_id => p_pipeline_id
    );
  else
    -- Client CHOISI : on ne passe PAS par le rapprochement. Il ne sait
    -- retrouver quelqu'un que par téléphone ou courriel ; un client connu
    -- qui n'a ni l'un ni l'autre serait recréé en double — exactement le
    -- défaut qu'on corrige. Le deal est donc rattaché à CE client.
    -- Même résolution de pipeline et d'étape qu'ingest_lead (§2b), même
    -- règle « un seul deal ouvert par client et par pipeline » (§2e).
    declare
      v_pipeline    uuid;
      v_etape       uuid;
      v_deal_ouvert uuid;
    begin
      if p_pipeline_id is not null then
        v_pipeline := p_pipeline_id;
      else
        select id into v_pipeline from public.pipelines_ventes
        where org_id = v_org and is_default limit 1;
      end if;
      if v_pipeline is null then
        v_pipeline := public.seed_pipeline_ventes(v_org, 'generique');
      end if;

      select id into v_etape from public.pipeline_stages
      where org_id = v_org and pipeline_id = v_pipeline
        and kind = 'open' and archived_at is null
      order by position limit 1;

      if v_etape is null then
        raise exception 'Ce pipeline n''a aucune étape ouverte';
      end if;

      select d.id into v_deal_ouvert
      from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.org_id = v_org and d.client_id = v_client
        and d.pipeline_id = v_pipeline
        and d.deleted_at is null and s.kind = 'open'
      order by d.created_at desc limit 1;

      if v_deal_ouvert is not null then
        update public.deals
        set last_activity_at = now(), updated_at = now()
        where id = v_deal_ouvert;
        v_res := jsonb_build_object(
          'deal_id', v_deal_ouvert, 'client_id', v_client, 'pipeline_id', v_pipeline,
          'cree', false, 'fusionne', true, 'deal_existant', true,
          'raison', 'deal_ouvert_existant');
      else
        insert into public.deals (org_id, pipeline_id, stage_id, client_id, source, created_by)
        values (v_org, v_pipeline, v_etape, v_client, coalesce(v_source, 'manual'), v_uid)
        returning id into v_deal_id;

        update public.clients
        set last_client_activity_at = now(), updated_at = now()
        where id = v_client;

        v_res := jsonb_build_object(
          'deal_id', v_deal_id, 'client_id', v_client, 'pipeline_id', v_pipeline,
          'cree', true, 'fusionne', true, 'deal_existant', false,
          'raison', 'client_choisi');
      end if;
    end;
  end if;

  v_deal_id := (v_res ->> 'deal_id')::uuid;

  if v_deal_id is not null
     and (p_assigne_a is not null or p_date_fermeture_visee is not null) then
    update public.deals d
    set
      assigned_user_id    = coalesce(p_assigne_a, d.assigned_user_id),
      assigned_at         = case
                              when p_assigne_a is not null and d.assigned_user_id is null
                                then now()
                              else d.assigned_at
                            end,
      expected_close_date = coalesce(p_date_fermeture_visee, d.expected_close_date),
      updated_at          = now()
    where d.id = v_deal_id
      and d.org_id = v_org;
  end if;

  -- ── Le devis existant est RATTACHÉ, pas recréé ───────────────
  if v_deal_id is not null and v_quote is not null then
    update public.deals
    set quote_id = coalesce(quote_id, v_quote), updated_at = now()
    where id = v_deal_id and org_id = v_org;

  -- Sinon, et seulement sinon, l'estimation saisie devient un devis
  -- brouillon : visible, modifiable, remplaçable par la vraie soumission.
  -- Un montant repris d'un devis choisi ne repasse JAMAIS ici, sans quoi on
  -- fabriquerait le doublon qu'on cherche à supprimer.
  elsif v_deal_id is not null and v_montant is not null and v_montant > 0 then
    declare
      v_client_deal uuid;
      v_nouveau     uuid;
      v_num         text;
    begin
      select client_id into v_client_deal from public.deals where id = v_deal_id;

      if v_client_deal is not null then
        v_num := 'EST-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_deal_id::text, 1, 6);

        insert into public.quotes (
          org_id, client_id, quote_number, status,
          subtotal_cents, tax_cents, total_cents, created_by
        )
        values (
          v_org, v_client_deal, v_num, 'draft',
          v_montant, 0, v_montant, v_uid
        )
        returning id into v_nouveau;

        update public.deals
        set quote_id = coalesce(quote_id, v_nouveau), updated_at = now()
        where id = v_deal_id and org_id = v_org;
      end if;
    end;
  end if;

  return v_res;
end;
$fn$;

revoke all on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid)
  to authenticated;

comment on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid) is
  'Crée un deal depuis l''app. Trois portes d''entrée : un client existant (p_client_id — le contact est LU sur sa fiche, donc zéro doublon), un devis existant (p_quote_id — donne son client et son montant, et est RATTACHÉ au lieu d''être recréé), ou un nouveau contact (rapprochement par ingest_lead). p_pipeline_id dirige le deal vers un pipeline précis au lieu du pipeline par défaut. Le montant reste DÉRIVÉ, jamais écrit sur le deal.';

commit;
