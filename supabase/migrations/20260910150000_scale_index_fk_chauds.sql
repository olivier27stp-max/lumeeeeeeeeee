-- ═══════════════════════════════════════════════════════════════
-- SCALE S2 — Index sur colonnes de clé étrangère chaudes sans index
-- ───────────────────────────────────────────────────────────────
-- Sur les 14 candidats de l'audit, 11 étaient déjà indexés ou portent sur des
-- colonnes/tables non déployées en prod (vérifié). Restent 3 FK chaudes sans
-- index : chaque jointure/DELETE sur la table parente faisait un seq-scan.
-- IF NOT EXISTS : idempotent. CREATE INDEX (non CONCURRENTLY) car la Management
-- API exécute en transaction ; ces tables sont de taille modérée, le verrou est
-- bref.
-- ═══════════════════════════════════════════════════════════════

create index if not exists idx_invoices_client_id        on public.invoices(client_id);
create index if not exists idx_client_tags_client_id      on public.client_tags(client_id);
create index if not exists idx_tax_group_items_group_id   on public.tax_group_items(tax_group_id);
