-- ═══════════════════════════════════════════════════════════════
-- File de reprise des courriels de fond (plan courriels pro, 2026-09-17)
-- ─────────────────────────────────────────────────────────────
-- Un envoi raté (Resend ou SMTP en erreur) était journalisé dans Sentry puis
-- perdu : un rappel de paiement, un reçu d'abonnement, un rapport planifié ou
-- une réponse du support sautait sans que rien ne le renvoie.
--
-- `sendEmail({ …, reessayer: true })` — opt-in, envois de FOND seulement —
-- écrit ici le courriel raté ; le cron `demarrerReprisesCourriels`
-- (server/lib/courriels/reprises.ts, toutes les 5 min, sous verrou) reprend
-- les lignes `pending` arrivées à échéance : 5 min, 30 min, 3 h ; au 3e échec
-- la ligne passe `dead` et l'exploitant (SUPPORT_EMAIL) est prévenu.
--
-- Serveur seul (service_role) : aucun client n'a de raison de lire le HTML
-- complet des courriels d'autrui. RLS activée + forcée, tout révoqué pour
-- anon et authenticated.
--
-- À appliquer : staging (npm run db:apply) puis prod (npm run db:apply:prod),
-- AVANT de fusionner le code (check:schema-refs exige la table).
create table if not exists public.email_retry_queue (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs(id) on delete cascade,
  from_addr       text,
  to_emails       jsonb not null default '[]'::jsonb,
  reply_to        text,
  subject         text not null,
  html            text not null,
  text            text,
  headers         jsonb,
  suivi           jsonb,                                  -- { orgId, entityType, entityId } → email_deliveries au succès
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  status          text not null default 'pending'
                  check (status in ('pending', 'sent', 'dead')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Ce que lit le cron : les lignes en attente, par échéance.
create index if not exists idx_email_retry_queue_pending
  on public.email_retry_queue (next_attempt_at)
  where status = 'pending';
create index if not exists idx_email_retry_queue_org
  on public.email_retry_queue (org_id, created_at desc);

comment on table public.email_retry_queue is
  'Courriels de fond dont l''envoi a échoué, repris par le serveur (5 min / 30 min / 3 h, puis dead + alerte à l''exploitant). Écrit par sendEmail({ reessayer: true }) ; serveur seul.';

drop trigger if exists set_email_retry_queue_updated_at on public.email_retry_queue;
create trigger set_email_retry_queue_updated_at
  before update on public.email_retry_queue
  for each row execute function public.set_updated_at();

-- ── Sécurité ──
alter table public.email_retry_queue enable row level security;
alter table public.email_retry_queue force row level security;

drop policy if exists "email_retry_queue_service" on public.email_retry_queue;
create policy "email_retry_queue_service" on public.email_retry_queue
  as permissive for all to service_role
  using (true) with check (true);

revoke all on public.email_retry_queue from anon;
revoke all on public.email_retry_queue from authenticated;
