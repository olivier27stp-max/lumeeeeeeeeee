-- ═══════════════════════════════════════════════════════════════
-- Launch 2026-09-28 — bloc 2 : aucun événement d'automatisation perdu.
--
-- AVANT : appointment.created/cancelled, job.completed, quote.approved/
-- declined et invoice.sent partaient en partie DU NAVIGATEUR (« tire et
-- oublie ») : onglet fermé, réseau coupé, 500 → événement perdu, jamais
-- rejoué. Le refus d'un devis depuis l'app appelait même une route qui
-- n'existe pas (404 silencieux), et les factures récurrentes ou « envoyer
-- maintenant » n'émettaient jamais invoice.sent.
--
-- MAINTENANT : un trigger sur la TRANSITION de statut écrit l'événement dans
-- `automation_evenements_base`, dans la MÊME transaction que le changement.
-- Le serveur la lit toutes les 15 s et la passe au bus (qui la consigne dans
-- l'outbox `domain_events` : même durabilité que le reste). Même principe que
-- `pipeline_events`, qui fonctionne déjà pour les deals.
--
-- Dédoublonnage : (org, type, entité, clé de transition). La clé porte
-- l'identifiant de la transaction : un même changement ne produit qu'un
-- événement, mais un devis refusé, rouvert puis refusé à nouveau en produit
-- bien deux.
--
-- invoice.paid reste émis par le SERVEUR après l'écriture du paiement
-- (payments.ts, route « Marquer payée ») : il porte le montant et le moyen
-- de paiement de CHAQUE paiement, ce qu'une transition de statut ne dit pas.
--
-- Réversible : voir le bloc DOWN en fin de fichier.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.automation_evenements_base (
  id                  bigserial primary key,
  org_id              uuid        not null,
  type                text        not null,
  entity_type         text        not null,
  entity_id           uuid        not null,
  related_entity_type text,
  related_entity_id   uuid,
  metadata            jsonb       not null default '{}'::jsonb,
  cle                 text        not null,
  created_at          timestamptz not null default now(),
  traite_at           timestamptz,
  attempts            integer     not null default 0,
  last_error          text
);

comment on table public.automation_evenements_base is
  'Événements d''automatisation écrits par trigger (transition de statut), lus par le serveur toutes les 15 s et passés au bus. Jamais perdus : même transaction que le changement.';

create unique index if not exists automation_evenements_base_dedup
  on public.automation_evenements_base (org_id, type, entity_id, cle);
create index if not exists automation_evenements_base_a_traiter
  on public.automation_evenements_base (id) where traite_at is null;

-- Lecture et écriture réservées au serveur (service_role) : RLS activée,
-- aucune policy, droits retirés NOMMÉMENT (les défauts Supabase les donnent
-- à anon et authenticated).
alter table public.automation_evenements_base enable row level security;
revoke all on table public.automation_evenements_base from public, anon, authenticated;
revoke all on sequence public.automation_evenements_base_id_seq from public, anon, authenticated;

-- ── Écriture d'un événement (appelée par les triggers) ──────────
create or replace function public.automation_consigner_evenement(
  p_org uuid, p_type text, p_entity_type text, p_entity_id uuid,
  p_cle text, p_metadata jsonb, p_related_type text, p_related_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or p_entity_id is null then
    return;
  end if;
  insert into public.automation_evenements_base
    (org_id, type, entity_type, entity_id, cle, metadata, related_entity_type, related_entity_id)
  values
    (p_org, p_type, p_entity_type, p_entity_id, p_cle, coalesce(p_metadata, '{}'::jsonb), p_related_type, p_related_id)
  on conflict (org_id, type, entity_id, cle) do nothing;
end;
$$;
revoke all on function public.automation_consigner_evenement(uuid, text, text, uuid, text, jsonb, text, uuid) from public, anon, authenticated;

-- ── Rendez-vous : créé / annulé ─────────────────────────────────
create or replace function public.trg_automation_evenements_visite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  select j.client_id into v_client from public.jobs j where j.id = new.job_id;

  if tg_op = 'INSERT' then
    if new.deleted_at is null and coalesce(new.status, 'scheduled') <> 'cancelled' then
      perform public.automation_consigner_evenement(
        new.org_id, 'appointment.created', 'schedule_event', new.id, 'creation',
        jsonb_build_object('job_id', new.job_id, 'client_id', v_client,
                           'start_time', coalesce(new.start_at, new.start_time), 'title', new.title, 'origine', 'base'),
        case when new.job_id is null then null else 'job' end, new.job_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.status, '') = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
      perform public.automation_consigner_evenement(
        new.org_id, 'appointment.cancelled', 'schedule_event', new.id, 'annulation:' || txid_current()::text,
        jsonb_build_object('job_id', new.job_id, 'client_id', v_client,
                           'start_time', coalesce(new.start_at, new.start_time), 'origine', 'base'),
        case when new.job_id is null then null else 'job' end, new.job_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.trg_automation_evenements_visite() from public, anon, authenticated;

drop trigger if exists automation_evenements_visite on public.schedule_events;
create trigger automation_evenements_visite
  after insert or update of status on public.schedule_events
  for each row execute function public.trg_automation_evenements_visite();

-- ── Job : terminé ───────────────────────────────────────────────
create or replace function public.trg_automation_evenements_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.deleted_at is null then
    perform public.automation_consigner_evenement(
      new.org_id, 'job.completed', 'job', new.id, 'termine:' || txid_current()::text,
      jsonb_build_object('job_name', new.title, 'client_id', new.client_id, 'origine', 'base'),
      case when new.client_id is null then null else 'client' end, new.client_id);
  end if;
  return null;
end;
$$;
revoke all on function public.trg_automation_evenements_job() from public, anon, authenticated;

drop trigger if exists automation_evenements_job on public.jobs;
create trigger automation_evenements_job
  after update of status on public.jobs
  for each row execute function public.trg_automation_evenements_job();

-- ── Devis : accepté / refusé ────────────────────────────────────
create or replace function public.trg_automation_evenements_devis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null or new.status is not distinct from old.status then
    return null;
  end if;
  if new.status in ('approved', 'declined') then
    perform public.automation_consigner_evenement(
      new.org_id, case new.status when 'approved' then 'quote.approved' else 'quote.declined' end,
      'quote', new.id, new.status || ':' || txid_current()::text,
      jsonb_build_object('quote_number', new.quote_number, 'client_id', coalesce(new.client_id, new.lead_id),
                         'lead_id', new.lead_id, 'origine', 'base'),
      case when coalesce(new.client_id, new.lead_id) is null then null else 'client' end, coalesce(new.client_id, new.lead_id));
  end if;
  return null;
end;
$$;
revoke all on function public.trg_automation_evenements_devis() from public, anon, authenticated;

drop trigger if exists automation_evenements_devis on public.quotes;
create trigger automation_evenements_devis
  after update of status on public.quotes
  for each row execute function public.trg_automation_evenements_devis();

-- ── Facture : envoyée ───────────────────────────────────────────
-- À la création déjà « envoyée » (factures récurrentes) ou au passage de
-- brouillon à envoyée (courriel, « envoyer maintenant », marquée envoyée).
create or replace function public.trg_automation_evenements_facture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null and new.status = 'sent'
     and (tg_op = 'INSERT' or coalesce(old.status, 'draft') = 'draft') then
    perform public.automation_consigner_evenement(
      new.org_id, 'invoice.sent', 'invoice', new.id, 'envoi',
      jsonb_build_object('invoice_number', new.invoice_number, 'client_id', new.client_id, 'origine', 'base'),
      case when new.client_id is null then null else 'client' end, new.client_id);
  end if;
  return null;
end;
$$;
revoke all on function public.trg_automation_evenements_facture() from public, anon, authenticated;

drop trigger if exists automation_evenements_facture on public.invoices;
create trigger automation_evenements_facture
  after insert or update of status on public.invoices
  for each row execute function public.trg_automation_evenements_facture();

commit;

-- ═══════════════════════════════════════════════════════════════
-- DOWN (à appliquer tel quel pour revenir en arrière) :
--
-- begin;
-- drop trigger if exists automation_evenements_visite on public.schedule_events;
-- drop trigger if exists automation_evenements_job on public.jobs;
-- drop trigger if exists automation_evenements_devis on public.quotes;
-- drop trigger if exists automation_evenements_facture on public.invoices;
-- drop function if exists public.trg_automation_evenements_visite();
-- drop function if exists public.trg_automation_evenements_job();
-- drop function if exists public.trg_automation_evenements_devis();
-- drop function if exists public.trg_automation_evenements_facture();
-- drop function if exists public.automation_consigner_evenement(uuid, text, text, uuid, text, jsonb, text, uuid);
-- drop table if exists public.automation_evenements_base;
-- commit;
-- ═══════════════════════════════════════════════════════════════
