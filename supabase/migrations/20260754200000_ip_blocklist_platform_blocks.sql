-- ip_blocklist : réautorise les blocages plateforme (org_id null).
--
-- L'index d'unicité idx_ip_blocklist_unique (ip_address, coalesce(org_id,
-- '000…0')) prévoit explicitement des blocages sans org — c'est le cas de
-- l'auto-blocage après violations répétées (server/lib/security.ts), qui
-- n'a aucun contexte d'org. Un durcissement ultérieur a mis org_id NOT NULL
-- et ce chemin échouait en 23502 silencieusement : les blocages d'IP
-- n'étaient JAMAIS persistés (cache mémoire seulement, perdu à chaque
-- redéploiement).
--
-- RLS reste org-scopée : une ligne org_id null n'est visible d'aucun client;
-- seul le service_role (lecture d'enforcement) la voit.

alter table public.ip_blocklist alter column org_id drop not null;
