-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ : verrouiller 5 tables serveur-only qui avaient RLS activée
-- mais AUCUNE policy — combiné à un GRANT direct à authenticated/anon,
-- ça autorisait n'importe quel utilisateur connecté à lire/écrire TOUTES
-- les lignes, toutes orgs confondues (audit 2026-07-17).
--
-- Tables concernées et pourquoi c'est grave :
--   • mfa_sms_challenges  — hash de codes 2FA + numéros de téléphone
--   • email_oauth_states  — code_verifier (secret PKCE OAuth)
--   • org_client_counters — compteur de numéros de clients par org
--   • org_job_counters    — compteur de numéros de jobs par org
--   • lead_lists          — appartenance lead↔liste
--
-- Vérifié : AUCUN code client (src/) ne lit ces tables. Elles sont
-- manipulées exclusivement côté serveur via service_role, qui contourne
-- RLS. On révoque donc tout accès anon/authenticated ; le service_role
-- garde le sien. Une policy « deny to authenticated » reste en filet de
-- sécurité si un grant réapparaissait.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  foreach t in array array[
    'mfa_sms_challenges',
    'email_oauth_states',
    'org_client_counters',
    'org_job_counters',
    'lead_lists'
  ] loop
    if to_regclass('public.'||t) is null then
      raise notice 'table absente, ignorée: %', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    -- Filet : refuser explicitement anon/authenticated même si un grant
    -- revenait. (service_role n'est pas soumis aux policies.)
    execute format('drop policy if exists %I on public.%I', t||'_deny_client', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      t||'_deny_client', t
    );
  end loop;
end $$;
