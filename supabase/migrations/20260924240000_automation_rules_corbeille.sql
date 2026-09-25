-- ═══════════════════════════════════════════════════════════════
-- La corbeille des automatisations
--
-- POURQUOI. Supprimer une automatisation était DÉFINITIF : la ligne
-- disparaissait, avec son texte, ses conditions et son parcours. Un clic
-- de trop et des mois de réglages sont perdus — sans recours, sans copie.
--
-- L'onglet « Corbeille » existe dans l'interface depuis la refonte (#525)
-- et affichait toujours zéro, faute de quoi le remplir.
--
-- CE QU'ON AJOUTE. Une colonne `deleted_at`, comme partout ailleurs dans
-- Lume (« soft deletes via deleted_at — never hard delete », CLAUDE.md).
-- Purement ADDITIF : les 210 règles de production restent intactes, avec
-- `deleted_at` à NULL.
--
-- CE QUE ÇA CHANGE POUR LE MOTEUR. Rien tant que le code ne filtre pas :
-- une colonne ajoutée ne modifie aucune requête existante. Le filtre est
-- posé dans le même lot, du côté serveur, sur la lecture des règles et sur
-- le déclenchement.
--
-- Schéma vérifié avant écriture (SCHEMA_SNAPSHOT.md, 2026-09-23) :
-- `automation_rules` n'a AUCUNE colonne de suppression.
-- ═══════════════════════════════════════════════════════════════

alter table public.automation_rules
  add column if not exists deleted_at timestamptz;

-- La liste principale lit les règles VIVANTES à chaque affichage ; la
-- corbeille est rare. L'index partiel sert donc le cas courant.
create index if not exists automation_rules_vivantes_idx
  on public.automation_rules (org_id)
  where deleted_at is null;

comment on column public.automation_rules.deleted_at is
  'Mise à la corbeille. NULL = vivante. Une règle en corbeille ne se déclenche plus mais reste restaurable.';
