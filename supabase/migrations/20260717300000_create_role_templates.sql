-- ═══════════════════════════════════════════════════════════════
-- FIX : créer la table role_templates, absente en prod.
--
-- La page Rôles & Permissions plantait au CHARGEMENT (500 sur
-- GET /api/roles/presets) parce que role_templates n'existait pas. La
-- migration d'origine (20260614) référençait public.organizations
-- (ancien nom) → jamais appliquée. On la recrée ici alignée sur le schéma
-- actuel (orgs, has_org_membership/has_org_admin_role).
--
-- La page fonctionnait quand même à l'usage grâce au fallback ROLE_PRESETS
-- (rbac.ts) ajouté aujourd'hui, mais le premier fetch échouait. Avec la
-- table, l'enregistrement de personnalisations de rôle persiste enfin.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.role_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  is_system     boolean not null default false,
  default_scope text not null default 'self'
                check (default_scope in ('self','assigned','team','department','company')),
  permissions   jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, slug)
);

alter table public.role_templates enable row level security;

-- Lecture : tout membre de l'org (la page Rôles est gated côté serveur pour
-- l'écriture ; la lecture des presets ne révèle rien de sensible).
drop policy if exists role_templates_select on public.role_templates;
create policy role_templates_select on public.role_templates
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));

-- Écriture : owner/admin seulement.
drop policy if exists role_templates_modify on public.role_templates;
create policy role_templates_modify on public.role_templates
  for all to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

create index if not exists idx_role_templates_org on public.role_templates (org_id);
