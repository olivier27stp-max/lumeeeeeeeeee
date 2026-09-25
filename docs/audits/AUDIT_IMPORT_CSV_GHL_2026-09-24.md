# Audit de l'import de données Lume vs spec « import CSV niveau GoHighLevel »

Date : 2026-09-24 · Base : origin/main a76cff55 · Branche de travail : feat/import-csv-ghl (worktree ~/lume-worktrees/import-csv)

## 0. Ce qui existe aujourd'hui (deux imports, pas un)

### A. Migration assistée (`server/lib/migration/`, ~16 000 lignes, 332 tests vitest + banc E2E `scripts/migration-bench/`)

Moteur complet, mais piloté par l'équipe Lume, pas par le client :

- Console dans Creator Space › Migrations (`src/pages/AdminMigrations.tsx`, 9 onglets), gardée par `requirePlatformAdmin` (PLATFORM_OWNER_ID / PLATFORM_ADMIN_IDS). Un admin de compagnie ne peut pas créer une migration ni lancer un import.
- Portail client à jeton `/migration/invite/:token` (`src/pages/MigrationPortal.tsx`) : rail passif de 6 étapes dérivé du statut, téléversement, correction de correspondances, réponses aux questions, approbation par phrase exacte. Le portail ne peut jamais déclencher l'import.
- Machine à états de 21 statuts (`state-machine.ts`), seule autorité.
- Fichiers : CSV + XLSX/XLS (première feuille convertie en CSV) + PDF archive, 25 Mo, 30 fichiers, 50 000 lignes par fichier. Détection encodage UTF-8 / UTF-16 LE-BE / Windows-1252, séparateur `, ; tab |`, en-têtes dupliqués, sans en-tête, tokens nuls (N/A, -, #REF!), notation scientifique Excel, dates série Excel.
- Correspondance : `normalizeHeader` (minuscule, NFD sans accents), `FIELD_CATALOG` FR/EN pour 11 entités (tax_config, client, property, billing_property, service, quote, job, visit, invoice, line_item, payment), confiance 100 exact / 95 synonyme / 60 par type / <70 = revue. Sélecteur `FieldTargetPicker` (2 colonnes, recherche, exclusion) côté console ; `<select>` côté portail. Gabarits de correspondance par `source_crm` (globaux, créés par l'admin plateforme).
- Normalisation (`normalize.ts`) : courriel minuscule + regex, téléphone 10 chiffres (clé), code postal `A1A 1A1`, provinces (QC/Québec/Quebec → QC + déduction par code postal), montants FR/EN/parenthèses/$, dates avec convention inférée PAR COLONNE (JJ/MM vs MM/JJ, ambigu = issue), pourcentages, booléens souples, adresse sur une ligne découpée, conversion locale→UTC des visites.
- Doublons : intra-fichier (courriel/téléphone/numéro, primaire déterministe) et vs Lume (courriel → téléphone → nom, scorés, tranchés par humain ou par le bot). Fusion enrichissante : jamais d'écrasement, `previous_values` conservé pour le rollback.
- Dry-run sans écriture, rapport par entité (à créer / à fusionner / ignorés / erreurs), `rejects.csv` (ligne Excel + raison), aperçu de lignes masquées.
- Approbation : phrase exacte FR/EN incluant « droit de transférer », IP, user-agent, version du rapport (`migration_approvals`).
- Import final : idempotent (uuid v5 déterministes + `migration_import_records`), lots de 200 avec reprise ligne à ligne, heartbeat + watchdog `recovery.ts`, validation post-import, reprise des erreurs, gel des communications (aucun courriel/SMS/automatisation vers les clients du bureau tant que l'admin n'a pas « activé le compte »).
- Rollback : tous les lots finaux (soft-delete, restauration `previous_values`, purge des pins auto), sans limite de temps.
- Journal `migration_audit_logs` + onglet Audit ; bot IA (Fable) qui relit les correspondances et produit un rapport.

### B. Import rapide de prospects dans le Pipeline (`src/components/pipeline/ImportCsvModal.tsx`, `src/lib/pipeline/importCsv.ts`)

Parsing côté navigateur, reconnaissance fixe de 5 colonnes (prénom, nom, courriel, téléphone, adresse), écriture via `ingest_lead`. Pas de correspondance éditable, pas d'historique, pas de rollback. Il fait exactement ce pour quoi il a été conçu (40 lignes tapées à la main) et ne doit pas être étendu.

### Constat central

La spec décrit un **import libre-service pour l'admin de compagnie**. Le moteur A couvre déjà 60 à 70 % des règles (parsing, correspondance, normalisation, doublons, dry-run, idempotence, rollback, audit), mais **aucun client ne peut l'utiliser seul** : il faut un admin plateforme pour créer la migration, inviter, tester, approuver et lancer. Le travail principal n'est pas de réécrire un moteur, c'est de lui donner une porte d'entrée libre-service à 4 étapes et de combler les manques listés ci-dessous.

## 1. Tableau de conformité

Légende : ✅ fait · 🟠 partiel · ❌ manquant

### 1.1 Page d'accueil « Importer des données »

| Élément | État | Détail |
|---|---|---|
| Deux cartes CSV / autre CRM (« Bientôt ») | ❌ | Rien côté tenant. Le portail n'a pas de page d'accueil, il est ouvert par jeton. |
| Historique des imports (colonnes de la spec) | 🟠 | Les données existent (`data_migrations`, `migration_import_batches.started_by/started_at/finished_at/totals`) mais l'unique liste est la console plateforme. Aucune vue tenant, aucun filtre, aucune pagination. |
| Actions : détail, CSV d'erreurs, annuler | 🟠 | Existent en console plateforme (ImportsTab, rejects.csv, rollback), pas côté tenant. |
| État vide | ❌ | |

### 1.2 Assistant en 4 étapes

| Élément | État | Détail |
|---|---|---|
| Stepper horizontal 4 étapes, boutons Retour/Annuler/Suivant, infobulle sur « Suivant » désactivé | ❌ | Le portail a un rail de 6 étapes en lecture seule dérivé du statut ; la console a 9 onglets. Aucun parcours linéaire. |
| **Étape 1** cartes d'objets à cocher | 🟠 | `ImportDataForm` (portail) propose des catégories (clients, propriétés, adresses de facturation, services, soumissions, jobs, jobs récurrents, visites, factures, paiements, taxes). Pas de dépendances grisées avec infobulle. |
| Objets « Opportunités » (pipeline de ventes) et « Compagnies » | ❌ | `pipeline_deals` / `pipeline_stages` / `deals` n'existent pas dans `FIELD_CATALOG`. Lume n'a pas d'entité compagnie (`clients.company` est un texte). Les soumissions (`quote`) sont importables. |
| Une ligne CSV → plusieurs objets liés | ❌ | Un fichier vise UNE entité (target_entity ignoré par ligne) ; le rattachement passe par `client_ref / client_email_ref / client_name_ref / client_phone_ref`. Pas de « contact + opportunité » depuis la même ligne. |
| **Étape 2** glisser-déposer CSV/XLSX | ✅ | XLSX/XLS déjà acceptés (sniff ZIP/OLE). Plafond 25 Mo (spec : 30). |
| Refus multi-feuilles | ❌ | La première feuille est prise silencieusement. |
| Fichier modèle par objets choisis (FR+EN) | ❌ | Le catalogue permet de le générer. |
| Détection encodage + séparateur | ✅ | |
| Mode d'import par objet (créer / créer+MAJ / MAJ seulement) | ❌ | La fusion est décidée doublon par doublon (humain ou bot), jamais par un mode global. |
| Sélecteur de format de date + détection + avertissement ambigu | 🟠 | Inférence par colonne + issue `date_format` quand ambigu. Pas de sélecteur global explicite dans l'UI. |
| Pays par défaut des téléphones | ❌ | Clé sur 10 chiffres ; le numéro est stocké tel qu'écrit, pas en E.164. |
| **Étape 3** encadré « Champs requis » par objet avec coche/⚠ | 🟠 | Vérifié au dry-run (`client sans nom, entreprise, courriel ni téléphone` = invalide), pas affiché ni bloquant dans l'UI de correspondance. |
| Tableau colonne / exemples / statut / objet / champ / vides | 🟠 | Console : `FieldTargetPicker` + exemples masqués + badge de confiance + `emptyRatio` calculé. Portail : `<select>` simple. Pas de statut « Erreur ». |
| Correspondance automatique FR/EN sans accents | ✅ | Très riche (Jobber, HCP, ServiceTitan, QuickBooks…). Manquent les synonymes GHL (« Lead Value », « Contact Type », « DND », « Followers »…). |
| Menu Objet limité aux objets cochés, champ filtré + recherche, champs déjà utilisés grisés | 🟠 | Recherche oui ; filtrage par objets cochés et grisage des champs déjà pris : non. |
| Champs Contact de GHL | 🟠 | Présents : prénom, nom, nom complet, courriel, téléphone, tél. secondaire, entreprise, adresse, ville, province, CP, pays, notes, source, statut, prospect, archivé, ID externe, date de création. Absents : date de naissance, responsable (owner), type de contact, NPD/DND, **tags**, site web, fuseau horaire, courriels/téléphones additionnels, champs personnalisés. |
| Champs Opportunité | ❌ | Rien (voir 1.2 Opportunités). |
| « Ignorer les valeurs vides » par ligne | 🟠 | Comportement implicite et global (la fusion ne comble que les vides, jamais d'écrasement). Pas de case par colonne. |
| « + Créer un champ personnalisé » dans le menu | ❌ | `custom_fields` v2 existe (object_type, field_type, options) mais l'import ne l'alimente pas. |
| Association des valeurs d'énumération (statut, étape, pipeline, responsable) | 🟠 | Statuts inconnus → issue `unknown_status` (à résoudre en texte). Responsables → `migration_staff_mappings` (par nom, console seulement). Pas de mini-tableau valeur → cible avec création. |
| Case « Ne pas importer les N colonnes non associées » + blocage de Suivant | 🟠 | Comportement différent : colonnes non associées → bloc `_unmapped` collé dans les notes (max 12). Pas de blocage explicite. |
| Mémoriser la correspondance par compagnie | 🟠 | `migration_mapping_templates` par `source_crm`, globaux, admin plateforme. Pas « mêmes en-têtes → réutiliser » par org. |
| **Étape 4** résumé X lignes / Y à créer / Z à MAJ / erreurs | ✅ | `DryRunReport.byEntity` + totaux. |
| Validation avant import avec lignes en erreur et raison | 🟠 | `rejects.csv` + aperçu masqué. Pas de tableau interactif, pas de correction de cellule ni d'exclusion de ligne. |
| Tag sur tous les contacts importés | ❌ | Table `client_tags` existe, l'import ne l'utilise pas. |
| Liste intelligente | ❌ | Lume n'a pas de « smart list » clients (les `pipeline_vues` sont des vues de deals). |
| Ajouter à un workflow + avertissement SMS/courriel | ❌ | Le moteur d'automatisations existe (`automationEngine.ts`), mais l'import fait l'inverse aujourd'hui : gel total des communications. |
| Consentement LCAP + Loi 25, journalisé | 🟠 | Phrase d'approbation « droit de transférer » + IP + UA + version. Pas de formulation LCAP explicite, pas de case obligatoire dans un parcours tenant, pas d'option « NPD par défaut » (pas de colonne NPD sur `clients`, seulement `sms_consent_at` et désabonnement courriel). |
| Confirmation + arrière-plan + progression + notification de fin | 🟠 | Import asynchrone en process avec heartbeat, watchdog et progression dans la console. Pas de notification au tenant à la fin. |

### 1.3 Règles de validation et de normalisation

| Donnée | État | Détail |
|---|---|---|
| Téléphone E.164 (+1 défaut), erreur lettres / trop court | 🟠 | 10 chiffres extraits ; notation scientifique = erreur. Pas de E.164, pas d'erreur si trop court (≥ 7 accepté), lettres ignorées silencieusement. |
| Courriel valide, minuscule, sans espaces | ✅ | Message générique `invalid_email`, pas « domaine incomplet ». |
| Code postal CA `A1A 1A1` | ✅ | |
| Province → code | ✅ | |
| Dates selon format + dates impossibles | ✅ | Par colonne, pas par choix global. |
| Montants FR / EN | ✅ | |
| Tags `,` et `;`, refus de `/` | ❌ | Aucun champ tags. |
| Responsable par courriel plutôt que par nom | 🟠 | Par nom, tranché en console. |
| Doublons dans le fichier : fusionner / garder la dernière | 🟠 | Fusion automatique déterministe (courriel/tél/numéro). Pas de choix utilisateur. |
| Doublons dans Lume : ID → courriel → téléphone, configurable | 🟠 | Ordre courriel → téléphone → nom (+ ID externe pour le rattachement). Non configurable. |
| Codes d'erreur + message FR « quoi corriger » | 🟠 | Codes ligne : `invalid_email/phone/id/date/datetime/money/number/boolean:<champ>`, statuts `orphan/duplicate/error`. Issues : 13 types avec textes FR. Manquent : multi-feuilles, énumération inconnue générique, responsable introuvable, énumération ambiguë, doublon d'ID, messages FR par code ligne. |

### 1.4 Après l'import

| Élément | État |
|---|---|
| Écran de détail créés / MAJ / ignorés / erreurs + CSV d'erreurs | ✅ console, ❌ tenant |
| Rollback | ✅ (tous les lots, `previous_values`), sans fenêtre de 7 jours, console seulement |
| Cloisonnement par compagnie | ✅ (org_id partout, RLS deny-all + service role) |
| Seul l'admin de compagnie peut importer | ❌ (seuls les admins plateforme) |
| Journalisation dans Creator Space › Logs | 🟠 (`migration_audit_logs` + onglet Audit par migration ; l'onglet Logs global ne les agrège pas) |

### 1.5 Contraintes techniques

| Élément | État |
|---|---|
| Parsing serveur en flux | ✅ (Papa en Readable 512 Ko + setImmediate), 25 Mo |
| Aperçu limité | ✅ (échantillons masqués + preview-rows) |
| Lots idempotents, une ligne en échec n'échoue pas le lot | ✅ (lots de 200, reprise ligne à ligne, uuid v5) |
| Aucun SMS/courriel déclenché par l'import | ✅ et au-delà (gel des communications) |
| Jeu de CSV de test par code d'erreur / encodage / séparateur / dates | 🟠 (tests unitaires + banc E2E avec 10 pièges ; pas de jeu organisé par code d'erreur) |

## 2. Décision d'architecture proposée

**Réutiliser le moteur A, pas le forker.** Un import libre-service devient une `data_migrations` avec `source_crm = 'csv_self_serve'` (nouvelle valeur), créée par un owner/admin de l'org, sans invitation ni jeton, et pilotée par de nouvelles routes `/api/imports/*` gardées par le rôle org (owner/admin) qui appellent les mêmes fonctions de `pipeline.ts`, `importer.ts`, `duplicates.ts`. La machine à états reste la même ; l'approbation devient la case de consentement de l'étape 4. La console Creator Space continue de voir ces imports (supervision, audit), la migration assistée reste intacte pour Jobber et compagnie.

Ce choix évite un second moteur, conserve 332 tests et le banc E2E, et donne au tenant tout ce qui est déjà éprouvé (idempotence, rollback, gel des communications).

## 3. Plan priorisé

### P1 — Correspondance, validation, historique (le parcours libre-service de bout en bout)

1. **Fondations serveur** : `source_crm='csv_self_serve'`, routes `/api/imports` (créer, téléverser, analyser, lister/corriger les correspondances, dry-run, confirmer, lancer, historique, détail, rejects.csv), garde owner/admin org, réutilisation directe du pipeline. Aucune migration SQL sauf la valeur de `source_crm` si contrainte.
2. **Page Réglages › Importer des données** : deux cartes (CSV actif, autre CRM « Bientôt »), historique paginé 20 lignes avec filtres date/source/statut, état vide.
3. **Assistant 4 étapes** : stepper, barre fixe Retour/Annuler/Suivant, infobulles d'explication.
   - Étape 1 : cartes d'objets (clients, propriétés, adresses de facturation, soumissions, jobs, visites, factures, paiements, services), dépendances grisées avec infobulle.
   - Étape 2 : dropzone CSV/XLSX 30 Mo (relever le plafond), refus multi-feuilles avec code d'erreur, fichier modèle FR/EN généré depuis `FIELD_CATALOG`, sélecteur de format de date (prérempli par l'inférence, avertissement si ambigu), pays des téléphones (+1).
   - Étape 3 : tableau colonne / exemples / statut / objet / champ / % vides sur `FieldTargetPicker`, menu Objet limité aux objets cochés, champs déjà pris grisés, encadré « Champs requis » calculé en direct, case « Ne pas importer les N colonnes non associées » qui bloque Suivant tant qu'elle n'est pas cochée, lignes ignorées grisées.
   - Étape 4 : résumé du dry-run, tableau des lignes en erreur avec code + message FR + exclusion de ligne, confirmation, exécution en arrière-plan avec progression, notification de fin.
4. **Validation** : E.164 avec pays par défaut + erreurs `phone_letters` / `phone_too_short`, message « domaine incomplet », dictionnaire FR des codes ligne (`invalid_*`) avec « quoi corriger », nouveaux codes `multi_sheet`, `owner_not_found`, `enum_unknown`, `enum_ambiguous`, `duplicate_id`, `duplicate_in_file`. Synonymes GHL ajoutés au catalogue.
5. **Champs client manquants sans nouvelle table** : tags (`client_tags`, séparateurs `,` `;`, refus `/`), responsable par courriel puis par nom, courriels/téléphones additionnels (`phones` jsonb existant).
6. **Tests** : dossier `tests/fixtures/import-csv/` avec un CSV par code d'erreur, encodages (UTF-8 BOM, Windows-1252, UTF-16), séparateurs `, ;` tab, dates ambiguës ; tests de routes (garde org, isolation tenant).

### P2 — Énumérations, champs personnalisés à la volée, consentement

1. **Association de valeurs d'énumération** : mini-tableau valeur du fichier → valeur Lume pour statut client, statut soumission/job/facture, responsable, avec « créer » quand la cible le permet (étapes de pipeline si l'objet Opportunité est retenu).
2. **Champ personnalisé à la volée** : option « + Créer un champ personnalisé » dans le sélecteur, type déduit des valeurs (texte / nombre / date / liste), écriture dans `custom_fields` + `custom_field_values` (v2), rollback inclus.
3. **Consentement** : case obligatoire LCAP + Loi 25 à l'étape 4, journalisée (qui, quand, quel import, IP, UA) dans `migration_approvals` + `migration_audit_logs`, agrégée dans Creator Space › Logs ; option « Marquer tous les contacts NPD par défaut » (à décider : colonne `dnd` sur clients ou réutilisation du désabonnement courriel + `sms_consent_at`). Tag automatique `import-AAAA-MM-JJ`. Option « ajouter à une automatisation » avec avertissement, en cohérence avec le gel des communications (le gel reste le défaut, l'automatisation choisie est l'exception explicite).
4. **Modes d'import par objet** : créer seulement / créer et mettre à jour / mettre à jour seulement, appliqués aux décisions de doublons ; ordre de rapprochement configurable par compagnie (ID → courriel → téléphone).
5. **Objet Opportunité** (si retenu) : entité `deal` dans `FIELD_CATALOG` (nom, pipeline, étape, statut, valeur, date de fermeture, probabilité, responsable, source, raison de perte), import dans `pipeline_deals` + `pipeline_stages`, une ligne = contact + opportunité.

### P3 — Annulation, correspondance mémorisée, XLSX

1. **Annulation côté tenant** : bouton « Annuler l'import » dans l'historique, limité à 7 jours après la fin (le rollback complet existe déjà ; on ajoute la fenêtre et la porte tenant).
2. **Correspondance mémorisée par compagnie** : empreinte des en-têtes par org → proposition « Réutiliser la correspondance précédente » (extension de `migration_mapping_templates` avec `org_id`, ou nouvelle table légère).
3. **XLSX** : déjà pris en charge ; reste le refus explicite multi-feuilles (fait en P1) et un test de non-régression sur `.xls`.
4. **Doublons dans le fichier** : choix « fusionner » ou « garder la dernière » au lieu de la fusion automatique seule.

## 4. Questions ouvertes pour Olivier (aucune ne bloque P1)

1. **« Opportunités »** : soumissions (`quotes`, déjà importables) ou deals du pipeline de ventes (`pipeline_deals`, aucun champ aujourd'hui) ? Proposition : P1 = soumissions, P2 = deals.
2. **« Compagnies »** : Lume n'a pas d'entité compagnie. Proposition : ne pas l'offrir, `Entreprise` reste un champ du client.
3. **« Liste intelligente »** : pas de concept équivalent côté clients. Proposition : remplacer par le tag automatique + filtre par tag dans Clients.
4. **Emplacement** : Réglages › Importer des données (proposition), ou une entrée dédiée dans la barre latérale ?
5. **NPD par défaut** : nouvelle colonne `clients.dnd` (SMS + courriel) ou réutiliser `sms_consent_at` + désabonnement courriel ?
6. **Accès** : réservé aux owner/admin de l'org (spec), gated par forfait via `org_features` ou ouvert à tous les forfaits ?
