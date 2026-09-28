-- ═══════════════════════════════════════════════════════════════
-- Paiement échoué — la table des événements Stripe DÉJÀ traités.
--
-- ADDITIF : une table neuve, rien d'autre.
--
-- Le déclencheur « Paiement échoué » (drapeau `auto_paiement_echoue`,
-- server/lib/paiement-echoue.ts) RÉSERVE l'id de l'événement Stripe ici
-- AVANT d'émettre. Un webhook rejoué (Stripe réessaie tant qu'il n'a pas
-- reçu 200, et `webhook_events` rejoue les lignes en échec) tombe sur la clé
-- primaire : l'automatisation ne part qu'une fois.
--
-- Réservée au serveur : RLS activée sans aucune politique pour anon ni
-- authenticated (seul service_role, qui contourne la RLS, y écrit).
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.paiements_echoues_traites (
  stripe_event_id text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  invoice_id uuid not null,
  payment_intent_id text,
  created_at timestamptz not null default now()
);

comment on table public.paiements_echoues_traites is
  'Événements Stripe payment_intent.payment_failed déjà transformés en déclencheur « Paiement échoué » (idempotence).';

create index if not exists idx_paiements_echoues_traites_org
  on public.paiements_echoues_traites (org_id, created_at desc);

alter table public.paiements_echoues_traites enable row level security;
alter table public.paiements_echoues_traites force row level security;
revoke all on table public.paiements_echoues_traites from anon, authenticated;

commit;
