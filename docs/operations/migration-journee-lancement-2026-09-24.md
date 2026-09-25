# Journée de lancement de la migration accompagnée — suivi de la feuille de route

Feuille de route reçue le 2026-09-24. Chaque point est classé : **code** (fait dans cette branche), **vérifié** (par lecture du code), **Olivier** (action en production que seul un humain connecté peut faire).

## 8h00 – 9h00 · Vision Lavage propre

| # | Point | Qui | État |
|---|---|---|---|
| 1 | Rollback, Reprendre après rollback, Confier au bot | Olivier | Console › Résumé. Le rollback annule désormais TOUS les lots finaux (fix ee89456). |
| 2 | Lire Rejets, noter les numéros de job absents | Olivier, aidé par le **code** | `rejects.csv` porte maintenant la référence manquante dans la colonne `erreur` : `job introuvable : « #4512 » (numéro absent du fichier Jobs ou ambigu)`. Filtrer la colonne sur « job introuvable » donne la liste des numéros à ajouter dans `one offs.csv`. |
| 3 | Approbation, import final, vérification dans le CRM | Olivier | Attendus : Clients 853, Jobs ≈ 859, Calendrier avec visites aux bonnes dates, Factures 651 (aucune fusionnée avec un job), Devis 67. |
| 4 | Envoyer les chiffres avant d'activer | Olivier | Ne pas cliquer « Activer le compte » avant. |

## 9h00 – 10h30 · Répétition sur un bureau jetable

| # | Point | Qui | État |
|---|---|---|---|
| 5 | Nouveau workspace + migration, parcours par le portail, un fichier en .xlsx, un fichier dans la mauvaise catégorie | Olivier | **Vérifié** : le portail accepte `.xlsx/.xls` (signature ZIP/OLE contrôlée, première feuille), la catégorie déclarée fait foi et le désaccord crée l'issue `category_mismatch` visible dans « Questions de l'équipe Lume » avec les options garder / utiliser la détection. |
| 6 | Compteurs détectés, avertissement, Continuer, correspondances, bot, approbation, import, calendrier | Olivier | **Code** : les compteurs de la fiche (portail et console) sont maintenant exacts au-delà de 1 000 lignes (avant : plafond PostgREST silencieux). |
| 7 | Gel : devis par courriel et SMS refusés avant activation, acceptés après | Olivier | **Vérifié** : la garde est dans `sendEmail` (mailer) et `sendSmsIfConfigured`, donc sur tous les envois vers un client du bureau gelé. Message attendu, mot pour mot : « Communications gelées : les données viennent d'être importées et le compte n'est pas encore activé. Cliquez « Activer le compte » dans la console des migrations. » L'envoi de SMS de devis dans `routes/quotes.ts` passe par Twilio directement : à tester explicitement (point à surveiller, voir « Réserves »). |
| 8 | Remonter ce qui accroche | Olivier | |

## 10h30 – 12h00 · Ce que verront les utilisateurs

| # | Point | Qui | État |
|---|---|---|---|
| 9 | Page d'aide « Exporter depuis Jobber » | **Code** | `server/lib/migration/instructions.ts` : cinq rapports numérotés (Client Contact Info, Quotes, One-Off Jobs + Recurring Jobs, Visits, Invoices), période « All time », statut « All », piège des 30 jours nommé (« 29 lignes au lieu de plusieurs centaines »). Affichée dans le portail, section « Exporter depuis Jobber ». |
| 10 | Message de lancement | **Code** + décision | « Import accompagné ». En-tête du portail : « Migration accompagnée de vos données ». Le site marketing disait déjà « On importe tes clients … pendant l'intégration ». |
| 11 | Mode d'emploi en six lignes | **Code** | `docs/operations/migration-mode-d-emploi.md` + carte « Marche à suivre » dans Console › Résumé, étape courante allumée selon le statut. |

## 13h00 – 15h00 · Charge et surveillance

| # | Point | Qui | État |
|---|---|---|---|
| 12 | Migrations en parallèle, bot toutes les 10 min vs imports test | Olivier (exécution) · **Code** (garde) | Le bot tourne sous verrou `migration-bot` (une seule passe à la fois) et `passeBotEnCours` par migration. **Ajouté** : transitions de statut atomiques dans `lancerImportTest` (un bot et un clic admin à la même seconde ne lancent plus deux dry-runs), refus 409 « Un import test est déjà en cours » dans la route, transition atomique de l'import final (deux clics = un seul lot). |
| 13 | Fiche à 10 s sous charge | **Code** | Cause trouvée : la fiche rapatriait toutes les lignes de staging pour compter. Remplacé par un GROUP BY côté base (`migration_staging_counts`, SQL `20260926110000`) avec repli paginé exact tant que le SQL n'est pas posé. Même correction sur le portail. Le plafond `.limit(20000)` de la recherche de doublons de l'import test est remplacé par une lecture paginée. |

## 15h00 – 17h00 · Verrouillage

| # | Point | Qui | État |
|---|---|---|---|
| 14 | Nettoyage des bureaux de test, revue des textes d'erreur | Olivier · **Code** | Texte « fichier tronqué » précise 50 000 lignes et conseille moins de 20 000 par fichier. Pied de page du portail corrigé : Excel accepté, ZIP refusé (l'ancien texte disait l'inverse). |
| 15 | Derniers correctifs poussés, dernier import complet | Olivier | Après déploiement de cette branche. Relancer `scripts/migration-bench/e2e-trap.mjs` (règle du dépôt après tout changement de `server/lib/migration/`). |
| 16 | Feu vert si 15 passe sans intervention | Olivier | |

## SQL à appliquer (staging puis prod)

`supabase/migrations/20260926110000_migration_staging_counts.sql`. Sans lui, tout fonctionne : le code bascule sur le comptage paginé et écrit un seul avertissement dans les journaux Railway (`migration_staging_counts absente`).

## Réserves

- Le SMS de devis (`POST /quotes/:id/send-sms` dans `routes/quotes.ts`) appelle Twilio directement, pas `sendSmsIfConfigured`. La garde du gel n'y est donc pas prouvée par lecture. C'est exactement le test du point 7 : s'il part, me le dire, la correction tient en cinq lignes.
- Les chiffres attendus (853 / 859 / 651 / 67) viennent de la feuille de route, pas d'une lecture de la base : je n'ai pas d'accès en lecture à la prod depuis cette session.
