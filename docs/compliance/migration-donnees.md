# Migration assistée — traitement des renseignements personnels (Loi 25)

Document de référence pour le registre (voir aussi `ropa.md`). Couvre le
module d'import/migration (`server/lib/migration/`, portail
`/migration/invite/:token`, console `/admin/migrations`).

## Nature des renseignements

Les fichiers téléversés par un bureau client contiennent des renseignements
personnels de **tiers** (les clients finaux du bureau) : noms, coordonnées,
adresses, historique commercial. Le bureau est responsable de la collecte ;
Lume agit comme prestataire pour le transfert.

## Responsabilité du transfert

L'approbation de l'import final exige la recopie exacte d'une phrase par
laquelle le bureau **confirme avoir le droit de transférer ces
renseignements** (`APPROVAL_SENTENCE_FR/EN`,
`server/routes/migration-portal.ts`). Chaque approbation est journalisée avec
IP, user-agent et version du rapport (`migration_approvals`).

## Hébergement

- **Fichiers sources** : bucket privé Supabase Storage `migration-files`
  (aucun accès client, URLs signées serveur uniquement). Le projet Supabase
  de production est hébergé dans l'infonuagique de Supabase (AWS) — la région
  exacte est celle du projet (à confirmer dans le tableau de bord Supabase et
  à consigner ici). Si la région est hors Québec/Canada, il s'agit d'une
  communication de renseignements **hors Québec** au sens de la Loi 25, au
  même titre que l'ensemble de la base de données du CRM ; elle est couverte
  par l'évaluation du traitement principal (voir `ropa.md`) : chiffrement au
  repos et en transit assurés par le fournisseur, accès restreint au service
  role.
- **Zone de staging** : tables Postgres du même projet (RLS deny-all,
  accès serveur exclusivement).

## Rétention et purge automatique

- Fichiers sources et zone de staging : purgés **30 jours** après la clôture
  de la migration (`server/lib/migration/cleanup.ts`, cron quotidien sous
  advisory lock). Jetons d'invitation anonymisés à 90 jours.
- Les données **importées** dans le CRM suivent le cycle de vie normal du
  workspace (elles appartiennent au bureau).

## Droit à l'effacement

L'anonymisation d'un client via `/api/dsr/erase/client/:id` purge aussi ses
traces de migration pendant la fenêtre de rétention : ligne de staging
(payload source complet) et `previous_values` du registre d'import
(`server/lib/migration/erasure.ts`). Le fichier CSV source ne peut pas être
édité ligne à ligne : sa purge est garantie par la rétention 30 jours.

## Minimisation et masquage

- Seules les colonnes mappées vers le catalogue de champs Lume sont
  importées ; les colonnes non mappées sont conservées en texte dans les
  notes du dossier (choix du bureau via l'écran de mapping).
- Tous les échantillons montrés au portail et aux assistants sont **masqués**
  (`masks.ts`) — aucune valeur source complète ne sort de la zone serveur.
- L'export des lignes en erreur (payload complet) n'est accessible qu'au
  bureau propriétaire (portail authentifié) et à l'admin plateforme ; chaque
  export est journalisé (`rejects.export`).

## Journalisation

Chaque étape (création, lien, ouverture, téléversement, décisions, imports,
rollback, purges, effacements) est consignée dans `migration_audit_logs`
(append-only applicatif) et les événements majeurs dans `audit_events` du
workspace.
