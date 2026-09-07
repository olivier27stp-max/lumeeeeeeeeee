-- ════════════════════════════════════════════════════════════════════
-- Helper org_restricted_to_own() — prérequis de 20260905100000
-- ────────────────────────────────────────────────────────────────────
-- Copie VERBATIM de la définition posée par 20260629000000_rls_rep_own_scope
-- (appliquée en prod seulement — le staging ne l'a jamais reçue car cette
-- migration touche aussi l'ex-table `leads` et n'est plus rejouable telle
-- quelle). Sur prod, ce CREATE OR REPLACE est un no-op à l'identique.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.org_restricted_to_own(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id  = p_org
      and m.role not in ('owner', 'admin')
  );
$$;
