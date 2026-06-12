-- ============================================================
-- FIX: leads.user_id (NOT NULL) n'était pas renseigné lors des
--      insertions en service_role (formulaire public, RPC
--      create_lead_with_client via getServiceClient()).
--
-- Contexte : la colonne public.leads.user_id existe en prod mais
-- n'apparaît dans aucune migration historique (drift de schéma).
-- Elle est NOT NULL et son défaut (auth.uid()) vaut NULL sans JWT,
-- d'où "null value in column user_id violates not-null constraint"
-- (23502) après la correction du trigger org_id.
--
-- Correctif : trigger BEFORE INSERT qui, si user_id est NULL,
-- le renseigne avec created_by (déjà résolu vers un membre valide
-- de l'org). Le test `to_jsonb(new) ? 'user_id'` rend la fonction
-- sûre même si la colonne n'existe pas (builds repo from scratch).
-- ============================================================

begin;

create or replace function app.leads_set_user_id()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) ? 'user_id') and new.user_id is null then
    new.user_id := new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_set_user_id on public.leads;
create trigger trg_leads_set_user_id
before insert on public.leads
for each row
execute function app.leads_set_user_id();

commit;
