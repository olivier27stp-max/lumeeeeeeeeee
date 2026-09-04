-- ═══════════════════════════════════════════════════════════════
-- Des bornes de longueur sur les champs saisis par l'utilisateur.
--
-- CONSTAT DU 2026-09-04 (prod, session réelle d'un membre)
-- Sur 113 colonnes texte des tables cœur, AUCUNE n'avait de borne : ni
-- varchar(n), ni CHECK. Un prénom de 10 Mo a été accepté sans broncher.
-- Après quoi, charger la liste des clients transférait 10 Mo à CHAQUE
-- membre de l'organisation, à chaque ouverture — 1,4 s au lieu de 40 ms.
--
-- L'application écrit directement dans Supabase depuis le navigateur :
-- la validation Zod du serveur Express n'est pas sur ce chemin. La base
-- est donc le seul endroit où une borne tient dans tous les cas — collage
-- accidentel, import CSV mal formé, ou membre malveillant.
--
-- LES BORNES
-- Larges, pour ne jamais gêner une saisie légitime. Mesuré en prod avant
-- de choisir : le plus long prénom fait 39 caractères, la plus longue
-- adresse 86, la plus longue note 319.
--
--     nom, ville, province, pays ........  200
--     téléphone ..........................   50
--     code postal ........................   20
--     courriel ...........................  320   (maximum de la RFC 5321)
--     adresse, rue .......................  500
--     titre, sujet, nom de ligne .........  500
--     note, description, texte libre .... 20000
--
-- NULL passe toujours un CHECK : une colonne vide reste vide.
-- Réexécutable : chaque contrainte est retirée avant d'être posée.
-- ═══════════════════════════════════════════════════════════════

begin;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- clients
      ('clients', 'first_name',            200),
      ('clients', 'last_name',             200),
      ('clients', 'company',               200),
      ('clients', 'email',                 320),
      ('clients', 'phone',                  50),
      ('clients', 'address',               500),
      ('clients', 'billing_address',       500),
      ('clients', 'street_number',          50),
      ('clients', 'street_name',           200),
      ('clients', 'city',                  200),
      ('clients', 'province',              200),
      ('clients', 'postal_code',            20),
      ('clients', 'country',               200),
      ('clients', 'title',                 500),
      ('clients', 'description',         20000),
      ('clients', 'notes',               20000),
      -- jobs
      ('jobs', 'title',                    500),
      ('jobs', 'client_name',              500),
      ('jobs', 'property_address',         500),
      ('jobs', 'address',                  500),
      ('jobs', 'description',            20000),
      ('jobs', 'notes',                  20000),
      -- invoices
      ('invoices', 'subject',              500),
      ('invoices', 'client_name_snapshot', 500),
      ('invoices', 'client_email_snapshot', 320),
      ('invoices', 'notes',              20000),
      ('invoices', 'internal_notes',     20000),
      -- quotes
      ('quotes', 'title',                  500),
      ('quotes', 'notes',                20000),
      ('quotes', 'internal_notes',       20000),
      ('quotes', 'contract_disclaimer',  20000),
      -- lignes
      ('job_line_items', 'name',           500),
      ('job_line_items', 'description',  20000),
      ('quote_line_items', 'name',         500),
      ('quote_line_items', 'description', 20000),
      ('invoice_items', 'title',           500),
      ('invoice_items', 'description',   20000),
      -- tâches et notes
      ('tasks', 'title',                   500),
      ('tasks', 'description',           20000),
      ('notes', 'content',               20000),
      -- propriétés
      ('properties', 'name',               500),
      ('properties', 'address',            500),
      ('properties', 'street_number',       50),
      ('properties', 'street_name',        200),
      ('properties', 'city',               200),
      ('properties', 'province',           200),
      ('properties', 'postal_code',         20),
      ('properties', 'country',            200),
      -- équipe
      ('team_members', 'first_name',       200),
      ('team_members', 'last_name',        200),
      ('team_members', 'email',            320),
      ('team_members', 'phone',             50),
      ('team_members', 'street1',          500),
      ('team_members', 'street2',          500),
      ('team_members', 'city',             200),
      ('team_members', 'province',         200),
      ('team_members', 'postal_code',       20),
      ('team_members', 'country',          200),
      -- profils
      ('profiles', 'full_name',            200),
      ('profiles', 'company_name',         200),
      -- réglages d'entreprise
      ('company_settings', 'company_name', 200),
      ('company_settings', 'email',        320),
      ('company_settings', 'phone',         50),
      ('company_settings', 'website',      500),
      ('company_settings', 'street1',      500),
      ('company_settings', 'street2',      500),
      ('company_settings', 'city',         200),
      ('company_settings', 'province',     200),
      ('company_settings', 'postal_code',   20),
      ('company_settings', 'country',      200),
      ('company_settings', 'quote_footer_text', 20000),
      ('company_settings', 'job_footer_text',   20000)
    ) as v(tbl, col, max_len)
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      r.tbl, format('%s_%s_len', r.tbl, r.col)
    );
    execute format(
      'alter table public.%I add constraint %I check (length(%I) <= %s)',
      r.tbl, format('%s_%s_len', r.tbl, r.col), r.col, r.max_len
    );
  end loop;
end $$;

commit;
