-- Active la libération automatique des numéros SMS, sur staging ET prod
--
-- CE QUI ÉTAIT EN PLACE
-- La migration 20260750000000 crée la tâche `lume_release_sms_numbers` puis la
-- désactive volontairement, en attendant que le secret `cron_secret` soit
-- déposé dans Vault. Ce dépôt n'a jamais eu lieu.
--
-- Résultat mesuré avant d'écrire ceci :
--   · prod    — tâche inactive, Vault vide : la libération n'a jamais tourné ;
--   · staging — tâche ACTIVE (activée à la main, hors pipeline) mais Vault vide
--     aussi : elle se déclenchait chaque nuit à 8h10, ne trouvait pas le secret,
--     levait une exception et ne faisait rien. Un échec silencieux quotidien.
--
-- CE QUE FAIT LA TÂCHE, ET POURQUOI C'EST SÉRIEUX
-- Elle appelle /api/cron/release-sms-numbers, qui rend définitivement à Twilio
-- les numéros dont la période de grâce de 30 jours est écoulée. La libération
-- est IRRÉVERSIBLE : Twilio peut réattribuer le numéro en quelques minutes, et
-- toutes les conversations de l'organisation sur ce numéro cassent.
--
-- Le balayage ne touche QUE les canaux `inactive` portant une date de
-- libération dépassée, et revérifie juste avant que l'organisation ne paie pas
-- de nouveau. État constaté au moment d'écrire :
--   · prod    — 1 canal actif, 0 en attente de libération ;
--   · staging — aucun canal.
-- Aucun numéro n'est donc libérable aujourd'hui : la tâche s'active à froid.
--
-- LE SECRET
-- `CRON_SECRET` est déjà configuré côté serveur (vérifié : la route répond 401
-- à une mauvaise valeur, et non 503 « non configuré »). Il manque uniquement la
-- même valeur dans Vault, d'où la fonction la lit à chaque exécution.
--
-- Le secret n'est PAS écrit ici : ce fichier est versionné. Il est déposé
-- séparément, hors dépôt (voir docs/ ou la commande fournie à l'application).
--
-- Cette migration est donc volontairement conservatrice : elle n'active la
-- tâche QUE si le secret est réellement présent. Sans lui, elle laisse la tâche
-- inactive et le dit — mieux vaut une tâche franchement arrêtée qu'une tâche
-- qui paraît active et échoue toutes les nuits.

do $$
declare
  v_secret_present boolean;
  v_jobid bigint;
begin
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret')
    into v_secret_present;

  select jobid into v_jobid from cron.job where jobname = 'lume_release_sms_numbers';

  if v_jobid is null then
    raise notice '[sms-release] tâche absente — appliquer d''abord 20260750000000';
    return;
  end if;

  if not v_secret_present then
    -- On force l'état inactif plutôt que de le laisser tel quel : staging était
    -- active sans secret, c'est-à-dire en échec silencieux chaque nuit.
    perform cron.alter_job(v_jobid, active := false);
    raise notice '[sms-release] secret Vault "cron_secret" absent — tâche laissée INACTIVE';
    return;
  end if;

  perform cron.alter_job(v_jobid, active := true);
  raise notice '[sms-release] secret présent — tâche ACTIVÉE';
end $$;
