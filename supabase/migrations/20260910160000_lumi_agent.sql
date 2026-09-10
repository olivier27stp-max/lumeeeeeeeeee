-- ═══════════════════════════════════════════════════════════════
-- Lumi — l'assistant IA dans l'application (Claude Opus 5, outils Lume)
-- ─────────────────────────────────────────────────────────────
-- La page « Lume Agent » (Gemini) était cachée. Lumi la remplace : même
-- registre de 66 outils que le serveur MCP, mêmes permissions par rôle,
-- mais le moteur tourne sur NOTRE API (Claude), l'utilisateur est déjà
-- connecté, et c'est Lume qui paie l'inférence — d'où un budget mensuel en
-- dollars par plan, et un journal de consommation pour le faire respecter.
--
-- Décision produit (Rafba, 2026-09-10) : Autopilot 150 $ / mois, Scale
-- (slug `pro`) 80 $ / mois. Au-delà, Lumi s'arrête poliment jusqu'au mois
-- suivant. Les autres plans n'ont pas Lumi (includes_ai = false).

-- ── 1. Budget par plan ──
alter table public.plans
  add column if not exists ai_monthly_budget_cents integer not null default 0;
comment on column public.plans.ai_monthly_budget_cents is
  'Budget mensuel d''inférence IA (Lumi) par org, en cents de dollar. 0 = pas de Lumi.';

update public.plans set ai_monthly_budget_cents = 15000, includes_ai = true where slug = 'autopilot';
update public.plans set ai_monthly_budget_cents = 8000,  includes_ai = true where slug = 'pro';

-- ── 2. Conversations et messages ──
-- Le contenu est stocké tel que l'API Claude le rend (blocs texte, appels
-- d'outils, résultats) : le serveur rejoue l'historique fidèlement, et
-- l'interface n'a jamais à renvoyer la conversation entière.
create table if not exists public.lumi_conversations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_lumi_conversations_user
  on public.lumi_conversations (org_id, user_id, updated_at desc);

create table if not exists public.lumi_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.lumi_conversations(id) on delete cascade,
  org_id           uuid not null references public.orgs(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          jsonb not null,           -- blocs de contenu (API Claude)
  created_at       timestamptz not null default now()
);
create index if not exists idx_lumi_messages_conversation
  on public.lumi_messages (conversation_id, created_at);

-- ── 3. Journal de consommation (une ligne par appel au modèle) ──
create table if not exists public.ai_usage (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.orgs(id) on delete cascade,
  user_id                     uuid,
  conversation_id             uuid,
  model                       text not null,
  input_tokens                integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens     integer not null default 0,
  output_tokens               integer not null default 0,
  cost_cents                  numeric(12,4) not null default 0,   -- fractions de cent : un appel coûte souvent moins d'un cent
  created_at                  timestamptz not null default now()
);
create index if not exists idx_ai_usage_org_mois
  on public.ai_usage (org_id, created_at desc);
comment on table public.ai_usage is
  'Un appel au modèle par ligne, coût calculé au tarif du modèle. Somme du mois courant comparée à plans.ai_monthly_budget_cents.';

-- Dépense du mois courant d'une org — lue par le serveur avant chaque tour.
create or replace function public.lumi_depense_du_mois(p_org uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(cost_cents), 0)
    from public.ai_usage
   where org_id = p_org
     and created_at >= date_trunc('month', now() at time zone 'America/Montreal') at time zone 'America/Montreal';
$$;
revoke all on function public.lumi_depense_du_mois(uuid) from public, anon;
grant execute on function public.lumi_depense_du_mois(uuid) to authenticated, service_role;

-- ── 4. Sécurité ──
alter table public.lumi_conversations enable row level security;
alter table public.lumi_conversations force row level security;
alter table public.lumi_messages enable row level security;
alter table public.lumi_messages force row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

-- Le serveur écrit tout (service_role).
drop policy if exists "lumi_conversations_service" on public.lumi_conversations;
create policy "lumi_conversations_service" on public.lumi_conversations as permissive for all to service_role using (true) with check (true);
drop policy if exists "lumi_messages_service" on public.lumi_messages;
create policy "lumi_messages_service" on public.lumi_messages as permissive for all to service_role using (true) with check (true);
drop policy if exists "ai_usage_service" on public.ai_usage;
create policy "ai_usage_service" on public.ai_usage as permissive for all to service_role using (true) with check (true);

-- Une conversation appartient à SON auteur : un collègue de la même org ne
-- lit pas les échanges d'un autre (ils peuvent contenir des chiffres que son
-- rôle ne voit pas).
drop policy if exists "lumi_conversations_own" on public.lumi_conversations;
create policy "lumi_conversations_own" on public.lumi_conversations
  as permissive for select to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));
drop policy if exists "lumi_messages_own" on public.lumi_messages;
create policy "lumi_messages_own" on public.lumi_messages
  as permissive for select to authenticated
  using (exists (select 1 from public.lumi_conversations c
                  where c.id = lumi_messages.conversation_id and c.user_id = (select auth.uid())));
-- La consommation de l'org est visible par ses admins (jauge de quota).
drop policy if exists "ai_usage_admin" on public.ai_usage;
create policy "ai_usage_admin" on public.ai_usage
  as permissive for select to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

revoke all on public.lumi_conversations, public.lumi_messages, public.ai_usage from anon, authenticated;
grant select on public.lumi_conversations, public.lumi_messages, public.ai_usage to authenticated;
