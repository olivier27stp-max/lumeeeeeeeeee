-- ═══════════════════════════════════════════════════════════════
-- Suivi d'ouverture et de clic des courriels (plan courriels pro, 2026-09-17)
-- ─────────────────────────────────────────────────────────────
-- Resend pousse email.opened / email.clicked par le même webhook que les
-- rebonds (POST /api/webhooks/email). Le suivi est activé PAR DOMAINE chez
-- Resend (pixel et réécriture des liens de leur côté) ; ici on ne fait que
-- recevoir et afficher : « Envoyé le 17 sept. · Vu le 17 sept. à 14 h 12 ·
-- Lien cliqué » sur la facture / la soumission de l'entreprise.
--
-- Loi 25 : aucun suivi sur les courriels de compte/abonnement que Lume envoie
-- à ses propres abonnés. La fonction ci-dessous refuse toute ligne sans
-- entity_type et toute ligne dont le type est dans la liste « compte »
-- transmise par le serveur (ENTITES_SANS_SUIVI dans webhooks-email.ts) —
-- même si Resend nous envoie l'évènement.
alter table public.email_deliveries
  add column if not exists opened_at        timestamptz,
  add column if not exists open_count       integer not null default 0,
  add column if not exists clicked_at       timestamptz,
  add column if not exists click_count      integer not null default 0,
  add column if not exists last_clicked_url text;

comment on column public.email_deliveries.opened_at is 'Première ouverture (email.opened Resend). Jamais renseigné pour les courriels de compte Lume (Loi 25).';
comment on column public.email_deliveries.clicked_at is 'Premier clic sur un lien (email.clicked Resend).';

-- « Tous les envois de cette entité » (GET /api/email-deliveries) — l'index
-- existant commence par org_id ; celui-ci sert la lecture par entité seule.
create index if not exists idx_email_deliveries_entity_type_id
  on public.email_deliveries (entity_type, entity_id);

-- Compteur atomique : deux ouvertures qui arrivent en même temps ne s'écrasent
-- pas (un UPDATE lu-puis-écrit côté serveur en perdrait une). Retourne les
-- lignes touchées (un message à plusieurs destinataires porte le suffixe #i).
create or replace function public.email_deliveries_enregistrer_suivi(
  p_email_id     text,
  p_evenement    text,                      -- 'opened' | 'clicked'
  p_quand        timestamptz,
  p_url          text default null,
  p_types_exclus text[] default '{}'
)
returns table (id uuid, org_id uuid, entity_type text, entity_id uuid)
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.email_deliveries d
  set
    opened_at        = case when p_evenement = 'opened'  then coalesce(d.opened_at, p_quand)  else d.opened_at  end,
    open_count       = d.open_count  + (p_evenement = 'opened')::int,
    clicked_at       = case when p_evenement = 'clicked' then coalesce(d.clicked_at, p_quand) else d.clicked_at end,
    click_count      = d.click_count + (p_evenement = 'clicked')::int,
    last_clicked_url = case when p_evenement = 'clicked' and p_url is not null then left(p_url, 2000) else d.last_clicked_url end
  where p_evenement in ('opened', 'clicked')
    and (d.message_id = p_email_id or d.message_id like p_email_id || '#%')
    and d.entity_type is not null
    and not (d.entity_type = any (coalesce(p_types_exclus, '{}'::text[])))
  returning d.id, d.org_id, d.entity_type, d.entity_id;
$$;

comment on function public.email_deliveries_enregistrer_suivi(text, text, timestamptz, text, text[]) is
  'Webhook Resend (service_role) : première ouverture / premier clic + compteurs, jamais sur les courriels de compte Lume.';

-- Serveur seulement : le webhook écrit, personne d'autre.
revoke all on function public.email_deliveries_enregistrer_suivi(text, text, timestamptz, text, text[]) from public, anon, authenticated;
grant execute on function public.email_deliveries_enregistrer_suivi(text, text, timestamptz, text, text[]) to service_role;
