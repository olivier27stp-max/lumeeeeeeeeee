-- ═══════════════════════════════════════════════════════════════
-- Modèles de courriel personnalisables (plan courriels pro, 2026-09-18)
-- ─────────────────────────────────────────────────────────────
-- Constat : `email_templates` existe depuis 2026-03-26, la RLS est complète,
-- le CRUD serveur est complet… et PERSONNE ne lit `is_default`. Un modèle
-- n'était chargé que si le front passait un `emailTemplateId` explicite à
-- POST /api/emails/send-invoice — ce qu'aucune page ne fait. Les modèles
-- semés en prod étaient donc morts : une entreprise pouvait en écrire dix,
-- ses clients recevaient toujours le texte d'origine.
--
-- Cette migration prépare la résolution AUTOMATIQUE par (org_id, type) :
--   1. le CHECK sur `type` couvre enfin les 35 courriels envoyés par l'app,
--      pas seulement les 10 de 2026-05 ;
--   2. `source` distingue un texte écrit dans l'éditeur d'un HTML importé
--      (celui-ci doit être assaini puis posé DANS notre charpente, jamais en
--      remplacement du courriel — le bouton, le montant, les numéros de taxes
--      et le pied restent posés par nous, sinon un client ne peut plus payer) ;
--   3. un index unique partiel garantit UN SEUL modèle actif par (org_id,
--      type). C'est lui qui rend la résolution déterministe : sans lui,
--      `.maybeSingle()` sur deux lignes échoue, et la fonctionnalité meurt en
--      silence (supabase-js ne lève jamais d'exception).
--
-- ⚠️ La prod porte DÉJÀ des doublons (deux lignes « Invoice Reminder
-- (Default) » pour la même org). Créer l'index sans dédupliquer d'abord
-- ferait échouer la migration. On désactive donc les surnuméraires — on ne
-- supprime rien : le texte que l'entreprise a écrit lui appartient, elle
-- pourra le réactiver depuis la page Modèles.

-- ═══ 1. Les 35 types de courriel ═══════════════════════════════════════════
-- Nommage repris des 10 existants : snake_case, préfixé par l'entité
-- (invoice_*, quote_*, job_*, client_*…). `generic` reste le fourre-tout.
alter table public.email_templates drop constraint if exists email_templates_type_check;
alter table public.email_templates add constraint email_templates_type_check
  check (type in (
    -- Facturation
    'invoice_sent', 'invoice_reminder', 'invoice_paid', 'invoice_overdue',
    'payment_receipt', 'payment_failed', 'payment_request',
    'deposit_request', 'deposit_received',
    -- Soumissions
    'quote_sent', 'quote_reminder', 'quote_accepted', 'quote_declined', 'quote_expiring',
    -- Travaux / rendez-vous
    'job_confirmation', 'job_reminder', 'job_completed', 'job_rescheduled', 'job_cancelled',
    'appointment_reminder', 'appointment_confirmation',
    -- Contrats
    'contract_sent', 'contract_signed', 'contract_reminder',
    -- Prospects
    'lead_ack', 'lead_followup', 'lead_nurture',
    -- Relation client
    'client_welcome', 'client_anniversary', 'seasonal_reminder', 'cross_sell',
    'review_request', 'referral_request',
    -- Divers
    'form_submission', 'generic'
  ));

comment on column public.email_templates.type is
  'Quel courriel ce modèle remplace. La résolution serveur (texteDuCourriel) cherche par (org_id, type, is_active) ; sans modèle, le texte d''origine est conservé.';

-- ═══ 2. Éditeur ou HTML importé ════════════════════════════════════════════
-- Le serveur n'assainit agressivement (script/style/iframe/on*/javascript:)
-- que ce qui vient d'un import. Un texte d'éditeur est déjà sous contrôle.
alter table public.email_templates
  add column if not exists source text not null default 'editeur'
    check (source in ('editeur', 'import'));

comment on column public.email_templates.source is
  'editeur = texte écrit dans l''app ; import = HTML collé/téléversé par l''entreprise, assaini puis posé dans `corpsHtml` du gabarit — jamais en remplacement du courriel entier.';

-- ═══ 3. Déduplication AVANT l'index ════════════════════════════════════════
-- Un seul actif par (org_id, type) : on garde le modèle marqué par défaut
-- s'il y en a un, sinon le plus récemment mis à jour, sinon le plus récent.
-- Les autres passent inactifs (is_default remis à false pour rester cohérent).
with classement as (
  select id,
         row_number() over (
           partition by org_id, type
           order by is_default desc, updated_at desc nulls last, created_at desc, id
         ) as rang
    from public.email_templates
   where is_active
)
update public.email_templates t
   set is_active  = false,
       is_default = false,
       updated_at = now()
  from classement c
 where c.id = t.id
   and c.rang > 1;

-- `is_default` devient redondant avec `is_active` une fois l'unicité posée,
-- mais la colonne reste (le CRUD et l'agent Lumi l'écrivent) : on l'aligne
-- pour que les deux racontent la même histoire.
update public.email_templates
   set is_default = true, updated_at = now()
 where is_active and not is_default;

-- ═══ 4. L'index qui rend la résolution déterministe ════════════════════════
-- Partiel sur is_active : une entreprise peut garder autant de brouillons
-- inactifs qu'elle veut pour un même type, mais un seul sert aux envois.
-- Remplace idx_email_templates_type (même colonnes, mais non unique).
drop index if exists public.idx_email_templates_type;
create unique index if not exists uniq_email_templates_actif_par_type
  on public.email_templates (org_id, type)
  where is_active;

comment on index public.uniq_email_templates_actif_par_type is
  'Un seul modèle actif par (org_id, type) : garantit que texteDuCourriel trouve zéro ou une ligne, jamais deux.';
