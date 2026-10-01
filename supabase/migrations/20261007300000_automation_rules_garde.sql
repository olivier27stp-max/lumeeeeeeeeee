-- Accord de Rafba le 2026-10-01 (« finis tout » — la garde en base lui avait été proposée
-- dans AUTOMATIONS_UI_AUDIT.md, § 6). Staging d'abord, puis prod.
--
-- À APPLIQUER APRÈS le déploiement du code qui publie par le rôle de service
-- (server/lib/automations-publication.ts : `changerPublication`, `activerApresEcritureUtilisateur`).
-- Appliquée avant, la publication depuis l'app serait refusée.
--
-- LE DÉFAUT (audit du 2026-10-01, constats roles-05, roles-06, roles-07, observés sur un bureau de
-- test) : un membre à qui la page Rôles donne « modifier les automatisations » peut appeler la base
-- DIRECTEMENT (PostgREST, sans passer par les routes du serveur). Les policies RLS vérifient son droit
-- sur le bureau, mais aucune des règles que le serveur applique :
--   · roles-05 : `is_active = true` sur une règle incomplète (texto vide) — publiée sans contrôle ;
--   · roles-06 : `is_preset = true`, `preset_key` inventée, déclencheur d'une automatisation fournie changé ;
--   · roles-07 : une automatisation fournie mise à la corbeille puis purgée, et un vrai DELETE d'une
--     règle (l'app ne supprime JAMAIS pour de bon : corbeille, puis `purged_at`).
-- Tout reste dans SON bureau et demande ce droit ; ce n'est pas une fuite entre entreprises.
--
-- LA GARDE : un déclencheur qui refuse, à une SESSION D'UTILISATEUR, ce qu'aucun écran ne fait.
-- Les droits et les policies ne changent pas (retirer des droits par colonne casserait en silence
-- l'enregistrement dès qu'une colonne serait ajoutée).
--
-- « Session d'utilisateur » = `current_user` vaut `authenticated` ou `anon` — le rôle que PostgREST
-- prend pour un jeton d'utilisateur. Le rôle de service (`service_role`), les fonctions SECURITY
-- DEFINER (`seed_automation_presets`, qui sème les automatisations fournies à la création d'un
-- bureau) et les migrations (`postgres`) ne sont pas concernés. On lit `current_user`, PAS
-- `auth.role()` : ce dernier lit le jeton et resterait « authenticated » à l'intérieur d'une
-- fonction SECURITY DEFINER appelée par un utilisateur.
--
-- Ce que l'app fait, vérifié dans le code avant d'écrire ces règles :
--   · elle n'insère par une session que des brouillons à soi (`is_active = false`, `is_preset = false`) ;
--   · elle ne publie que par `changerPublication` / `activerApresEcritureUtilisateur` (rôle de service) ;
--   · elle refuse de supprimer une automatisation fournie et d'en changer le déclencheur ;
--   · elle ne purge qu'une règle déjà à la corbeille, et n'écrit plus jamais sur une règle purgée ;
--   · elle ne fait aucun DELETE sur cette table avec une session d'utilisateur.
--
-- Idempotente. Retour arrière : `drop trigger trg_automation_rules_garde on public.automation_rules;`

create or replace function public.automation_rules_garde()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Rôle de service, fonctions SECURITY DEFINER, migrations : hors de la garde.
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Une automatisation ne se supprime pas directement : elle passe par la corbeille.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.is_preset or new.preset_key is not null then
      raise exception 'Une automatisation fournie ne se crée pas depuis une session.' using errcode = '42501';
    end if;
    if new.is_active then
      raise exception 'Une automatisation naît en brouillon : la publication passe par le serveur.' using errcode = '42501';
    end if;
    if new.deleted_at is not null or new.purged_at is not null then
      raise exception 'Une automatisation ne naît pas à la corbeille.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.purged_at is not null then
    raise exception 'Cette automatisation a été supprimée définitivement : elle ne se modifie plus.' using errcode = '42501';
  end if;
  if new.org_id is distinct from old.org_id
     or new.is_preset is distinct from old.is_preset
     or new.preset_key is distinct from old.preset_key then
    raise exception 'Le bureau et le statut « fournie » d’une automatisation ne se modifient pas.' using errcode = '42501';
  end if;
  if new.is_active and not old.is_active then
    raise exception 'La publication d’une automatisation passe par le serveur, qui la vérifie d’abord.' using errcode = '42501';
  end if;
  if new.purged_at is not null and old.deleted_at is null then
    raise exception 'Seule une automatisation déjà à la corbeille se supprime définitivement.' using errcode = '42501';
  end if;
  if old.is_preset then
    if new.trigger_event is distinct from old.trigger_event then
      raise exception 'Le déclencheur d’une automatisation fournie ne se change pas.' using errcode = '42501';
    end if;
    if (new.deleted_at is not null and old.deleted_at is null) or new.purged_at is not null then
      raise exception 'Une automatisation fournie ne se supprime pas : désactivez-la.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.automation_rules_garde() is
  'Refuse à une session d''utilisateur (current_user authenticated/anon) ce que le serveur n''autorise jamais sur automation_rules : publier, toucher au statut « fournie », purger hors corbeille, DELETE. Audit 2026-10-01 (roles-05/06/07).';

-- Une fonction de déclencheur n'a pas à être appelable : aucun droit d'exécution direct.
revoke all on function public.automation_rules_garde() from public;
revoke all on function public.automation_rules_garde() from anon;
revoke all on function public.automation_rules_garde() from authenticated;

drop trigger if exists trg_automation_rules_garde on public.automation_rules;
create trigger trg_automation_rules_garde
  before insert or update or delete on public.automation_rules
  for each row execute function public.automation_rules_garde();

-- Garde-fou de la migration : le déclencheur est là, et la fonction n'est PAS SECURITY DEFINER
-- (sinon `current_user` vaudrait toujours le propriétaire, et la garde ne garderait rien).
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'automation_rules' and t.tgname = 'trg_automation_rules_garde' and not t.tgisinternal
  ) then
    raise exception 'Le déclencheur trg_automation_rules_garde n''a pas été créé.';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'automation_rules_garde') then
    raise exception 'automation_rules_garde ne doit pas être SECURITY DEFINER.';
  end if;
end $$;
