-- ============================================================================
-- consents.org_id redevient facultatif — le registre de consentement était vide
-- ============================================================================
-- CONSTAT (2026-09-01, trouvé par le robot de recette)
-- Aucun consentement aux témoins n'a JAMAIS été enregistré :
--     prod    : 0 ligne dans public.consents
--     staging : 0 ligne (hors essai manuel du jour)
--
-- Chaîne complète de la panne, silencieuse de bout en bout :
--   1. `submitCookieConsent` (src/lib/consentApi.ts:113) envoie 4 appels, un par
--      finalité, avec `org_id: orgId ?? null` — `null` est VOULU : la bannière
--      s'affiche aussi pour un visiteur anonyme, qui n'a pas d'organisation.
--   2. Le garde de validation refusait `null` (corrigé séparément dans
--      server/lib/validation-guards.ts) → 400.
--   3. Une fois ce 400 levé, la vraie cause apparaît : la colonne
--      `consents.org_id` porte une contrainte NOT NULL → 500.
--   4. Le client ne remonte rien : `recordConsent` renvoie `{ error }` que
--      `submitCookieConsent` ignore. L'utilisateur voit la bannière se fermer
--      et croit son choix enregistré.
--
-- POURQUOI CETTE CORRECTION EST LA BONNE
-- La migration d'origine `20260625000001_dsr_and_consents.sql:20` déclare :
--     org_id uuid references public.orgs(id) on delete cascade
-- SANS `not null`. Ses policies gèrent explicitement le cas (`org_id is not
-- null and has_org_membership(...)`), donc l'absence d'organisation était
-- prévue dès la conception.
--
-- La contrainte NOT NULL n'apparaît dans AUCUN fichier de migration : elle a
-- été posée directement sur les bases, hors du pipeline (contraire à la
-- règle 2 du CLAUDE.md). On rétablit l'intention d'origine.
--
-- SÉCURITÉ
-- Aucune donnée existante n'est touchée (0 ligne concernée). Lever un NOT NULL
-- n'ouvre aucun accès : les policies de `consents` restent inchangées et
-- continuent de filtrer par organisation quand elle est renseignée.
--
-- Idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'consents'
       and column_name  = 'org_id'
       and is_nullable  = 'NO'
  ) then
    alter table public.consents alter column org_id drop not null;
    raise notice 'consents.org_id : contrainte NOT NULL levée.';
  else
    raise notice 'consents.org_id : déjà facultatif, rien à faire.';
  end if;
end $$;

comment on column public.consents.org_id is
  'Organisation concernée, ou NULL pour un consentement donné hors organisation '
  '(bannière de témoins affichée à un visiteur anonyme). Ne PAS remettre de '
  'contrainte NOT NULL : elle vidait silencieusement le registre de consentement '
  '(voir 20260901140000_consents_org_id_nullable.sql).';

-- Vérification : un consentement sans organisation doit désormais passer.
do $$
declare
  v_id uuid;
  v_user uuid;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'Aucun compte en base : vérification ignorée.';
    return;
  end if;

  -- Arguments nommés : l'ordre positionnel de record_consent place p_ip et
  -- p_user_agent AVANT p_method, ce qui prête à confusion.
  select public.record_consent(
    p_subject_type => 'user',
    p_subject_id   => v_user,
    p_purpose      => 'verification-migration',
    p_granted      => true,
    p_doc_version  => 'migration-check',
    p_doc_url      => null,
    p_ip           => null,
    p_user_agent   => null,
    p_method       => 'migration',
    p_org_id       => null
  ) into v_id;

  if v_id is null then
    raise exception 'record_consent a échoué alors que org_id est facultatif.';
  end if;

  -- On ne laisse pas la trace de l'essai dans le registre.
  delete from public.consents where id = v_id;
  raise notice 'Vérifié : un consentement sans organisation est accepté.';
end $$;
