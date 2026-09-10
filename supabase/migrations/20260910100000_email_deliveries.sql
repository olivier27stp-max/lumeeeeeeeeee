-- ═══════════════════════════════════════════════════════════════
-- Suivi de livraison des courriels transactionnels
-- ─────────────────────────────────────────────────────────────
-- Audit QA prod 2026-09-09, n°8 (prouvé en prod) : une facture envoyée à
-- qa-viktor@example.invalid (TLD réservé, jamais délivrable) a répondu
-- 200 { ok: true }, l'app a affiché « Invoice sent! », la facture est passée
-- en attente de paiement. sendEmail() renvoie `sent: true` dès que le relais
-- accepte le message ; un rebond arrive plus tard, par courriel, et n'était
-- jamais capté. Une adresse mal saisie = une facture éternellement « envoyée,
-- en attente », et personne ne sait que le client ne l'a jamais reçue.
--
-- Cette table est le journal : une ligne par courriel parti (statut `sent`),
-- mise à jour par le webhook du fournisseur (delivered / bounced /
-- complained / delayed). L'interface lit la DERNIÈRE ligne d'une entité pour
-- afficher « courriel non livré », et les relances automatiques sautent une
-- adresse qui a rebondi.
create table if not exists public.email_deliveries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.orgs(id) on delete cascade,
  provider      text not null default 'smtp',          -- 'resend' | 'smtp'
  message_id    text not null,                          -- id fournisseur (Resend) ou Message-ID SMTP
  to_email      text not null,
  subject       text,
  entity_type   text,                                   -- 'invoice' | 'quote' | 'reminder' | 'agreement' | …
  entity_id     uuid,
  status        text not null default 'sent'
                check (status in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists email_deliveries_message_id_key
  on public.email_deliveries (message_id);

-- « Dernier courriel de cette facture » et « cette adresse a-t-elle rebondi ? »
create index if not exists idx_email_deliveries_entity
  on public.email_deliveries (org_id, entity_type, entity_id, created_at desc);
create index if not exists idx_email_deliveries_bounced
  on public.email_deliveries (org_id, lower(to_email))
  where status in ('bounced', 'complained');

comment on table public.email_deliveries is
  'Un courriel transactionnel par ligne. Statut mis à jour par POST /api/webhooks/email (Resend). Lu par l''interface (badge « non livré ») et par les relances (adresses à sauter).';

drop trigger if exists set_email_deliveries_updated_at on public.email_deliveries;
create trigger set_email_deliveries_updated_at
  before update on public.email_deliveries
  for each row execute function public.set_updated_at();

-- ── Sécurité ──
alter table public.email_deliveries enable row level security;
alter table public.email_deliveries force row level security;

-- Écrit uniquement par le serveur (service_role) : l'envoi et le webhook.
drop policy if exists "email_deliveries_service" on public.email_deliveries;
create policy "email_deliveries_service" on public.email_deliveries
  as permissive for all to service_role
  using (true) with check (true);

-- Lu par les membres de l'org (badge sur la facture / le devis).
drop policy if exists "email_deliveries_select_org" on public.email_deliveries;
create policy "email_deliveries_select_org" on public.email_deliveries
  as permissive for select to authenticated
  using (org_id is not null and public.has_org_membership((select auth.uid()), org_id));

revoke all on public.email_deliveries from anon;
revoke all on public.email_deliveries from authenticated;
grant select on public.email_deliveries to authenticated;
