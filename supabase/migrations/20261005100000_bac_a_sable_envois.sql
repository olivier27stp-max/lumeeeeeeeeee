-- Bac à sable des envois (server/lib/bac-a-sable.ts).
--
-- Une entreprise inscrite dans `orgs_envois_simules` n'envoie RIEN : textos,
-- courriels et webhooks sortants sont écrits dans `envois_simules` au lieu de
-- partir. Sert au bureau de test de la suite `npm run test:automations`.
--
-- Additive seulement. Lecture et écriture réservées au serveur (service_role) :
-- aucune politique pour `authenticated` — une entreprise ne peut ni s'inscrire
-- elle-même (ses clients ne recevraient plus rien sans qu'elle le sache) ni lire
-- ce qu'une autre aurait envoyé.

create table if not exists public.orgs_envois_simules (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  mode text not null default 'succes' check (mode in ('succes', 'panne', 'delai')),
  raison text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.envois_simules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  canal text not null check (canal in ('sms', 'courriel', 'webhook')),
  destinataire text not null,
  sujet text,
  corps text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists envois_simules_org_date_idx on public.envois_simules (org_id, created_at desc);

alter table public.orgs_envois_simules enable row level security;
alter table public.envois_simules enable row level security;

revoke all on public.orgs_envois_simules from public, anon, authenticated;
revoke all on public.envois_simules from public, anon, authenticated;
grant all on public.orgs_envois_simules to service_role;
grant all on public.envois_simules to service_role;

comment on table public.orgs_envois_simules is 'Entreprises dont aucun envoi ne part (bac à sable de test). Serveur seulement.';
comment on table public.envois_simules is 'Ce qu''une entreprise en bac à sable AURAIT envoyé. Serveur seulement.';
