-- ═══════════════════════════════════════════════════════════════
-- Client inactif + lien de réservation (drapeau `auto_client_inactif`).
--
-- ADDITIF : deux tables neuves et deux fonctions neuves. Rien d'existant
-- n'est modifié. Tout est réservé au serveur (service_role) : RLS forcée
-- sans politique pour anon ni authenticated, fonctions révoquées nommément.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Un seul déclenchement par période d'inactivité ──────────
-- La période = le DERNIER job terminé du client (ou 'aucun'). Un nouveau job
-- terminé change la période : le client pourra redevenir « inactif » plus
-- tard et déclencher à nouveau. `mois` : deux règles à 6 et 12 mois sont
-- deux seuils distincts.
create table if not exists public.clients_inactifs_declenches (
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  mois integer not null,
  periode text not null,
  declenche_at timestamptz not null default now(),
  primary key (org_id, client_id, mois, periode)
);
comment on table public.clients_inactifs_declenches is
  'Déclencheur « Client inactif » : ce qui est déjà parti (1 fois par période d''inactivité, par seuil). Sert aussi au plafond d''envois par heure.';
create index if not exists idx_clients_inactifs_declenches_heure
  on public.clients_inactifs_declenches (org_id, declenche_at desc);
alter table public.clients_inactifs_declenches enable row level security;
alter table public.clients_inactifs_declenches force row level security;
revoke all on table public.clients_inactifs_declenches from anon, authenticated;

-- ── 2. Liens de réservation ─────────────────────────────────────
-- Seule l'EMPREINTE du jeton est gardée (sha-256) : une fuite de la table
-- ne donne aucun lien utilisable. Un lien = un client, 30 jours.
create table if not exists public.liens_reservation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  jeton_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  derniere_demande_at timestamptz
);
comment on table public.liens_reservation is
  'Variable {{client.lien_reservation}} : page publique par jeton (empreinte seulement), 30 jours, un client.';
create index if not exists idx_liens_reservation_client on public.liens_reservation (org_id, client_id);
alter table public.liens_reservation enable row level security;
alter table public.liens_reservation force row level security;
revoke all on table public.liens_reservation from anon, authenticated;

-- ── 3. Les clients inactifs d'une entreprise ────────────────────
-- Inactif depuis p_mois =
--   · client non supprimé, non archivé, ni « inactif » (archivage manuel)
--     ni prospect ;
--   · au moins UN job terminé (sinon ce n'est pas un ancien client) ;
--   · aucun job terminé depuis p_mois ;
--   · aucun job à venir (planifié / en cours) ni visite future.
-- `periode` = l'id du dernier job terminé.
-- Les clients déjà déclenchés pour ce seuil et cette période sont exclus.
create or replace function public.clients_inactifs(p_org_id uuid, p_mois integer, p_limite integer default 1000)
returns table (client_id uuid, periode text, dernier_job_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with termines as (
    select j.client_id,
           j.id as job_id,
           coalesce(j.completed_at, j.closed_at, j.end_at, j.updated_at) as fin,
           row_number() over (partition by j.client_id order by coalesce(j.completed_at, j.closed_at, j.end_at, j.updated_at) desc) as rang
    from public.jobs j
    where j.org_id = p_org_id and j.deleted_at is null and j.status = 'completed' and j.client_id is not null
  )
  select c.id, t.job_id::text, t.fin
  from public.clients c
  join termines t on t.client_id = c.id and t.rang = 1
  where c.org_id = p_org_id
    and c.deleted_at is null
    and c.archived_at is null
    and coalesce(c.status, '') not in ('inactive', 'lead')
    and t.fin < now() - make_interval(months => greatest(p_mois, 1))
    and not exists (
      select 1 from public.jobs a
      where a.org_id = p_org_id and a.client_id = c.id and a.deleted_at is null
        and a.status in ('scheduled', 'in_progress')
    )
    and not exists (
      select 1 from public.schedule_events e
      join public.jobs je on je.id = e.job_id
      where e.org_id = p_org_id and je.client_id = c.id
        and e.deleted_at is null and coalesce(e.status, '') <> 'cancelled'
        and e.start_at > now()
    )
    and not exists (
      select 1 from public.clients_inactifs_declenches d
      where d.org_id = p_org_id and d.client_id = c.id and d.mois = p_mois and d.periode = t.job_id::text
    )
  order by t.fin asc
  limit greatest(coalesce(p_limite, 1000), 0);
$fn$;
revoke all on function public.clients_inactifs(uuid, integer, integer) from public, anon, authenticated;

commit;
