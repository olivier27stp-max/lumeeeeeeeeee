-- ═══════════════════════════════════════════════════════════════════
-- Écritures de l'agent : déduplication et traçabilité
-- ───────────────────────────────────────────────────────────────────
-- L'agent MCP va pouvoir CRÉER (jobs, clients, devis, factures-brouillons,
-- tâches) et ENVOYER (SMS). Un agent qui perd la réponse réseau RETENTE :
-- sans garde-fou, chaque retentative crée un doublon — deux factures, deux
-- SMS au client. C'est le défaut le plus coûteux d'un agent en écriture,
-- et le plus sournois : tout semble avoir fonctionné.
--
-- Principe : chaque écriture calcule l'empreinte de (outil + arguments).
-- Une empreinte déjà vue dans la fenêtre récente renvoie le résultat de la
-- PREMIÈRE exécution au lieu d'en produire une seconde. L'unicité est
-- portée par la base (index unique), pas par le code : deux requêtes
-- simultanées ne peuvent pas passer toutes les deux.
--
-- ⚠️ N'AJOUTE qu'une table neuve et remplace UNE fonction créée cette
-- semaine (oauth_menage, à nous). Aucune autre table, vue, politique ou
-- fonction n'est touchée.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.agent_actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  outil        text not null,
  args_hash    text not null,
  -- Ce que la première exécution a produit (id créé, sid Twilio…) :
  -- c'est ce qu'on renvoie telle quelle à la retentative.
  resultat     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.agent_actions is
  'Journal des écritures de l''agent MCP. L''index unique (org, outil, empreinte '
  'des arguments) rend chaque écriture idempotente : une retentative renvoie le '
  'résultat de la première exécution au lieu de créer un doublon. Purge > 24 h '
  'par oauth_menage(). Sert aussi d''audit : qui a fait créer quoi, et quand.';

-- L'idempotence elle-même : la base refuse le doublon, le code n'a qu'à
-- rattraper le conflit et relire la ligne existante.
create unique index if not exists agent_actions_dedup_idx
  on public.agent_actions (org_id, outil, args_hash);

create index if not exists agent_actions_org_date_idx
  on public.agent_actions (org_id, created_at desc);
create index if not exists agent_actions_user_idx
  on public.agent_actions (user_id);

-- ── RLS ─────────────────────────────────────────────────────────────
-- Écrite par le serveur uniquement. Les membres de l'org peuvent LIRE
-- (c'est leur journal d'audit), jamais écrire ni effacer.
alter table public.agent_actions enable row level security;
alter table public.agent_actions force row level security;

drop policy if exists agent_actions_service_all on public.agent_actions;
create policy agent_actions_service_all on public.agent_actions
  as permissive for all to service_role using (true) with check (true);

drop policy if exists agent_actions_select_membre on public.agent_actions;
create policy agent_actions_select_membre on public.agent_actions
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.org_id = agent_actions.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
    )
  );

-- ── Ménage ──────────────────────────────────────────────────────────
-- On étend NOTRE fonction de ménage OAuth (créée le 2026-09-02) pour
-- purger aussi ce journal : la fenêtre d'idempotence utile est de
-- quelques minutes, 24 h de rétention suffisent largement à l'audit
-- court terme (l'audit long terme vit dans security_events).
create or replace function public.oauth_menage()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.oauth_authorization_codes
   where expires_at < now() - interval '1 hour'
      or (used_at is not null and used_at < now() - interval '1 hour');

  delete from public.oauth_tokens
   where (revoked = true and revoked_at < now() - interval '30 days')
      or (refresh_token_expires_at is not null
          and refresh_token_expires_at < now() - interval '30 days');

  delete from public.agent_actions
   where created_at < now() - interval '24 hours';
end $$;

revoke all on function public.oauth_menage() from public;
grant execute on function public.oauth_menage() to service_role;

-- ── Vérification ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.agent_actions') is null then
    raise exception 'La table agent_actions est absente.';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='agent_actions_dedup_idx'
  ) then
    raise exception 'L''index d''idempotence est absent — les doublons passeraient.';
  end if;
  if exists (
    select 1 from pg_class
     where relname = 'agent_actions'
       and relnamespace = 'public'::regnamespace
       and relrowsecurity = false
  ) then
    raise exception 'RLS n''est pas active sur agent_actions.';
  end if;
  raise notice 'Écritures de l''agent : idempotence portée par la base, audit lisible par l''org.';
end $$;
