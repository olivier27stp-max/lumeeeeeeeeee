-- ═══════════════════════════════════════════════════════════════
-- Un numéro de soumission ne peut exister qu'une fois par organisation.
--
-- CONSTAT DU 2026-09-04 (prod, lecture seule)
-- Trois des quatre entités numérotées ont un index unique partiel qui
-- rend le doublon impossible, quoi que fasse le code :
--
--     jobs      (org_id, job_number)     where deleted_at is null
--     invoices  (org_id, invoice_number) where deleted_at is null
--     clients   (org_id, client_number)  where deleted_at is null
--
-- `quotes` est la seule à ne pas l'avoir. Or `rpc_create_quote`, quand
-- l'utilisateur CHOISIT son numéro, vérifie « déjà utilisé » (l. 36-43)
-- AVANT de prendre le verrou consultatif (l. 53) — le verrou ne couvre
-- que la numérotation automatique. Deux créations simultanées avec le
-- même numéro choisi passent toutes deux la vérification.
--
-- Improbable au quotidien ; mais un doublon de numéro sur un document
-- envoyé au client, ça ne se rattrape pas. L'index est la garantie que
-- le code n'offre pas.
--
-- Aucun doublon en prod aujourd'hui : l'index se crée sans conflit.
-- Même forme que les trois autres, pour que `db:diff` et les lecteurs
-- retrouvent la règle d'un coup d'œil.
-- ═══════════════════════════════════════════════════════════════

begin;

create unique index if not exists quotes_org_quote_number_unique
  on public.quotes (org_id, quote_number)
  where quote_number is not null and deleted_at is null;

commit;
