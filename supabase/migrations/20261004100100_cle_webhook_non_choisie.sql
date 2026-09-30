-- ═══════════════════════════════════════════════════════════════
-- Vague 3 (audit V2, S8, Faible) — la clé d'une adresse d'appel
-- (`automation_webhooks.api_key`) ne peut plus être CHOISIE par un client.
--
-- Constat (preuves/C/cle-choisie.mjs) : un membre avec automations.update a
-- inséré un webhook avec `api_key = 000…0` (201) et modifié la clé d'un
-- webhook existant (204) par PostgREST. Un initié pouvait rendre la porte
-- de son bureau devinable. Le bloc 4 avait déjà fermé la LECTURE de la
-- colonne ; l'écriture restait ouverte.
--
-- Un REVOKE de colonne ne retire rien tant qu'un privilège de TABLE existe :
-- on retire INSERT / UPDATE sur la table, puis on les rend colonne par
-- colonne, sans `api_key`. La clé vient désormais toujours de la base
-- (valeur par défaut, 32 octets aléatoires) ou du serveur (régénération,
-- client service_role, après contrôle du droit par la RLS).
--
-- Les policies (automations.update) ne changent pas.
-- Réversible : voir le bloc DOWN en fin de fichier.
-- ═══════════════════════════════════════════════════════════════

begin;

revoke insert, update on table public.automation_webhooks from anon, authenticated;

grant insert (id, org_id, created_by, name, enabled, mode, deleted_at, created_at, updated_at)
  on table public.automation_webhooks to authenticated;

grant update (name, enabled, mode, deleted_at, updated_at)
  on table public.automation_webhooks to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════
-- DOWN :
--
-- begin;
-- revoke insert, update on table public.automation_webhooks from authenticated;
-- grant insert, update on table public.automation_webhooks to authenticated;
-- commit;
-- ═══════════════════════════════════════════════════════════════
