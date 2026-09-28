-- Outbox des événements du CRM (M8 / F9-F10-F12 de l'audit des automatisations).
-- ─────────────────────────────────────────────────────────────────────────────
-- LE PROBLÈME. `eventBus.emit()` (server/lib/eventBus.ts) écrit dans
-- `activity_log` puis émet EN MÉMOIRE vers le moteur d'automatisations.
-- `activity_log` est un JOURNAL : personne ne le relit. Si le processus meurt
-- entre l'émission et la fin du traitement — déploiement Railway, plantage —
-- l'événement est perdu : la confirmation, la relance, le rappel ne partent
-- jamais, et rien ne le signale.
--
-- LA CORRECTION. Chaque événement est d'abord consigné ici, puis émis. Quand
-- TOUS les écouteurs ont fini, la ligne est cochée (`processed_at`). Une ligne
-- restée non cochée plus de quelques minutes est un orphelin de crash : le
-- tick du planificateur la rejoue.
--
-- Même patron que `pipeline_events` (20260923100100), qui tourne en prod.
-- Les trois types `deal.*` restent sur leur propre file, alimentée par
-- trigger : le serveur ne les consigne pas ici une deuxième fois.
--
-- Pourquoi `entity_id` et `actor_id` en TEXT : c'est une file, pas un modèle
-- relationnel. Une insertion refusée pour un identifiant inattendu ferait
-- perdre l'événement — exactement ce qu'on veut empêcher.
--
-- Accès : serveur seulement (service_role). RLS forcée, aucune policy, et
-- privilèges retirés nommément à anon/authenticated (les défauts Supabase les
-- accordent sur toute table neuve).

begin;

create table if not exists public.domain_events (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references public.orgs(id) on delete cascade,
  type                text not null,
  entity_type         text not null,
  entity_id           text not null,
  actor_id            text,
  related_entity_type text,
  related_entity_id   text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz,
  attempts            integer not null default 0,
  last_error          text
);

-- Les règles d'automatisation déjà traitées pour CET événement. Le moteur
-- les ajoute une à une ; un rejeu les saute. C'est ce qui empêche un
-- traitement coupé à mi-chemin de renvoyer, au rejeu, les messages des
-- règles qui étaient déjà passées. (L'index d'idempotence des actions
-- immédiates ne suffit pas : il ne couvre ni les actions différées déjà
-- exécutées, ni les règles « laisser le client repasser ».)
alter table public.domain_events
  add column if not exists regles_traitees uuid[] not null default '{}';

-- L'index du consommateur : les non-traités, par ordre d'arrivée.
create index if not exists idx_domain_events_a_traiter
  on public.domain_events (created_at)
  where processed_at is null;

-- Le ménage supprime les lignes traitées depuis plus de 14 jours.
create index if not exists idx_domain_events_traites
  on public.domain_events (processed_at)
  where processed_at is not null;

alter table public.domain_events enable row level security;
alter table public.domain_events force row level security;

revoke all on table public.domain_events from public, anon, authenticated;
grant select, insert, update, delete on table public.domain_events to service_role;

comment on table public.domain_events is
  'Outbox des événements du CRM émis par le serveur (eventBus). Une ligne est consignée AVANT l''émission en mémoire et cochée quand tous les écouteurs ont fini ; le planificateur rejoue les orphelins d''un redémarrage. Les événements deal.* vivent dans pipeline_events.';

commit;
