-- Chaque entreprise envoie depuis son propre domaine (2026-09-17).
--
-- Aujourd'hui tous les courriels partent de « {Entreprise} <noreply@lumecrm.net> »
-- avec Reply-To vers la boîte de l'entreprise. Cette table permet à une
-- entreprise de faire vérifier SON domaine chez Resend (SPF + DKIM) et
-- d'envoyer ensuite depuis « facturation@sondomaine.ca ».
--
-- Une ligne par org (unique). Écrite par le serveur seul (service_role, via
-- l'API Resend Domains) ; les membres de l'org la LISENT pour afficher les
-- enregistrements DNS à coller et le statut.
create table if not exists public.org_sending_domains (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null unique references public.orgs(id) on delete cascade,
  domain            text not null,
  resend_domain_id  text,
  from_local_part   text not null default 'facturation',
  status            text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  -- Les enregistrements DNS tels que Resend les renvoie : [{ record, type, name, value, ttl, status, priority }]
  dns_records       jsonb not null default '[]'::jsonb,
  last_checked_at   timestamptz,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.org_sending_domains is 'Domaine d''envoi propre à une entreprise (Resend Domains). Écriture serveur seulement ; lecture par les membres de l''org.';
comment on column public.org_sending_domains.from_local_part is 'Partie locale de l''expéditeur : facturation@{domain}.';
comment on column public.org_sending_domains.dns_records is 'Enregistrements DNS à coller, copiés de la réponse Resend (type, name, value, ttl, status).';

create index if not exists org_sending_domains_verified
  on public.org_sending_domains (org_id) where status = 'verified';

alter table public.org_sending_domains enable row level security;
alter table public.org_sending_domains force row level security;

-- Le serveur (service_role) écrit tout.
drop policy if exists "org_sending_domains_service" on public.org_sending_domains;
create policy "org_sending_domains_service" on public.org_sending_domains
  as permissive for all to service_role
  using (true) with check (true);

-- Les membres de l'org lisent (page Paramètres entreprise).
drop policy if exists "org_sending_domains_select_org" on public.org_sending_domains;
create policy "org_sending_domains_select_org" on public.org_sending_domains
  as permissive for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));

-- Les GRANT par défaut de Supabase donnent ALL à authenticated : on ne laisse que la lecture.
revoke all on public.org_sending_domains from anon;
revoke all on public.org_sending_domains from authenticated;
grant select on public.org_sending_domains to authenticated;
