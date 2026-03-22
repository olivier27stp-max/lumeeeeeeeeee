-- ============================================================================
-- Browser-based GPS tracking sessions, points, live locations, and events.
-- Extends the existing location_services migration (20260314000000).
-- Designed for web (navigator.geolocation) now, portable to React Native later.
-- ============================================================================

-- ── Tracking sessions ────────────────────────────────────────────────────────
-- One row per tracking period (punch-in to punch-out or explicit stop).
create table if not exists public.tracking_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null,
  team_id       uuid references public.teams(id) on delete set null,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  source        text not null default 'web' check (source in ('web', 'mobile', 'external')),
  status        text not null default 'active' check (status in ('active', 'stopped', 'lost_permission', 'error', 'expired')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  last_point_at timestamptz,
  point_count   int not null default 0,
  total_distance_m double precision not null default 0,
  metadata      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_tracking_sessions_org_user on public.tracking_sessions (org_id, user_id);
create index idx_tracking_sessions_org_status on public.tracking_sessions (org_id, status) where status = 'active';
create index idx_tracking_sessions_user_active on public.tracking_sessions (user_id) where status = 'active';

alter table public.tracking_sessions enable row level security;
create policy tracking_sessions_select on public.tracking_sessions for select using (public.has_org_membership(auth.uid(), org_id));
create policy tracking_sessions_insert on public.tracking_sessions for insert with check (public.has_org_membership(auth.uid(), org_id));
create policy tracking_sessions_update on public.tracking_sessions for update using (public.has_org_membership(auth.uid(), org_id));

create trigger set_tracking_sessions_updated_at before update on public.tracking_sessions
  for each row execute function public.set_updated_at();

-- ── Tracking points (GPS breadcrumbs) ────────────────────────────────────────
-- High-volume table: one row per accepted GPS reading.
create table if not exists public.tracking_points (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  session_id  uuid not null references public.tracking_sessions(id) on delete cascade,
  user_id     uuid not null,
  team_id     uuid,
  latitude    double precision not null,
  longitude   double precision not null,
  accuracy_m  double precision,
  heading     double precision,
  speed_mps   double precision,
  altitude_m  double precision,
  is_moving   boolean not null default true,
  job_id      uuid,
  recorded_at timestamptz not null default now(),
  raw_payload jsonb
);

-- Partitioning-ready indexes for time-range and spatial queries
create index idx_tracking_points_session on public.tracking_points (session_id, recorded_at);
create index idx_tracking_points_user_day on public.tracking_points (user_id, recorded_at);
create index idx_tracking_points_org_day on public.tracking_points (org_id, recorded_at);

alter table public.tracking_points enable row level security;
create policy tracking_points_select on public.tracking_points for select using (public.has_org_membership(auth.uid(), org_id));
create policy tracking_points_insert on public.tracking_points for insert with check (public.has_org_membership(auth.uid(), org_id));

-- ── Live locations (one row per employee, upserted) ──────────────────────────
-- Optimized for the admin map: SELECT * FROM tracking_live_locations WHERE org_id = $1
create table if not exists public.tracking_live_locations (
  user_id           uuid primary key,
  org_id            uuid not null,
  session_id        uuid references public.tracking_sessions(id) on delete set null,
  team_id           uuid,
  latitude          double precision not null,
  longitude         double precision not null,
  accuracy_m        double precision,
  heading           double precision,
  speed_mps         double precision,
  is_moving         boolean not null default true,
  job_id            uuid,
  recorded_at       timestamptz not null default now(),
  tracking_status   text not null default 'active' check (tracking_status in ('active', 'idle', 'offline', 'stale')),
  updated_at        timestamptz not null default now()
);

create index idx_tracking_live_org on public.tracking_live_locations (org_id);

alter table public.tracking_live_locations enable row level security;
create policy tracking_live_select on public.tracking_live_locations for select using (public.has_org_membership(auth.uid(), org_id));
create policy tracking_live_upsert on public.tracking_live_locations for insert with check (public.has_org_membership(auth.uid(), org_id));
create policy tracking_live_update on public.tracking_live_locations for update using (public.has_org_membership(auth.uid(), org_id));

create trigger set_tracking_live_updated_at before update on public.tracking_live_locations
  for each row execute function public.set_updated_at();

-- ── Tracking events (structured log) ─────────────────────────────────────────
-- Records meaningful transitions: session start/stop, permission changes, job arrivals, idle periods.
create table if not exists public.tracking_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  session_id uuid references public.tracking_sessions(id) on delete cascade,
  user_id    uuid not null,
  event_type text not null check (event_type in (
    'session_start', 'session_stop', 'session_expired',
    'permission_granted', 'permission_denied', 'permission_revoked',
    'gps_error', 'gps_recovered',
    'idle_start', 'idle_end',
    'job_arrival', 'job_departure',
    'tab_hidden', 'tab_visible',
    'network_lost', 'network_recovered',
    'heartbeat'
  )),
  event_at   timestamptz not null default now(),
  latitude   double precision,
  longitude  double precision,
  details    jsonb,
  created_at timestamptz not null default now()
);

create index idx_tracking_events_session on public.tracking_events (session_id, event_at);
create index idx_tracking_events_user_day on public.tracking_events (user_id, event_at);

alter table public.tracking_events enable row level security;
create policy tracking_events_select on public.tracking_events for select using (public.has_org_membership(auth.uid(), org_id));
create policy tracking_events_insert on public.tracking_events for insert with check (public.has_org_membership(auth.uid(), org_id));

-- ── Enable Supabase Realtime on live locations for the admin map ─────────────
alter publication supabase_realtime add table public.tracking_live_locations;
