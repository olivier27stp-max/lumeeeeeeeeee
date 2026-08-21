-- Migration assistée — transfert ponctuel des données d'un ancien CRM vers un workspace Lume.
-- Un administrateur interne Lume (PLATFORM_OWNER_ID) crée une « migration », génère un lien
-- d'invitation temporaire (jeton haché SHA-256, expiration 48 h par défaut, révocable) que le
-- propriétaire/admin du workspace ouvre pour téléverser ses exports CSV. Les fichiers sont
-- analysés dans une zone de staging isolée (aucune écriture dans les tables actives), les
-- colonnes sont mises en correspondance avec les champs Lume, les doublons détectés, puis un
-- import test produit un rapport que le client approuve avant que l'admin Lume ne lance
-- l'import final (idempotent, annulable par lot via soft-delete).
--
-- Sécurité : TOUTES ces tables sont accessibles uniquement via le serveur Express (service
-- role). RLS est activé et forcé SANS policy pour `authenticated` (deny-all) — le lien seul
-- ne donne jamais accès aux données, et aucun client supabase-js côté navigateur ne peut lire
-- ni écrire ces tables. Le bucket `migration-files` est privé et sans policy storage : seuls
-- les accès service-role (relais serveur + URLs signées serveur) fonctionnent.

begin;

-- ---------------------------------------------------------------------------
-- Table principale : une migration = un projet de transfert pour un workspace
-- ---------------------------------------------------------------------------
create table if not exists public.data_migrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_crm text not null default 'other'
    check (source_crm in ('jobber','housecall_pro','servicetitan','gohighlevel','quickbooks','other','custom_files')),
  status text not null default 'draft'
    check (status in (
      'draft','invitation_sent','waiting_for_files','files_uploaded','parsing','mapping',
      'human_review','waiting_for_client','ready_for_test','testing','test_review',
      'waiting_for_approval','approved','ready_for_final_import','importing',
      'post_import_validation','completed','completed_with_warnings','failed',
      'rolled_back','cancelled'
    )),
  categories text[] not null default array['clients','properties','jobs','visits','invoices']::text[],
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  target_date date,
  internal_notes text,
  invited_user_id uuid,
  invited_email text,
  assigned_admin uuid,
  assigned_assistant uuid,
  freeze_start timestamptz,
  freeze_end timestamptz,
  freeze_confirmed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.data_migrations is
  'Projet de migration assistée ancien CRM → workspace Lume. Accès serveur uniquement (RLS deny-all).';
