# Audit complet — notes par catégorie

**Mesuré le 2026-07-31** sur la production (`bbzcuzqfgsdvjsymfwmr`, PostgreSQL 17.6,
47 Mo), après les correctifs de la journée. Chaque note repose sur des chiffres
relevés dans `pg_catalog`, `pg_stat_statements` et par exécution réelle — jamais
sur une lecture de code source, qui a produit treize findings faux au cours de
cet audit.

---

# **Note globale : 7,5 / 10**

| # | Catégorie | Note |
|---|---|---|
| 1 | Cloisonnement multi-tenant (RLS) | **9,5** |
| 2 | Intégrité des données | **9,5** |
| 3 | Fonctions et privilèges | **8,5** |
| 4 | Performance | **8** |
| 5 | Détection et observabilité | **6,5** |
| 6 | Surface exposée | **5,5** |
| 7 | Cohérence code ↔ base | **4,5** |
| 8 | Hygiène des migrations | **4,5** |
| 9 | Sauvegarde et reprise | **3,5** |

La sécurité au sens strict est excellente. Ce qui pèse, c'est **tout ce qui
entoure** la base : savoir qu'elle a un problème, pouvoir la restaurer, pouvoir
la reconstruire.

---

## 1. Cloisonnement multi-tenant — **9,5 / 10**

| Mesure | Valeur |
|---|---|
| Tables | 218 |
| Sans RLS activée | **0** |
| Avec RLS mais sans `FORCE` | **0** |
| Avec RLS mais sans aucune policy | 1 (`security_canary_runs`, refus total volontaire) |
| Policies | 584 |
| Vues sans `security_invoker` | **0** |
| Références cross-organisation en base | **0** |

**Prouvé par exécution, pas déduit** : en se faisant passer pour un utilisateur
réel, 47 tables et 4 vues **contenant effectivement des données d'autres
organisations** ont été testées — aucune ligne ne franchit la frontière. Le cas
le plus probant : `audit_events`, 1 937 lignes d'autres organisations,
**aucune visible**.

Le `FORCE ROW LEVEL SECURITY` sur 100 % des tables est rare. La plupart des
équipes activent la RLS sans réaliser que le propriétaire de la table la
contourne.

**Ce qui manque le demi-point** : 123 relations sur 170 n'ont pas pu être testées
de façon concluante, faute de données réparties sur plusieurs organisations —
sur 31 organisations, **deux seulement sont réelles**. Ce n'est pas un défaut du
cloisonnement mais une limite de mesure, qui se lèvera avec de vrais clients.

---

## 2. Intégrité des données — **9,5 / 10**

| Mesure | Valeur |
|---|---|
| Contraintes | 1 064 |
| Restées `NOT VALID` | **0** |
| Tables sans clé primaire | **0** |
| Clés étrangères | 563 |
| Colonnes `timestamp` sans fuseau | **0** |
| Montants stockés en flottant | **0** * |
| Invariants en échec (7 sondes) | **0** |

\* La seule détection est `tracking_sessions.total_distance_m` — une distance,
pas de l'argent. Faux positif de mon filtre.

Les montants sont en **centimes entiers**, et le trigger
`sync_legacy_money_columns` dérive automatiquement les colonnes décimales à
chaque écriture, sur `jobs` **et** `invoices`. La dérive des montants est
**structurellement impossible** — j'avais d'abord conclu l'inverse, à tort, en
manquant ce trigger.

**Le demi-point manquant** : 7 clients sur 66 (~10 %) sont en doublon d'identité
au sein d'une même organisation, la contrainte d'unicité ayant été retirée
délibérément au profit d'une déduplication applicative sujette aux courses.

---

## 3. Fonctions et privilèges — **8,5 / 10**

| Mesure | Valeur |
|---|---|
| Fonctions | 319 |
| `SECURITY DEFINER` | 249 |
| Sans `search_path` figé | **0** |
| Exécutables par `anon` | **0** |
| Exécutables par `authenticated` | 102 — **toutes triées** |
| Injections SQL | **0** |

