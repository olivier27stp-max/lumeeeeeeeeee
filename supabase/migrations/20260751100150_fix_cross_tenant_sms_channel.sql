-- ============================================================================
-- CORRECTIF DE DONNEES — reference cross-tenant sur le canal SMS par defaut
-- ============================================================================
-- DECOUVERT en testant la migration des FK composites (20260751100200) :
-- la validation echouait sur communication_settings.default_sms_channel_id.
-- C'est precisement le type de defaut que N3.3 existe pour rendre impossible.
--
-- FAITS CONSTATES EN PROD :
--   org e0cf4b92-c229-4785-a2e7-7081fae3e18e (« Workspace e0cf4b92 », 0 membre,
--   0 message) avait pour canal SMS par defaut le canal
--   6c11d729-b834-4572-afdb-798ef091fdda appartenant a l'org
--   4d885f6c-e076-4ed9-ab09-23637dbee6cd (« Coquin lavage »).
--
-- IMPACT REEL : nul. Le canal a servi a 5 envois, tous par son org proprietaire
-- (Coquin lavage). L'org orpheline n'a jamais rien envoye — elle n'a aucun
-- membre. Aucun SMS n'a traverse la frontiere entre orgs, aucune donnee client
-- n'a fuite. Il s'agit d'une reference dormante, vraisemblablement issue d'un
-- workspace cree puis abandonne pendant les tests de mars 2026.
--
-- CORRECTIF : remettre la reference a NULL. On ne supprime pas la ligne de
-- parametres (l'org pourrait etre reactivee) et on ne touche pas au canal, qui
-- appartient legitimement a Coquin lavage.
--
-- Cette migration DOIT s'appliquer AVANT 20260751100200, sinon la FK composite
-- correspondante restera NOT VALID.
-- ============================================================================

do $$
declare
  v_fixed int;
begin
  update public.communication_settings s
     set default_sms_channel_id = null
    from public.communication_channels c
   where c.id = s.default_sms_channel_id
     and s.org_id is distinct from c.org_id;

  get diagnostics v_fixed = row_count;
  raise notice 'Canaux SMS cross-tenant remis a NULL : %', v_fixed;
end $$;

-- ----------------------------------------------------------------------------
-- Verification : plus aucune reference cross-tenant sur cette relation.
-- ----------------------------------------------------------------------------
do $$
declare
  v int;
begin
  select count(*) into v
    from public.communication_settings s
    join public.communication_channels c on c.id = s.default_sms_channel_id
   where s.org_id is distinct from c.org_id;

  if v > 0 then
    raise exception 'Il reste % reference(s) SMS cross-tenant.', v;
  end if;
end $$;