create index if not exists idx_data_migrations_org on public.data_migrations (org_id) where deleted_at is null;
create index if not exists idx_data_migrations_status on public.data_migrations (status) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Invitations : jeton haché seulement, expiration, révocation, remplacement
-- ---------------------------------------------------------------------------
create table if not exists public.migration_invitations (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  superseded_at timestamptz,
  opened_at timestamptz,
  failed_attempts integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
comment on table public.migration_invitations is
  'Jeton d''invitation au portail de migration. Le jeton brut n''est jamais stocké (SHA-256 seulement).';
create index if not exists idx_migration_invitations_migration on public.migration_invitations (migration_id);

-- ---------------------------------------------------------------------------
-- Fichiers téléversés (stockés dans le bucket privé migration-files)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_files (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  kind text not null default 'data' check (kind in ('data','archive')),
  category_detected text,
  encoding text,
  delimiter text,
  row_count integer,
  column_count integer,
  security_status text not null default 'uploaded'
    check (security_status in ('uploaded','scanning','safe','rejected')),
  security_reason text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending','parsing','parsed','failed')),
  parse_error text,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.migration_files is
  'Fichier source téléversé pour une migration (CSV de données ou PDF d''archive).';
create index if not exists idx_migration_files_migration on public.migration_files (migration_id) where deleted_at is null;
create index if not exists idx_migration_files_sha on public.migration_files (migration_id, sha256) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Colonnes détectées par l'analyse (échantillons TOUJOURS masqués)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_file_columns (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.migration_files(id) on delete cascade,
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  position integer not null,
  header text not null,
  detected_type text not null default 'text',
  empty_ratio numeric(5,4) not null default 0,
  samples_masked jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.migration_file_columns is
  'Colonne d''un fichier analysé. samples_masked ne contient que des valeurs masquées (jamais de PII complète).';
create index if not exists idx_migration_file_columns_file on public.migration_file_columns (file_id);

-- ---------------------------------------------------------------------------
-- Correspondances colonne → champ Lume
-- ---------------------------------------------------------------------------
create table if not exists public.migration_field_mappings (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  file_id uuid not null references public.migration_files(id) on delete cascade,
  column_id uuid not null references public.migration_file_columns(id) on delete cascade,
  target_entity text,
  target_field text,
  confidence integer not null default 0 check (confidence between 0 and 100),
  reason text,
  status text not null default 'suggested'
    check (status in ('suggested','confirmed','corrected','rejected','needs_review')),
  decided_by uuid,
  decided_role text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (column_id)
);
comment on table public.migration_field_mappings is
  'Correspondance proposée/validée entre une colonne importée et un champ Lume.';
create index if not exists idx_migration_field_mappings_migration on public.migration_field_mappings (migration_id);

-- ---------------------------------------------------------------------------
-- Zone de staging : lignes parsées, normalisées, jamais dans les tables actives
-- ---------------------------------------------------------------------------
create table if not exists public.migration_staging_records (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  file_id uuid not null references public.migration_files(id) on delete cascade,
  row_number integer not null,
  entity_type text not null,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  normalized jsonb,
  relations jsonb,
  status text not null default 'pending'
    check (status in ('pending','ready','orphan','duplicate','error','ignored','imported','merged')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.migration_staging_records is
  'Ligne source parsée et normalisée en zone de staging, isolée des données actives du workspace.';
create index if not exists idx_migration_staging_migration on public.migration_staging_records (migration_id, entity_type, status);
create index if not exists idx_migration_staging_file on public.migration_staging_records (file_id);
create index if not exists idx_migration_staging_external on public.migration_staging_records (migration_id, entity_type, external_id);

-- ---------------------------------------------------------------------------
-- Problèmes à résoudre (validation humaine)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_issues (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','error','blocking')),
  entity_type text,
  staging_record_id uuid references public.migration_staging_records(id) on delete set null,
  column_id uuid references public.migration_file_columns(id) on delete set null,
  title text not null,
  details_masked jsonb not null default '{}'::jsonb,
  options jsonb not null default '[]'::jsonb,
  client_visible boolean not null default false,
  client_answer text,
  client_answered_at timestamptz,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.migration_issues is
  'Problème détecté pendant l''analyse/correspondance, envoyé en validation humaine. details_masked sans PII complète.';
create index if not exists idx_migration_issues_migration on public.migration_issues (migration_id, resolved_at);

-- ---------------------------------------------------------------------------
-- Candidats doublons contre les données actives du workspace
-- ---------------------------------------------------------------------------
create table if not exists public.migration_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  staging_record_id uuid not null references public.migration_staging_records(id) on delete cascade,
  existing_table text not null,
  existing_id uuid not null,
  match_reasons text[] not null default '{}'::text[],
  score integer not null default 0 check (score between 0 and 100),
  decision text not null default 'pending'
    check (decision in ('pending','create_new','merge','skip','review')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.migration_duplicate_candidates is
  'Doublon potentiel entre une ligne de staging et un dossier actif existant du workspace.';
create index if not exists idx_migration_dupes_migration on public.migration_duplicate_candidates (migration_id, decision);
create index if not exists idx_migration_dupes_staging on public.migration_duplicate_candidates (staging_record_id);

-- ---------------------------------------------------------------------------
-- Approbations client (rapport versionné, confirmation explicite)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_approvals (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  report_version integer not null default 1,
  report jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('approved','refused','changes_requested')),
  confirmed_text text,
  comment text,
  user_id uuid not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
comment on table public.migration_approvals is
  'Décision du client sur une version précise du rapport d''import test (approbation explicite journalisée).';
create index if not exists idx_migration_approvals_migration on public.migration_approvals (migration_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Lots d'importation (test = dry-run sans écriture, final = écriture réelle)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_import_batches (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  kind text not null default 'test' check (kind in ('test','final')),
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','rolled_back')),
  totals jsonb not null default '{}'::jsonb,
  error text,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.migration_import_batches is
  'Lot d''importation. Un lot final regroupe toutes les entités créées et permet un rollback ciblé (soft-delete).';
create index if not exists idx_migration_batches_migration on public.migration_import_batches (migration_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Registre des entités créées/fusionnées par lot → idempotence + rollback
-- ---------------------------------------------------------------------------
create table if not exists public.migration_import_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.migration_import_batches(id) on delete cascade,
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  staging_record_id uuid not null references public.migration_staging_records(id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  action text not null check (action in ('created','merged','skipped')),
  created_at timestamptz not null default now(),
  unique (migration_id, staging_record_id, entity_table)
);
comment on table public.migration_import_records is
  'Provenance de chaque entité importée : (migration, ligne source, table, id créé). Garantit l''idempotence et la reprise.';
create index if not exists idx_migration_import_records_batch on public.migration_import_records (batch_id);
create index if not exists idx_migration_import_records_entity on public.migration_import_records (entity_table, entity_id);

-- ---------------------------------------------------------------------------
-- Journal d'audit propre à la migration (append-only côté applicatif)
-- ---------------------------------------------------------------------------
create table if not exists public.migration_audit_logs (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  action text not null,
  actor_id uuid,
  actor_role text,
  target text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.migration_audit_logs is
  'Journal d''audit de la migration (création, lien, accès, téléversements, décisions, imports…). Jamais de jeton ni de PII complète dans meta.';
create index if not exists idx_migration_audit_migration on public.migration_audit_logs (migration_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Messages entre le client et l'équipe Lume, journalisés dans la migration
-- ---------------------------------------------------------------------------
create table if not exists public.migration_messages (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.data_migrations(id) on delete cascade,
  author_id uuid not null,
  author_kind text not null check (author_kind in ('client','assistant','admin')),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table public.migration_messages is
  'Fil de clarification entre le client et l''équipe Lume pour une migration.';
create index if not exists idx_migration_messages_migration on public.migration_messages (migration_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS : deny-all pour authenticated (aucune policy), service_role explicite.
-- L'accès passe exclusivement par le serveur Express.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'data_migrations','migration_invitations','migration_files','migration_file_columns',
    'migration_field_mappings','migration_staging_records','migration_issues',
    'migration_duplicate_candidates','migration_approvals','migration_import_batches',
    'migration_import_records','migration_audit_logs','migration_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_service', t);
  end loop;
end $$;

-- updated_at automatique sur les tables qui le portent
do $$
declare
  t text;
begin
  foreach t in array array[
    'data_migrations','migration_files','migration_field_mappings','migration_staging_records',
    'migration_issues','migration_duplicate_candidates','migration_import_batches'
  ] loop
    execute format('drop trigger if exists trg_%s_set_updated_at on public.%I', t, t);
    execute format('create trigger trg_%s_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Bucket privé dédié : aucun accès client (pas de policy storage), le serveur
-- (service role) est le seul chemin de lecture/écriture.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('migration-files', 'migration-files', false, 52428800)
on conflict (id) do nothing;

commit;