Les 109 fonctions accessibles aux utilisateurs connectés ont été classées une
par une : 95 avaient déjà une garde, 4 sont des utilitaires sans accès aux
données, 5 étaient les primitives de garde elles-mêmes. Les **9 cas réels** ont
été fermés aujourd'hui, dont deux fuites concrètes (`list_archived_items` en
lecture, `rpc_recalculate_quote` en écriture).

Un seul cas de SQL dynamique subsiste, dans `archive_record` — et il est
**correct** : `format('%I')` empêche l'injection, un contrôle admin précède, et
chaque requête filtre sur `org_id`.

**Ce qui coûte 1,5 point** : `archive_record` n'impose pas de liste blanche sur
`p_entity_type`, ce qui laisse un admin viser une table inattendue **dans sa
propre organisation**. Et quatre fonctions d'archivage supplémentaires
(`archive_record`, `restore_archived_record`, `batch_restore`,
`purge_old_soft_deletes`) n'ont **aucun appelant** — ni dans le code, ni en
23 jours de trafic.

---

## 4. Performance — **8 / 10**

| Mesure | Valeur |
|---|---|
| Taille de la base | 47 Mo |
| Requêtes tracées (23 jours) | 4 683 |
| Requête applicative la plus lente | **524 ms** (suppression d'organisation, 36 appels) |
| Puis | 157 ms, puis sous 100 ms |
| Index jamais utilisés | 713 sur 951 (**75 %**) |

**Correction importante** : la requête la plus lente de la base est
`SELECT name FROM pg_timezone_names` — 916 ms, **29 714 appels**, soit ~7,5 heures
de temps cumulé. Ce n'est **pas ton application** : c'est le tableau de bord
Supabase lui-même, comme les autres requêtes lentes du haut du classement
(inventaire des extensions, introspection des fonctions, statut de réplication).
Sans cette distinction, j'aurais pénalisé la performance à tort.

Les vraies requêtes applicatives sont **saines**.

**Les 2 points manquants** : 75 % des index ne servent jamais. À 47 Mo c'est
sans conséquence, mais chaque index coûte à l'écriture, et le ratio signale un
schéma qui a accumulé sans jamais élaguer.

---

## 5. Détection et observabilité — **6,5 / 10**

| Mesure | Valeur |
|---|---|
| Tâches planifiées actives | 9 sur 10 |
| Échecs de cron actifs | **0** |
| `audit_events` | 2 198 |
| `security_events` | 109 |
| `login_history` | **63** (branché aujourd'hui, historique depuis le 17 avril) |
| `security_incidents` | 0 |
| `secret_rotation_log` | **0** |

Progrès net aujourd'hui : les 7 sondes d'invariants, qui n'avaient **aucun
appelant**, tournent désormais chaque nuit ; la télémétrie d'authentification,
vide depuis toujours, est alimentée toutes les 15 minutes.

Les 6 « échecs de cron » détectés étaient la tâche `cleanup_lost_leads`, qui
échouait chaque nuit sur `relation "public.leads" does not exist` — **déjà
supprimée** le 30 juillet. Résidu historique, pas un problème actif.

**Ce qui plafonne la note** : **personne n'est prévenu.** Les sondes écrivent
dans `security_events`, et rien ne lit cette table automatiquement. Une
détection que personne ne regarde équivaut à pas de détection. Et les
**tentatives de connexion échouées ne sont pas capturées** — le login ne
transite pas par le serveur, il faudrait un Auth Hook Supabase. Un CRM sans
détection de force brute, c'est une serrure que personne ne surveille.

---

## 6. Surface exposée — **5,5 / 10**

| Mesure | Valeur |
|---|---|
| Tables lisibles par `anon` au niveau des droits | **211 sur 218** |
| Tables écrivables par `authenticated` | 59 |
| Tables **vides** | **151 sur 218** |
| Tables publiées en Realtime | 15 |

Aucune fuite constatée — les 35 tables sensibles testées au rôle `anon` ne
rendent rien. Mais pour **211 tables, la RLS est la seule barrière** : un défaut
de policy devient immédiatement une fuite, sans second filet.

Et **69 % des tables sont vides**. Ce sont des portes ouvertes sur des pièces
vides, chacune avec ses policies jamais éprouvées par un usage réel. Parmi
elles, des noms qui attirent l'œil : `payment_provider_secrets`, `api_keys`,
`login_history`.

---

## 7. Cohérence code ↔ base — **4,5 / 10**

**C'est le vrai point faible, et de loin.**

| Constat | Nombre |
|---|---|
| Fonctions mortes en production sans que rien ne le signale | **9** |
| Fonctions supprimées après preuve de non-usage | 8 |
| Fonctions mortes supplémentaires détectées (non traitées) | 4 |
| Appels frontend pointant dans le vide | 1 |
| Fonctionnalités cassées trouvées | **inscription, effacement Loi 25, incidents, MFA, rapports planifiés** |

Un seul motif — une garde interne sur `auth.uid()` dans une fonction appelée en
`service_role`, où `auth.uid()` vaut NULL — avait rendu **neuf fonctions
inertes**, dont le **droit à l'effacement Loi 25**. Toutes échouaient en silence
depuis des semaines.

Pire : **l'inscription elle-même était cassée**. `OnboardingFlow.tsx:248` crée
l'adhésion depuis le navigateur ; le droit d'exécution requis avait été retiré
par un durcissement générique, et l'erreur était avalée par un `await` sans
`try/catch`. L'utilisateur créait son organisation et n'en devenait jamais
membre. Découvert **en testant qu'on ne la cassait pas**.

Tout cela a été corrigé aujourd'hui. La note reste basse parce que **le
mécanisme qui a permis ces divergences est toujours là** : rien ne vérifie que
ce que le code appelle existe et reste exécutable.

---

## 8. Hygiène des migrations — **4,5 / 10**

| Mesure | Valeur |
|---|---|
| Collisions de timestamps | **25** (53 fichiers) |
| Conséquence | `supabase db push` **inutilisable** |
| Dérive base ↔ dépôt | **prouvée** (`has_org_role` existe sans migration) |

Le dossier de migrations n'est pas exécutable : le préfixe à 14 chiffres est la
clé primaire du registre, et 25 valeurs sont dupliquées. Tout est donc appliqué
à la main — y compris mes onze migrations d'aujourd'hui, écrites **après**
application pour documenter.

**Ce qui a progressé** : `complete_schema.sql`, périmé de 121 migrations et
responsable de **quatre findings faux**, porte maintenant une bannière
d'avertissement et est remplacé par `SCHEMA_SNAPSHOT.md`, généré depuis le
catalogue et régénérable à la demande.

---

## 9. Sauvegarde et reprise — **3,5 / 10**

| Mesure | Valeur |
|---|---|
| PITR | **non activé** |
| Sauvegardes quotidiennes | 8 conservées |
| Perte maximale en cas d'incident | **24 heures** |
| Restauration déjà testée | **jamais** |
| Environnement de staging | **aucun** |

C'est la note la plus basse, et la plus facile à remonter. Une sauvegarde jamais
restaurée n'est pas une sauvegarde — c'est une hypothèse. Deux heures de test
feraient passer cette catégorie à 6.

À 8 354 lignes et deux organisations réelles, 24 heures de perte c'est presque
rien. Dès le premier vrai client, c'est une journée de jobs, de devis et de
factures saisis sur le terrain — une perte de facturation, pas une perte
technique.

---

## Comment passer de 7,5 à 9

Par ordre de rentabilité, tel que chiffré dans
`../operations/db_maintenance.md` :

1. **Alerte sortante sur `security_events`** — ½ journée. Sans elle, toute la
   détection installée aujourd'hui ne sert à rien.
2. **Tester une restauration** — 2 h. Fait passer la catégorie 9 de 3,5 à 6.
3. **Capturer les connexions échouées** — 1 journée. Dernière pièce de la
   catégorie 5.
4. **Un contrôle automatique de cohérence code ↔ base** — ½ journée. Extraire
   les `.rpc()` et `.from()` du code, vérifier en CI que chaque objet existe et
   reste exécutable. C'est exactement ce qui a manqué pendant des semaines, et
   c'est le seul moyen de faire remonter durablement la catégorie 7.
5. **Environnement de staging** puis **migrations exécutables** — 2 jours.
   Débloque le test d'isolation en CI, qui sort aujourd'hui **en vert** sans
   avoir rien testé.

**Environ cinq jours de travail**, dont les deux premiers couvrent l'essentiel
du risque.
