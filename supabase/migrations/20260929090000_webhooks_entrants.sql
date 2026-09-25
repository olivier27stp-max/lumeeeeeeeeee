-- ═══════════════════════════════════════════════════════════════
-- WEBHOOKS ENTRANTS — déclencher une automatisation depuis l'extérieur
--
-- POURQUOI. Les automatisations ne partaient que d'événements NÉS dans
-- Lume (lead créé, devis envoyé…). Un formulaire sur le site de
-- l'entreprise, Zapier, Facebook Leads, un fournisseur d'appels : rien de
-- tout ça ne pouvait rien déclencher. À la question « est-ce que ça se
-- branche à mon site ? », la réponse était non.
--
-- CE QU'ON AJOUTE. Une URL par entreprise, avec sa clé. Le service
-- extérieur y POSTe du JSON ; Lume émet un événement `webhook.received`
-- que les automatisations peuvent viser.
--
-- SÉCURITÉ — le patron est celui de `request_forms`, déjà éprouvé :
--   · `api_key` = 32 octets aléatoires (256 bits) ; deviner est exclu ;
--   · la clé est le SEUL secret : pas de session, pas de cookie, donc
--     rien à voler côté navigateur ;
--   · `enabled` coupe l'entrée sans supprimer la configuration ;
--   · `deleted_at` : effacement doux, comme partout ailleurs ;
--   · RLS : lecture/écriture réservées aux membres de l'entreprise. La
--     route publique passe par le client service_role, qui cherche la
--     clé — jamais l'utilisateur.
--
-- ADDITIVE ET RÉVERSIBLE. Deux tables neuves, aucune colonne touchée,
-- aucune donnée déplacée. Rollback = `drop table` des deux (en bas).
-- ═══════════════════════════════════════════════════════════════

-- ── L'entrée : une URL, une clé ──────────────────────────────

create table if not exists public.automation_webhooks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,

  -- Le nom que l'utilisateur lui donne (« Formulaire du site »).
  name        text not null default 'Webhook',

  -- Le secret. Même forme que `request_forms.api_key` : 32 octets en hex.
  api_key     text not null default encode(gen_random_bytes(32), 'hex'),

  -- Couper l'entrée sans perdre la configuration ni l'historique.
  enabled     boolean not null default true,

  -- Ce que l'appel doit produire. Pour l'instant un seul mode : émettre
  -- l'événement. La colonne existe pour que l'ajout d'un mode (créer
  -- directement un lead, par exemple) ne demande pas de migration.
  mode        text not null default 'evenement'
              check (mode in ('evenement')),

  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- La clé est cherchée à CHAQUE appel entrant, sans org_id (l'appelant ne
-- le connaît pas) : c'est le seul index qui compte pour la latence.
create unique index if not exists automation_webhooks_api_key_idx
  on public.automation_webhooks (api_key);

create index if not exists automation_webhooks_org_idx
  on public.automation_webhooks (org_id) where deleted_at is null;

-- ── Le journal : ce qui est entré, et ce qu'on en a fait ─────

/*
 * Sans trace, un webhook qui « ne marche pas » est indébogable : on ne
 * sait pas si l'appel est arrivé, s'il a été refusé, ni pourquoi. C'est
 * la première question du support à chaque intégration.
 */
create table if not exists public.automation_webhook_receipts (
  id          uuid primary key default gen_random_uuid(),
  webhook_id  uuid not null references public.automation_webhooks(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,

  -- 'accepte' | 'refuse'. Le motif dit lequel des refus.
  statut      text not null check (statut in ('accepte', 'refuse')),
  motif       text,

  -- Le corps reçu, tel quel. Borné côté serveur avant écriture : un
  -- appelant ne doit pas pouvoir remplir la base avec un seul POST.
  corps       jsonb,

  -- L'événement émis, quand il l'a été.
  event_id    uuid,

  created_at  timestamptz not null default now()
);

create index if not exists automation_webhook_receipts_webhook_idx
  on public.automation_webhook_receipts (webhook_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.automation_webhooks enable row level security;
alter table public.automation_webhooks force row level security;
alter table public.automation_webhook_receipts enable row level security;
alter table public.automation_webhook_receipts force row level security;

/*
 * Même clé de permission que les automatisations elles-mêmes : qui peut
 * modifier une automatisation peut créer son entrée. Créer un webhook,
 * c'est ouvrir une porte sur l'entreprise — ça ne peut pas être plus
 * permissif que le reste.
 */
drop policy if exists automation_webhooks_select on public.automation_webhooks;
create policy automation_webhooks_select on public.automation_webhooks
  for select using (
    has_org_membership(auth.uid(), org_id)
    and member_has_permission(auth.uid(), org_id, 'automations.read')
  );

drop policy if exists automation_webhooks_write on public.automation_webhooks;
create policy automation_webhooks_write on public.automation_webhooks
  for all using (
    has_org_membership(auth.uid(), org_id)
    and member_has_permission(auth.uid(), org_id, 'automations.update')
  ) with check (
    has_org_membership(auth.uid(), org_id)
    and member_has_permission(auth.uid(), org_id, 'automations.update')
  );

-- Le journal est en LECTURE seule pour tout le monde : seul le serveur
-- (service_role) y écrit. Une trace qu'on peut réécrire ne prouve rien.
drop policy if exists automation_webhook_receipts_select on public.automation_webhook_receipts;
create policy automation_webhook_receipts_select on public.automation_webhook_receipts
  for select using (
    has_org_membership(auth.uid(), org_id)
    and member_has_permission(auth.uid(), org_id, 'automations.read')
  );

-- ── Privilèges ───────────────────────────────────────────────

/*
 * Un projet Supabase neuf accorde TOUT à `authenticated` sur les tables
 * nouvelles : on révoque d'abord, puis on n'accorde que le nécessaire.
 * Sans ce revoke, la RLS resterait la seule barrière — et une policy
 * oubliée deviendrait une fuite.
 */
revoke all on public.automation_webhooks from anon, authenticated;
revoke all on public.automation_webhook_receipts from anon, authenticated;

grant select, insert, update, delete on public.automation_webhooks to authenticated;
grant select on public.automation_webhook_receipts to authenticated;

-- ── `updated_at` ─────────────────────────────────────────────

drop trigger if exists automation_webhooks_updated_at on public.automation_webhooks;
create trigger automation_webhooks_updated_at
  before update on public.automation_webhooks
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (à jouer tel quel pour revenir en arrière) :
--
--   drop table if exists public.automation_webhook_receipts;
--   drop table if exists public.automation_webhooks;
--
-- Rien d'autre n'est touché : aucune colonne existante, aucune donnée
-- déplacée. Les automatisations qui viseraient `webhook.received`
-- cesseraient simplement de se déclencher.
-- ═══════════════════════════════════════════════════════════════
