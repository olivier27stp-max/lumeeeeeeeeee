-- ═══════════════════════════════════════════════════════════════
-- Créer un deal en capturant ce qui fait vivre les prévisions
--
-- LE PROBLÈME MESURÉ. En production : 22 deals, 22 sans date de fermeture,
-- 3 assignés. L'onglet Prévisions calcule donc sur du vide — « revenu
-- attendu » et « Chronologie » n'ont rien à pondérer, et « Corriger vos
-- données » liste tout le pipeline à perpétuité.
--
-- La cause est en amont : le formulaire « Nouveau deal » ne demande que le
-- contact (prénom, nom, courriel, téléphone, adresse). Tout ce qui nourrit
-- la projection doit être ressaisi après coup, deal par deal — donc ne l'est
-- jamais.
--
-- CE QUI NE CHANGE PAS. Le rapprochement de contacts reste `ingest_lead` :
-- c'est lui qui retrouve un client déjà connu par son téléphone ou son
-- courriel au lieu d'en créer un double. On ne touche pas à ce chemin. Les
-- nouveaux champs sont posés APRÈS, sur le deal que `ingest_lead` a rendu.
--
-- POURQUOI DES PARAMÈTRES OPTIONNELS. Rendre le montant obligatoire ferait
-- saisir des chiffres inventés, ce qui est pire que rien : une prévision
-- fausse se croit, une prévision vide se voit. Chaque champ absent laisse
-- simplement le deal dans « Corriger vos données », où il est réparable.
--
-- Les appels existants à 5 arguments continuent de fonctionner : les
-- nouveaux paramètres ont tous un défaut nul.
-- ═══════════════════════════════════════════════════════════════

begin;

-- L'ancienne signature est REMPLACÉE, pas doublée : deux surcharges
-- laisseraient PostgREST choisir, et un appel enrichi pourrait tomber
-- silencieusement sur la version courte.
drop function if exists public.pipeline_creer_deal(text, text, text, text, text);

create function public.pipeline_creer_deal(
  p_first_name text,
  p_last_name  text default null::text,
  p_email      text default null::text,
  p_phone      text default null::text,
  p_address    text default null::text,
  -- Ce qui fait vivre les prévisions.
  p_montant_cents        bigint default null,
  p_assigne_a            uuid   default null,
  p_date_fermeture_visee date   default null,
  p_source               text   default null
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

  -- Un montant négatif n'est pas une saisie maladroite, c'est une donnée
  -- fausse qui ferait mentir le total d'une colonne.
  if p_montant_cents is not null and p_montant_cents < 0 then
    raise exception 'Le montant ne peut pas être négatif';
  end if;

  -- L'assigné doit appartenir à CETTE organisation : sans ce contrôle, un
  -- identifiant copié d'ailleurs assignerait un deal à un inconnu.
  if p_assigne_a is not null
     and not exists (
       select 1 from public.memberships m
       where m.user_id = p_assigne_a and m.org_id = v_org
     ) then
    raise exception 'La personne assignée ne fait pas partie de l''organisation';
  end if;

  -- Le rapprochement de contacts, inchangé.
  v_res := public.ingest_lead(
    p_org_id     => v_org,
    p_source     => coalesce(v_source, 'manual'),
    p_first_name => btrim(p_first_name),
    p_last_name  => nullif(btrim(coalesce(p_last_name, '')), ''),
    p_email      => nullif(btrim(coalesce(p_email, '')), ''),
    p_phone      => nullif(btrim(coalesce(p_phone, '')), ''),
    p_address    => nullif(btrim(coalesce(p_address, '')), ''),
    p_created_by => v_uid
  );

  v_deal_id := (v_res ->> 'deal_id')::uuid;

  -- Les compléments, seulement s'ils ont été fournis. `coalesce` garde la
  -- valeur existante : un deal rapproché d'un lead déjà là ne doit pas
  -- perdre son assignation parce qu'on a resaisi le contact.
  if v_deal_id is not null
     and (p_montant_cents is not null
          or p_assigne_a is not null
          or p_date_fermeture_visee is not null) then
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

  -- Le MONTANT n'est pas écrit sur le deal : il est DÉRIVÉ du devis ou de la
  -- job (`pipeline_montants`). Un montant saisi à la création est une
  -- estimation du vendeur, pas un document — on la garde comme devis
  -- brouillon rattaché au deal, ce qui la rend visible, modifiable, et
  -- convertible. Sans ça, elle serait un chiffre orphelin que rien ne met
  -- à jour quand la vraie soumission part.
  if v_deal_id is not null and p_montant_cents is not null and p_montant_cents > 0 then
    declare
      v_client uuid;
      v_quote  uuid;
      v_num    text;
    begin
      select client_id into v_client from public.deals where id = v_deal_id;

      if v_client is not null then
        v_num := 'EST-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_deal_id::text, 1, 6);

        insert into public.quotes (
          org_id, client_id, quote_number, status,
          subtotal_cents, tax_cents, total_cents, created_by
        )
        values (
          v_org, v_client, v_num, 'draft',
          p_montant_cents, 0, p_montant_cents, v_uid
        )
        returning id into v_quote;

        update public.deals
        set quote_id = coalesce(quote_id, v_quote), updated_at = now()
        where id = v_deal_id and org_id = v_org;
      end if;
    end;
  end if;

  return v_res;
end;
$fn$;

revoke all on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text)
  from public, anon;
grant execute on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text)
  to authenticated;

comment on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text) is
  'Crée un deal depuis l''app : rapprochement de contact par ingest_lead, puis assignation, date de fermeture visée et estimation (devis brouillon). Le montant reste DÉRIVÉ — il n''est jamais écrit sur le deal. Tous les compléments sont optionnels : un champ absent laisse le deal dans « Corriger vos données », jamais un chiffre inventé.';

commit;
