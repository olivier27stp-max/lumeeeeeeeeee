-- ============================================================
-- FIX: app.leads_force_org_id() écrasait org_id à NULL en
--      contexte service_role / SECURITY DEFINER.
--
-- Le trigger BEFORE INSERT trg_leads_force_org_id forçait
--   new.org_id := app.current_org_id()
-- or app.current_org_id() vaut NULL quand il n'y a pas de JWT
-- (client service_role : soumission de formulaire public, RPC
-- create_lead_with_client appelée par getServiceClient()).
-- Résultat : "missing org_id in auth context" (42501) → 500 sur
-- POST /public/form/:apiKey/submit.
--
-- Correctif : ne forcer l'org_id depuis le contexte auth QUE s'il
-- se résout. Sinon, respecter l'org_id fourni explicitement par la
-- RPC (déjà scoppé serveur). Les requêtes authentifiées continuent
-- d'avoir leur org_id imposé par le JWT (current_org_id() prioritaire),
-- donc impossible d'insérer dans une autre org.
-- ============================================================

begin;

create or replace function app.leads_force_org_id()
returns trigger
language plpgsql
as $$
begin
  -- Auth context wins (sécurité authed). Sans contexte (service_role),
  -- on garde l'org_id explicitement fourni.
  new.org_id := coalesce(app.current_org_id(), new.org_id);

  if new.org_id is null then
    raise exception 'missing org_id in auth context'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;
