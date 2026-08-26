-- Migration assistée — deux extensions demandées après l'audit :
-- 1) migration_mapping_templates : gabarits de correspondance réutilisables
--    entre clients provenant du même CRM source (clé = en-tête normalisé →
--    entité/champ Lume). Aucun contenu client, uniquement de la structure.
-- 2) migration_staff_mappings : correspondance « nom d'employé dans l'ancien
--    CRM → membre Lume actuel » propre à UNE migration (user_id NULL =
--    conserver comme historique non assigné, jamais de compte créé).
-- Même posture de sécurité que les 13 tables existantes : RLS deny-all pour
-- authenticated (aucune policy), service_role seul, accès via le serveur.

begin;

create table if not exists public.migration_mapping_templates (
  id uuid primary key default gen_random_uuid(),
  source_crm text not null,
  name text not null,
  headers_map jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_crm, name)
);
comment on table public.migration_mapping_templates is
  'Gabarit de correspondance colonnes → champs Lume, réutilisable par CRM source. Structure seulement, jamais de données client.';

create table if not exists public.migration_staff_mappings (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  source_key text not null,
  source_label text not null,
  user_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (migration_id, source_key)
);
comment on table public.migration_staff_mappings is
  'Correspondance employé historique (texte source) → membre Lume pour une migration. user_id NULL = historique non assigné.';
create index if not exists idx_migration_staff_map_migration on public.migration_staff_mappings (migration_id);

do $$
declare
  t text;
begin
  foreach t in array array['migration_mapping_templates','migration_staff_mappings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_service', t);
    execute format('drop trigger if exists trg_%s_set_updated_at on public.%I', t, t);
    execute format('create trigger trg_%s_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

commit;
