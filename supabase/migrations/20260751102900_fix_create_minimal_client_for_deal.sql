-- ============================================================================
-- create_minimal_client_for_deal() etait cassee — TROIS bugs cumules
-- ============================================================================
--
-- Symptome constate en production le 2026-07-31 :
--   ERROR 22P02: malformed array literal: "org_id"
--   CONTEXT: PL/pgSQL function create_minimal_client_for_deal(...) line 11
--            PL/pgSQL function create_client_and_deal(...) line 14
--
-- Elle casse donc aussi create_client_and_deal(), et avec elle
-- create_lead_and_deal() et create_deal_with_job() qui en dependent.
--
-- La fonction construisait son INSERT dynamiquement, en interrogeant
-- information_schema a CHAQUE APPEL pour savoir quelles colonnes existent.
-- Ce procede portait trois defauts distincts :
--
--   1. `cols := cols || 'org_id';`
--      `text[] || <litteral non type>` : PostgreSQL resout vers
--      `anyarray || anyarray` et tente de parser 'org_id' comme un litteral de
--      tableau -> 22P02. C'est le bug qui se declenchait en premier.
--
--   2. `vals := vals || quote_literal(p_org_id::text) || '::uuid';`
--      Evalue de gauche a droite : (text[] || text) donne un text[], puis
--      `|| '::uuid'` ajoute '::uuid' comme ELEMENT SEPARE du tableau au lieu de
--      le concatener a la valeur. On aurait obtenu `values ('xxx', ::uuid)`.
--
--   3. `vals := vals || quote_literal(nullif(trim(p_email), ''));`
--      Si l'email est vide, quote_literal(NULL) vaut NULL, l'element NULL est
--      ignore par array_to_string -> cols a N entrees, vals N-1 ->
--      « INSERT has more target columns than expressions ».
--      Ce troisieme bug n'a jamais pu se manifester, le premier plantant avant.
--
-- CORRECTIF : supprimer la construction dynamique.
--
-- L'introspection d'information_schema n'a plus lieu d'etre : les 8 colonnes
-- visees existent toutes et le schema est stable (verifie :
-- contact_id, created_by, email, first_name, last_name, org_id, phone, status).
-- Un INSERT statique elimine les trois bugs a la fois, supprime du SQL
-- dynamique, et rend la fonction lisible.
--
-- La logique metier est preservee a l'identique : meme decoupage du nom
-- complet, memes nullif(trim(...)) sur email et telephone, meme statut
-- 'active'.
--
-- DROITS INCHANGES : postgres et service_role uniquement. `authenticated` n'y a
-- pas acces (retire par 20260751102200) et ne doit pas le recuperer.
--
-- APPLIQUE EN PRODUCTION le 2026-07-31. Verifie par execution en transaction
-- annulee : creation avec email et telephone renseignes, puis avec les deux
-- vides — les deux reussissent, ce qui couvre aussi le bug n°3.
-- ============================================================================

create or replace function public.create_minimal_client_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_contact_id uuid,
  p_full_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name  text := coalesce(
                         nullif(trim(substr(coalesce(p_full_name, ''),
                           length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''),
                         'Client');
  v_client_id uuid;
begin
  insert into public.clients (
    org_id, created_by, contact_id,
    first_name, last_name, email, phone, status
  )
  values (
    p_org_id,
    p_created_by,
    p_contact_id,
    v_first_name,
    v_last_name,
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    'active'
  )
  returning id into v_client_id;

  return v_client_id;
end;
$$;

comment on function public.create_minimal_client_for_deal(uuid, uuid, uuid, text, text, text) is
  'INSERT statique. NE PAS revenir a une construction dynamique par '
  'introspection d''information_schema : c''est ce procede qui avait produit '
  'trois bugs cumules et casse create_client_and_deal (voir 20260751102900).';
