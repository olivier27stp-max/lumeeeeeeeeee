-- Audit automatisations 2026-09-13, T8.4 — migration M7.
-- has_org_membership(p_user, p_org) ne testait pas memberships.status : un
-- membre retiré ou suspendu (status <> 'active') gardait l'accès à toutes les
-- policies qui s'appuient sur cette fonction, tant que sa ligne existait.
-- Vérifié avant : en prod, toutes les adhésions sont 'active' (10/10) ; les
-- policies explicites (invoices, quotes, agent_actions…) exigent déjà
-- m.status = 'active'. Cette fonction rejoint donc la règle commune.
-- Le serveur (requireAuthedClient) refuse aussi une adhésion non active.
create or replace function public.has_org_membership(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = p_user
       and m.org_id = p_org
       and coalesce(m.status, 'active') = 'active'
  );
$$;
