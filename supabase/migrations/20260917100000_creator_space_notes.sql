-- ═══════════════════════════════════════════════════════════════
-- Creator Space — notes internes par workspace (2026-09-17)
--
-- Notes plateforme sur un workspace, écrites par les ~2 comptes
-- platformAdminIds (voir server/lib/config.ts). Volontairement une table
-- DÉDIÉE, jamais la table tenant `notes` (org_id + RLS ouverte aux membres
-- de l'org) : une note interne à la plateforme ne doit JAMAIS être visible
-- par le client. Aucune policy RLS lisible par un rôle authentifié — seul
-- le service_role (server/routes/creator-space-notes.ts, gardé par
-- requireCreatorSpace) y accède, exactement comme org_features et
-- security_events.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.creator_space_notes (
  id         uuid primary key default gen_random_uuid(),
  -- Bureau où la note a été écrite (contexte d'affichage) — la note reste
  -- visible sur tout le workspace via la résolution company_group côté
  -- serveur (companyOrgIds), pas via cette colonne seule.
  org_id     uuid not null references public.orgs(id) on delete cascade,
  author_id  uuid not null,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint creator_space_notes_body_not_blank check (length(trim(body)) > 0)
);

create index if not exists idx_creator_space_notes_org on public.creator_space_notes (org_id, created_at desc);

alter table public.creator_space_notes enable row level security;
-- Aucune policy créée : RLS activée sans policy = personne (sauf
-- service_role, qui bypasse RLS) ne peut lire ni écrire cette table via
-- PostgREST. C'est le comportement voulu.
