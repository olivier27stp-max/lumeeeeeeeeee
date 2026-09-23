-- ═══════════════════════════════════════════════════════════════
-- La carte de porte-à-porte entre dans le pipeline
--
-- LA DÉCISION, et pourquoi.
--
-- Le terrain a neuf statuts de pin :
--   unknown · no_answer · not_interested · do_not_knock · revisit · callback
--   lead · quote_sent · sale
--
-- Les six premiers ne sont PAS des étapes de vente : « pas de réponse » ou
-- « ne pas cogner » sont des états de porte, utiles sur une carte et absurdes
-- dans un tableau de deals. En faire des colonnes noierait le pipeline sous
-- des milliers de portes muettes, et rendrait le taux de closing faux (on ne
-- « perd » pas une porte où personne n'a répondu).
--
-- Les trois derniers — lead, quote_sent, sale — sont exactement une
-- progression commerciale. C'est là que la frontière passe.
--
-- Donc : la carte reste la carte, et une porte ENTRE dans le pipeline au
-- moment où elle devient un prospect. Pas de second pipeline à maintenir en
-- parallèle, pas de doublon de vérité. Le pipeline du D2D est le pipeline de
-- l'entreprise, avec la source « d2d » pour distinguer les origines.
--
-- CE QUE CETTE FONCTION AJOUTE à `ingest_lead`, à laquelle elle délègue :
--   · l'attribution terrain (`pin_id`, `field_rep_id`) — sans quoi on ne
--     saurait jamais quel rep a ouvert le deal ni quelle porte l'a produit ;
--   · un `external_id` stable par maison, pour qu'un rep qui repasse de
--     « lead » à « callback » puis à « lead » ne crée pas deux deals.
--
-- On ne touche PAS à `ingest_lead` : ajouter deux paramètres changerait sa
-- signature, et `create or replace` avec une liste d'arguments différente
-- crée un OVERLOAD au lieu de remplacer — PostgREST répond alors PGRST203
-- et l'appel meurt en silence (déjà vécu sur ce chantier, 2026-09-23).
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_ingerer_porte(
  p_org_id     uuid,
  p_house_id   uuid,
  p_client_id  uuid default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_maison   record;
  v_pin      uuid;
  v_res      jsonb;
  v_deal     uuid;
  v_prenom   text;
  v_nom      text;
  v_parties  text[];
begin
  if p_org_id is null or p_house_id is null then
    raise exception 'org_id et house_id requis';
  end if;

  select h.id, h.address, h.client_id, h.metadata
    into v_maison
  from public.field_house_profiles h
  where h.id = p_house_id and h.org_id = p_org_id and h.deleted_at is null;

  if v_maison.id is null then
    raise exception 'Maison introuvable dans cette organisation';
  end if;

  select p.id into v_pin
  from public.field_pins p
  where p.house_id = p_house_id and p.org_id = p_org_id
  limit 1;

  -- Le contact : celui déjà lié à la porte l'emporte sur celui passé en
  -- argument — c'est la carte qui fait foi sur le terrain.
  -- Le nom vient des métadonnées du pin quand la fiche client n'existe pas
  -- encore ; sans nom ni contact, `ingest_lead` créerait un client vide.
  v_parties := regexp_split_to_array(
    btrim(coalesce(v_maison.metadata ->> 'customer_name', '')), '\s+');
  v_prenom := nullif(v_parties[1], '');
  v_nom    := nullif(btrim(array_to_string(v_parties[2:], ' ')), '');

  v_res := public.ingest_lead(
    p_org_id      => p_org_id,
    p_source      => 'd2d',
    -- Stable par maison : rejouer le même passage ne crée pas un 2e deal.
    p_external_id => 'house:' || p_house_id::text,
    p_first_name  => v_prenom,
    p_last_name   => v_nom,
    p_email       => nullif(btrim(coalesce(v_maison.metadata ->> 'customer_email', '')), ''),
    p_phone       => nullif(btrim(coalesce(v_maison.metadata ->> 'customer_phone', '')), ''),
    p_address     => v_maison.address,
    p_payload     => jsonb_build_object('house_id', p_house_id, 'pin_id', v_pin),
    p_created_by  => p_created_by
  );

  v_deal := (v_res ->> 'deal_id')::uuid;

  -- L'attribution terrain : qui a cogné, et à quelle porte.
  -- `coalesce` sur field_rep_id : le PREMIER rep qui ouvre la porte garde le
  -- crédit, un passage suivant ne le lui retire pas.
  if v_deal is not null then
    update public.deals set
      pin_id       = coalesce(v_pin, pin_id),
      field_rep_id = coalesce(field_rep_id, p_created_by),
      updated_at   = now()
    where id = v_deal and org_id = p_org_id;
  end if;

  return v_res || jsonb_build_object('house_id', p_house_id, 'pin_id', v_pin);
end;
$fn$;

-- Appelée par le serveur avec le client service_role, jamais par un
-- navigateur : elle prend l'organisation en paramètre (cf. le garde-fou
-- posé pour `ingest_lead`).
revoke all on function public.pipeline_ingerer_porte(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

comment on function public.pipeline_ingerer_porte(uuid, uuid, uuid, uuid) is
  'Fait entrer une porte du D2D dans le pipeline de ventes quand elle devient un prospect, en conservant l''attribution terrain (pin, rep). Délègue le rapprochement à ingest_lead. Idempotente par maison.';

commit;
