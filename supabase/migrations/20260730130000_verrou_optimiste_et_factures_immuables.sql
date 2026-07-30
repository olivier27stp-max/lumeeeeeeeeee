-- ═══════════════════════════════════════════════════════════════
-- Verrouillage optimiste + immuabilité des factures émises
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Verrouillage optimiste (lost update) ───────────────────
--
-- Scénario déjà possible aujourd'hui : deux répartiteurs ouvrent la même
-- job. Le premier assigne Marc et sauve. Le second, qui avait chargé la
-- page avant, sauve à son tour : son formulaire contient encore l'ancienne
-- valeur, donc l'assignation de Marc disparaît. Aucune erreur n'est levée,
-- la donnée est simplement perdue. C'est le bug par défaut de tout CRM
-- multi-utilisateur, et il ne se manifeste jamais en dev — un seul onglet.
--
-- 2 organisations ont plusieurs membres, dont une équipe de 8 : le risque
-- est réel, pas théorique.
--
-- `version` s'incrémente par trigger à chaque modification réelle. Le
-- client renvoie la version qu'il a lue ; si elle ne correspond plus,
-- l'UPDATE touche 0 ligne et l'app affiche le conflit au lieu d'écraser
-- (voir src/lib/jobsApi.ts).

alter table public.jobs     add column if not exists version integer not null default 1;
alter table public.quotes   add column if not exists version integer not null default 1;
alter table public.invoices add column if not exists version integer not null default 1;

-- SECURITY INVOKER : la fonction ne fait qu'incrémenter un compteur, aucune
-- raison de lui accorder les droits du propriétaire.
create or replace function public.bump_row_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Un UPDATE qui ne change rien ne doit pas invalider la version d'autrui.
  if new is distinct from old then
    new.version := coalesce(old.version, 0) + 1;
  end if;
  return new;
end $$;

drop trigger if exists jobs_bump_version on public.jobs;
create trigger jobs_bump_version
  before update on public.jobs
  for each row execute function public.bump_row_version();

drop trigger if exists quotes_bump_version on public.quotes;
create trigger quotes_bump_version
  before update on public.quotes
  for each row execute function public.bump_row_version();

drop trigger if exists invoices_bump_version on public.invoices;
create trigger invoices_bump_version
  before update on public.invoices
  for each row execute function public.bump_row_version();

-- Le client lit la version mais ne l'écrit jamais, sinon il contourne le
-- mécanisme en renvoyant simplement la valeur courante.
revoke update (version) on public.jobs     from authenticated, anon;
revoke update (version) on public.quotes   from authenticated, anon;
revoke update (version) on public.invoices from authenticated, anon;


-- ── 2. Immuabilité des factures émises ────────────────────────
--
-- Une facture envoyée au client est une pièce comptable : Revenu Québec
-- exige qu'elle ne soit pas réécrite après coup. La correction passe par
-- une note de crédit ou une annulation suivie d'une nouvelle facture,
-- jamais par la modification des montants d'une facture déjà transmise.
--
-- Sans ce trigger, un membre peut changer total_cents d'une facture payée,
-- ce qui désynchronise la comptabilité du client de ce qu'il a réellement
-- payé — et de ce que Stripe a encaissé.
--
-- Restent modifiables après émission, parce qu'ils décrivent le SUIVI et
-- non le contenu : status, balance_cents, paid_at (un paiement arrive),
-- notes, deleted_at (archivage logique), updated_at / version.
--
-- service_role n'est PAS exempté : le webhook Stripe ne touche que
-- balance_cents / paid_at / status, tous autorisés. Une exemption
-- ouvrirait un contournement complet via l'API serveur.
--
-- Vérifié en production : modification de montant refusée (42501),
-- enregistrement d'un paiement accepté, brouillon toujours modifiable.

create or replace function public.enforce_invoice_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(old.status, 'draft') = 'draft' then
    return new;
  end if;

  if new.total_cents    is distinct from old.total_cents
  or new.subtotal_cents is distinct from old.subtotal_cents
  or new.tax_cents      is distinct from old.tax_cents
  or new.invoice_number is distinct from old.invoice_number
  or new.client_id      is distinct from old.client_id
  or new.due_date       is distinct from old.due_date
  or new.issued_at      is distinct from old.issued_at
  or new.subject        is distinct from old.subject
  then
    raise exception
      'Cette facture a deja ete emise (statut %). Ses montants et son numero ne peuvent plus etre modifies : creez une note de credit ou annulez-la, puis emettez une nouvelle facture.',
      old.status
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists invoices_immutable on public.invoices;
create trigger invoices_immutable
  before update on public.invoices
  for each row execute function public.enforce_invoice_immutability();
