# Audit de la page Statistiques (/insights) — 2026-09-30

**Verdict court.** La page n'était pas fiable. Quatre défauts critiques faussaient les chiffres pour tous les
clients :
1. Les factures importées de Jobber (618 factures, 279 261,15 $ chez le principal client) valaient **0 $** de revenu.
2. Tout était compté en **UTC** : un paiement du 31 à 23 h 30 tombait le mois suivant.
3. Cinq cartes **tronquaient en silence à 1 000 lignes** : « Revenu par service » affichait 2,8 % du vrai chiffre sur 3 ans.
4. Chaque mois du graphique portait **le nom du mois précédent**.

S'y ajoutent une fuite par rôle (un technicien pouvait lire le revenu et les meilleurs clients par appel direct) et un
« Taux de réussite » de 100 % en prod, fait uniquement de copies du classement.

Tout est livré : le code (PR #803) et les deux migrations, appliquées sur staging puis en prod le 2026-09-30 avec ton accord (§7).
Puis, à ta demande (« corrige tout »), un deuxième lot : filtres, période personnalisée, comparaison, export, libellés
honnêtes, entonnoir cohérent, détail derrière chaque chiffre, et confidentialité des taux horaires (§8).

Méthode : une stack Supabase **locale et jetable** (Postgres 17 + GoTrue + PostgREST avec `max_rows = 1000` comme la
prod, schéma = prod, droits recopiés de la prod) et un jeu de données déterministe. Chaque chiffre est comparé à un
**oracle SQL indépendant**. Rien n'a été écrit sur staging ni sur la prod : la prod n'a été que **lue**, et seulement
son catalogue et des comptes agrégés.

---

## 1. Inventaire — ce que la page affiche et comment c'est calculé

Période : un seul état partagé (12 derniers mois par défaut ; 2 ans, 3 ans, 12 semaines, cette année). Les 10
sélecteurs de la page pilotent tous cette même période. « TTC » = taxes incluses.

| # | Élément | Affiche | Source | Définition (après correction) | Date utilisée |
|---|---|---|---|---|---|
| 1 | Sélecteur de période (×10) | fenêtre des cartes | `insightsPeriod.periodRange` | dates **locales** du navigateur | — |
| 2 | Revenu (courbe + total) | encaissé par mois/semaine | `rpc_insights_revenue_series` | paiements réussis **nets des remboursements**, pourboires exclus, TTC ; + factures payées **sans aucun paiement** (import) ¹ | date de paiement ¹ |
| 3 | Infobulle du graphique | mois + montant | idem | montant **au cent** | — |
| 4 | Revenu par service (beignet) | top 3 + Autre | `fetchTopServices` (lecture de `jobs`) | valeur TTC des jobs **créés**, hors brouillon/annulé, **par titre de job** ² | création du job |
| 5 | Modes de paiement (beignet) | top 3 + Autre | `fetchPaymentMix` (lecture de `payments`) | paiements réussis nets des remboursements, par mode | date de paiement |
| 6 | Valeur moyenne d'un job | courbe + moyenne | `fetchAvgJobValueSeries` | jobs **complétés**, TTC ; chiffre = somme / nombre | **complétion** |
| 7 | Équipes — classement par revenu | top 5 | `rpc_insights_team_performance` | valeur TTC des jobs complétés de l'équipe | création du job ¹ |
| 8 | Équipes — taux de complétion | top 5 | idem | complétés / tous les jobs créés (annulés compris) ² | création du job ¹ |
| 9 | Top clients par revenu | top 5 | `fetchValeurTousClients` → `rpc_insights_client_lifetime_value` | **tous les clients**, triés par max(jobs non brouillon/annulés TTC, factures payées TTC) — à vie | à vie |
| 10 | Fidélité — part récurrente | % | `fetchLoyalty` | valeur des jobs complétés `job_type = recurring` / total | complétion |
| 11 | Fidélité — valeur vie moyenne | $ | `valeurVieMoyenne` | moyenne de (9) sur **tous** les clients | à vie |
| 12 | Fidélité — rétention | % | `rpc_insights_cohort_retention` | moyenne des cohortes (mois 1 à 11), 12 derniers mois, **indépendante de la période** ² | création des jobs |
| 13 | Entonnoir — nouveaux leads | nombre | `rpc_insights_lead_conversion` | clients créés qui ont été des leads | création ¹ |
| 14 | Entonnoir — devis approuvés | nombre | `fetchQuoteKpis` | soumissions créées, statut approuvé ou converti | création ¹ |
| 15 | Entonnoir — leads convertis | nombre | `rpc_insights_lead_conversion` | leads **distincts** devenus job | création du job ¹ |
| 16 | Taux de conversion | % | idem | convertis / créés (plafonné à 100 %) | ¹ |
| 17 | Délai de conversion | jours | `rpc_insights_pipeline_velocity` | won_at − created_at des deals gagnés, **sans les copies du classement** ¹ | création du deal |
| 18 | Taux de réussite | % | idem | gagnés / (gagnés + perdus), **sans les copies du classement** ¹ | création du deal |
| 19 | Valeur des devis | total / approuvés / % | `fetchQuoteKpis` | somme TTC des soumissions créées | création |
| 20 | À recevoir | $ + nb en retard | `rpc_insights_invoices_summary` | solde des factures envoyées/partielles, **toute l'entreprise, sans période** ; retard = échéance < aujourd'hui **local** ¹ | — |
| 21 | Versements à venir | $ | `fetchPayoutSummary` (Stripe, API) | fonds en transit chez Stripe | — |
| 22 | Délai de paiement | jours | `rpc_insights_invoices_summary` | moyenne (payée − émise) des factures payées dans la période | paiement ¹ |
| 23 | Revenu par ville (carte + classement) | $, jobs, moyenne | `fetchMapJobsInRange` | jobs complétés ayant une visite dans la période, comptés une fois, TTC, ville tirée de l'adresse | visite |
| 24 | Rentabilité par job (tableau) | revenu, main-d'œuvre, commissions, dépenses, profit, marge | `/api/profitability` → `analyserRentabilite` (PR #781, mergée pendant l'audit) | facturé HT moins remboursements (prix du job/devis en estimation si non facturé) − main-d'œuvre pointée × taux − commissions − dépenses du dossier Dépenses | période locale — même fonction que Lumi `analyze_profitability` |
| 25 | Saisie « Dépenses » | dossier Dépenses (PR #781) | — | alimente la rentabilité | — |
| 26 | Liens des cartes | navigation | `LinkCard` | /finances, /payments, /jobs, /leaderboard, /clients, /pipeline, /invoices — **pages non filtrées** ² | — |

¹ correct seulement une fois la migration §7-A appliquée (sinon UTC / définition fausse — voir §2).
² choix de définition discutable, signalé en §2 sans être changé (aucun nouveau KPI sans ton accord).

**Ce que la page n'a pas** (la mission demandait de les tester) : aucune **période personnalisée**, aucune
**comparaison à la période précédente**, aucun filtre **technicien / équipe / service / client / rep**, aucun
**export**. Ils ne peuvent donc pas être « testés » ici ; ils sont proposés en §6. (Des exports CSV existent dans
Réglages → Rapports.)

### Incohérences de définition entre éléments de la page

| Entre | Écart |
|---|---|
| Revenu (2) ↔ Revenu par service (4) | (2) = argent **encaissé**, (4) = **valeur des jobs créés** (même non faits, même non payés), par **titre** et non par service du catalogue. Les deux portent le mot « Revenu ». |
| Revenu (2) ↔ Rentabilité (24) | (2) encaissé TTC, (24) facturé **HT** : la marge et le revenu d'un même mois ne se comparent pas. |
| Revenu (2) ↔ Équipes (7) / Zones (23) / Valeur moyenne (6) | encaissé vs valeur TTC des jobs complétés : (7)+(23) ≠ (2) même sans décalage de dates. |
| Équipes (7, 8) ↔ Valeur moyenne (6) | (7) date de **création** du job, (6) date de **complétion** (alignée par l'audit) : un job créé en août et fini en septembre compte dans deux mois différents. |
| Entonnoir (13 → 14 → 15) | mélange leads et **soumissions** : l'étape 2 n'est pas un sous-ensemble de l'étape 1, d'où des % entre étapes qui peuvent dépasser 100 %. |
| Rétention (12) | ignore la période choisie. |
| À recevoir (20) | ignore la période choisie (normal pour un solde, mais le sélecteur est affiché juste à côté). |
| Liens (26) | cliquer « À recevoir » ouvre **toutes** les factures, pas la liste qui fait le chiffre : « somme de la liste = KPI » n'est vérifiable pour aucune carte. |

---

## 2. Bugs trouvés — classés, avec le correctif

Légende : ✅ corrigé dans le code (branche) · 🟡 corrigé par une migration **en attente** (§7) · 🔵 laissé à la PR #781 · ⬜ non corrigé (décision à prendre).

### Critique

| ID | Bug | Preuve | Correctif |
|---|---|---|---|
| C-1 | **Factures payées sans ligne de paiement = 0 $ de revenu.** La courbe Revenu, Modes de paiement, Lumi (`get_revenue_summary`, `get_financial_overview`) et les rapports ne lisent que `payments`. | Prod : l'entreprise principale a **618 factures payées, 279 261,15 $, 0 paiement**. Sa courbe Revenu est vide. | 🟡 `stats_encaissements()` ajoute `paid_cents` des factures payées sans paiement, à `paid_at`. |
| C-2 | **Tout en UTC.** Les RPC convertissent les dates à minuit UTC ; le client aussi (`toISOString`, `T23:59:59.999Z`). Le 31 à 23 h 30 (Toronto) compte le mois suivant ; les changements d'heure et le 31 décembre aussi. | Oracle : août 2026 encaissé = 1 379,70 $, la page affichait 1 149,75 $ ; décembre 2025 facturé = 574,88 $, la page 0 $. 41 écarts sur 104 tests au premier passage. | ✅ côté client (période, soumissions, valeur moyenne, fidélité, zones, services, modes) · 🟡 dans les 13 RPC (`company_settings.timezone`). |
| C-3 | **Troncature silencieuse à 1 000 lignes** (`max_rows` de PostgREST, confirmé en prod) : Revenu par service, Modes de paiement (plafond 5 000), Zones (les 1 000 plus **anciennes** visites), Valeur moyenne, Fidélité (`limit(5000)` → 1 000), Valeur des devis, Top services de Lumi. | Tenant de 50 000 jobs, 3 ans : Revenu par service **618 566,75 $ affichés pour 22 371 592,70 $** ; Modes de paiement 3,08 M$ pour 49,2 M$. L'entreprise principale en est à 896 jobs. | ✅ `lignesPaginees.toutesLesLignes` (pages de 1 000, ordre stable) partout ; rentabilité 🔵 #781 (défaut transmis). |
| C-4 | **Chaque mois du graphique porte le nom du mois précédent** : `new Date('2026-09-01')` est minuit UTC, soit le 31 août au soir en Amérique. | Test de rendu jsdom : « sept. » absent avec l'ancien code, présent avec le nouveau. | ✅ `RevenueTrendCard`. |

### Élevé

| ID | Bug | Preuve | Correctif |
|---|---|---|---|
| E-1 | **Remboursement partiel compté en entier** (le statut reste `succeeded`, `refunded_cents` > 0). | Mars 2026 : 1 149,75 $ affichés pour 849,75 $ encaissés. | ✅ Modes de paiement · 🟡 RPC (revenu, conversions par source). |
| E-2 | **Rôles : technicien et vendeur lisent toutes les stats financières** par appel direct (revenu, factures, top clients **avec courriels**, prévisions, risque de départ). La page les bloque, pas la base. | 20 tests de sécurité en échec, identiques en prod (mêmes fonctions, même GRANT). | 🟡 garde `stats_lecture_permise` (clé de la page Rôles). |
| E-3 | **Taux de réussite et délai de conversion faux** : les deals `source = 'job'` (copies du classement, gagnées d'office pour chaque job avec vendeur) sont comptés ; délai calculé sur `updated_at`. | Prod : **7 deals gagnés sur 7 sont des copies** → 100 %. Jeu de test : délai 52 j au lieu de 10. | 🟡 exclusion + `won_at`. |
| E-4 | **Top clients par revenu** = les 6 meilleurs *scores CLV* (récence) triés par revenu : un gros client inactif disparaît. Lumi `get_top_clients` classait par score. | Jeu de test : François Pelletier (1 149,76 $) absent derrière des clients à 229,95 $. | ✅ page + Lumi : tous les clients, triés par total. |
| E-5 | **Valeur vie moyenne** calculée sur les 50 meilleurs scores seulement. | Tenant volumineux : 3 323,93 $ au lieu de la moyenne réelle. | ✅ sur tous les clients. |
| E-6 | **Lumi « ce mois-ci » = le mois suivant après 20 h** (serveur en UTC). | 30 sept. 21 h : Lumi répondait « octobre : 0 $ ». | ✅ `get_revenue_summary` au fuseau de l'entreprise. |
| E-7 | **Erreurs avalées → faux zéros.** Équipes, vélocité, clients, cohortes, modes, valeur moyenne, fidélité renvoyaient `[]`/0 sur panne : « Aucune donnée » indiscernable d'une panne. | Test E2E « erreur API ». | ✅ les erreurs remontent ; chaque carte affiche « Impossible de charger ces chiffres. — Réessayer ». Rentabilité 🔵 #781. |
| E-8 | **Rapports programmés** : « Revenus encaissés » comptait les paiements **échoués et en attente** ; « Solde impayé » toujours **0 $** (la RPC refuse le service_role). | Tests `rapport programmé` et `service_role`. Latent : 0 rapport programmé en prod. | 🟡 |
| E-9 | **Un technicien lit le taux horaire de ses collègues** (`team_members`, RLS par entreprise) — et leur date de naissance. | Test sécurité (`it.fails`). | ✅ §8 : grants par colonne + `membres_remuneration()`. |

### Moyen

| ID | Bug | Correctif |
|---|---|---|
| M-1 | Valeur moyenne : mois UTC de **création**, statut `invoiced` inexistant, chiffre = moyenne des moyennes mensuelles. | ✅ complétion locale, vraie moyenne. |
| M-2 | Pourcentages : l'heuristique « ≤ 1 → ×100 » affichait **30 %** pour un taux de complétion de 0,3 %. | ✅ échelle explicite par source. |
| M-3 | Modes de paiement en **anglais** dans l'interface française (« Card », « Cash », « Check ») ; « Autre » en français dans l'interface anglaise. | ✅ |
| M-4 | Clavier : Entrée sur un sélecteur de période **dans** une carte quittait la page. | ✅ `LinkCard` ignore les touches des contrôles intérieurs. |
| M-5 | Accès décidé par **nom de rôle** (owner/admin) et non par la permission `financial.view_analytics` : un rôle personnalisé autorisé était refusé. | ✅ `hasPermission` (même clé que la base). |
| M-6 | Cache : un paiement créé ailleurs n'apparaissait qu'après 60 s. | ✅ `refetchOnMount: 'always'` ; test E2E prouvé (rouge sans le correctif). |
| M-7 | Soumissions en attente : filtre `in('id', <tous les clients>)` → URL trop longue au-delà d'environ 1 000 identifiants, erreur ignorée. | ✅ liste des clients supprimés (courte). |
| M-8 | Infobulle du graphique arrondie au dollar. | ✅ au cent. |
| M-9 | Défense en profondeur : `auth.uid() IS NOT NULL AND …` laisse passer un appelant sans identité ; seul le GRANT protège (un environnement neuf fuit tant que `db:sync-acl` n'a pas été lancé — vérifié en local). | 🟡 |
| M-10 | `get_financial_overview` (Lumi) : marge = total **TTC** − dépenses, **sans main-d'œuvre**, mois borné en UTC. | ✅ réglé par #781 (mergée pendant l'audit, convenu avec la session qui la portait) ; parité vérifiée à midi et à 21 h. |
| M-12 | Courbe « Valeur moyenne d'un job » remplie en **noir plein** : l'id du dégradé contenait le titre (espaces, apostrophe), donc `url(#…)` invalide. | ✅ `useId()`. |
| M-13 | Sur écran étroit (≤ 640 px), les **noms** disparaissaient des légendes des deux beignets (seuls les montants restaient). | ✅ beignet et légende empilés. |
| M-14 | « 1 jobs » (pluriel fixe) dans les classements et la carte des villes ; mois de la valeur moyenne écrits « Sep / Déc » au lieu de « sept. / déc. » comme le graphique Revenu. | ✅ |
| M-15 | **Rentabilité (#781) sur gros volume** : sur 50 000 jobs, `analyserRentabilite` échoue (« Timed out acquiring connection from connection pool ») — `charger.ts` lançait toutes les tranches d'ids en même temps ; et `toutLire` pagine par OFFSET (coût quadratique avec la RLS). Aucun impact aux volumes actuels (≤ 896 jobs). | ✅ concurrence limitée à 5 lots — **corrigé sur `feat/audit-outils-lumi`** (a17dbab0, session de #781) · ⬜ pagination par curseur de `toutLire` : ouverte. |
| M-11 | `rpc_insights_budget_vs_actual` : **fonction cassée** (table `budget_targets` inexistante, en prod aussi). Code mort. | ⬜ à supprimer (après grep, règle 4). |

### Bas

| ID | Constat |
|---|---|
| B-1 | Contrôle interactif imbriqué : le sélecteur (`<button>`) est dans une carte `role="button"`, dont le nom accessible avale tout son texte. |
| B-2 | Les 10 sélecteurs de période sont liés : en changer un change toute la page, sans que rien ne le dise. |
| B-3 | Liens des cartes vers des pages non filtrées (§1, ligne 26). |
| B-4 | « Versements à venir » affiche « aucun compte connecté » aussi en cas d'erreur de l'API. |
| B-5 | Sur téléphone (navigateur mobile), `/insights` n'est pas accessible : la porte « télécharger l'application » la remplace (voulu, `mobileGate.ts`). La mise en page a été testée sur fenêtre étroite (390 px). |
| B-6 | Hors page, même famille de bug : l'aperçu multi-bureaux (`offices-overview.ts`) prend « aujourd'hui » en UTC ; le tableau de bord d'accueil remplace le revenu du jour par celui du mois quand il est nul ; la page Paiements affiche aussi les modes en anglais. |

---

## 3. Page ↔ Lumi

| Outil Lumi | Même fonction que la page ? | Écart trouvé | État |
|---|---|---|---|
| `get_revenue_summary` | oui (`rpc_insights_revenue_series`) | « ce mois-ci » = mois suivant après 20 h ; + C-1, C-2, E-1 | ✅ fuseau · 🟡 le reste |
| `compare_revenue` | `rpc_insights_period_comparison` (pas sur la page) | valeur facturée en UTC (août 1 149,75 $ au lieu de 1 379,70 $) | 🟡 |
| `get_financial_overview` | oui (revenu : `rpc_insights_revenue_series` ; marge : `analyserRentabilite`) | avant #781 : marge TTC sans main-d'œuvre ≠ carte (9 jobs / 2 689,41 $ vs 8 jobs / 2 062,50 $ en septembre) | ✅ #781 |
| `get_top_clients` | oui (même RPC) | classé par score, pas par total | ✅ |
| `get_top_services` | même logique, code dupliqué | UTC + plafond 1 000 | ✅ |
| `analyze_profitability` | oui (#781) : `analyserRentabilite`, comme la carte | aucun (totaux identiques, testé) | ✅ |
| Rapports programmés | `rpc_insights_overview` / `invoices_summary` | E-8 | 🟡 |

Après correction, migration (en local) et #781 : **17/17** tests de parité au vert.

---

## 4. Résultats des tests

Jeu de données (`tests/stats/fixtures/`) :
- **T1** : factures payées, partielles, en retard, annulée, supprimée, récurrente, importée ; TPS/TVQ ; remboursements partiel et total ; pourboire ; paiements échoué et en attente ; soumissions de chaque statut ; job à 3 visites ; 2 techniciens pointés (pauses, taux) ; un vendeur à commission ; 5 deals, dont les copies automatiques ; frontières (31 août 23 h 30, 8 mars et 2 novembre aux changements d'heure, 31 décembre 23 h 30 / 1er janvier 00 h 15).
- **T2** : montants en 7 777 777,77 $, qui ne doivent jamais apparaître.
- **T3** : vide.
- **T4** : 50 000 jobs, 100 000 factures, 100 000 paiements, 30 000 visites, 20 000 clients.

| Suite | Avant l'audit | Code corrigé, **sans** la migration | Code + migration (appliquée en local) |
|---|---|---|---|
| Oracle vérifié à la main (8 cas) | 8/8 | 8/8 | 8/8 |
| Exactitude — 104 tests (13 cartes × 7 périodes + tenant vide) | **63/104** | 82/104 (les 22 restants = fonctions SQL) | **104/104** |
| Sécurité — rôles, isolation, anonyme, service_role | 42/63 | isolation ✅, rôles ❌ (20 échecs) | **tout vert** + 1 écart connu (E-9) |
| Parité Lumi — 17 tests | 1/16 | 6/16 | **17/17** |
| Unitaires (CI), dont le rendu réel du graphique et les paginations | — | 10/10 | 10/10 |
| Suite complète du dépôt | — | 0 échec (voir fin de l'audit) | idem |
| E2E Playwright : 15 scénarios × bureau / iPad / mobile | — | — | **21/21** (24 ignorés à dessein : les scénarios de valeurs tournent sur bureau seulement) |

Les deux chemins du code sont testés : **repli** (fonctions d'agrégat absentes : lecture paginée, juste mais plus lente)
et **agrégat** (migration appliquée). Les 8 captures de régression (FR, EN, vide, chargement, erreur, technicien ;
bureau, iPad, mobile) sont dans `tests/stats/e2e/__captures__/`.

Scénarios E2E, tous cliqués : chiffres à l'écran = oracle (revenu au cent via `data-cents`, top clients dans l'ordre,
à recevoir, retards, délai, conversion, réussite, zones) · les 5 périodes du menu · les 10 sélecteurs liés · clavier ·
les 9 cartes cliquables mènent à leur page · infobulle au cent · survol des beignets · aucun défilement horizontal ni
graphique coupé (1440, iPad, 390 px) · anglais sans français et français sans anglais · chargement (squelettes) ·
panne d'API (« Réessayer » recharge) · tenant vide (ni NaN ni ∞) · technicien (aucune requête de stats émise) ·
téléphone (porte « application ») · un paiement créé ailleurs apparaît au retour sur la page (test rouge sans le
correctif, vert avec).

Isolation entre entreprises : **aucune fuite**. Les 14 RPC appelées avec l'`p_org` de T2 sont toutes refusées, les
tables de T2 lues directement renvoient `[]`, et aucune réponse de T1 ne contient un montant ou un nom de T2. L'org est
toujours tirée de la session (`getCurrentOrgIdOrThrow`) ; l'URL ne porte jamais d'org.

Arrondis : la page somme des **cents entiers** tels que stockés par les factures (arrondi par taxe, comme l'UI des
factures) : il n'y a pas d'écart « total des arrondis / arrondi du total » possible. L'affichage compact (« 4,4 k $ »)
arrondit ; la valeur exacte est désormais dans l'infobulle et l'attribut `title`.

Dénominateur à 0 : le tenant vide ne produit **ni NaN, ni ∞, ni undefined** (test d'exactitude et E2E). Le taux de
réussite et le délai affichent « — » quand aucun deal n'est clos.

---

## 5. Performance (tenant T4 : 50 000 jobs, 100 000 factures, 100 000 paiements)

Mesures locales : appels réels de la page à travers PostgREST, RLS active, 12 répétitions après chauffe, migrations A et B appliquées en local, passe isolée (d'autres sessions faisaient tourner leurs tests sur la même machine : les p95 sont prudents).

| Appel de la page (12 derniers mois) | Avant p50 / p95 (ms) | Après p50 / p95 (ms) |
|---|---|---|
| **Chargement initial de la page** (tous les appels en parallèle, hors rentabilité) | **977 / 8 031** | **230 / 304** |
| **Changement de période** (→ 3 dernières années) | **2 401 / 3 856** | **405 / 470** |
| Revenu (série) | 56 / 62 | 108 / 127 |
| Revenu par service | 17 / 21 ⚠ tronqué | 11 / 14 |
| Modes de paiement | 565 / 1 340 ⚠ tronqué | 29 / 38 |
| Valeur moyenne d'un job | 17 / 27 ⚠ tronqué | 14 / 19 |
| Équipes | 41 / 77 | 15 / 21 |
| Top clients | 130 / 229 ⚠ mauvais clients | 189 / 219 |
| Valeur vie moyenne | (dans fidélité) ⚠ 50 clients | 91 / 152 |
| Fidélité | 201 / 499 | 73 / 102 |
| Conversion des leads | 92 / 191 | 52 / 67 |
| Vélocité du pipeline | 6 / 8 | 4 / 8 |
| Soumissions | 54 / 89 ⚠ tronqué | 41 / 56 |
| Trésorerie | 98 / 150 | 44 / 63 |
| Zones | 49 / 91 ⚠ 1 000 visites | 32 / 40 |
| Rentabilité (depuis #781 : `analyserRentabilite`, serveur) | 101 / 169 (ancienne carte) | **≈ 14 s** pour 9 794 jobs sur 12 mois, et parfois en échec (pool saturé) — M-15 |

⚠ « Avant » était rapide **parce que faux** : tronqué à 1 000 lignes. Sur 3 ans, Revenu par service affichait 618 566,75 $
pour 22 371 592,70 $ ; après : 22 371 592,70 $ = réel. Une étape intermédiaire l'a démontré : rendre ces cartes justes
en lisant toutes les lignes dans le navigateur coûtait **plus de 25 s** par chargement (la RLS s'évalue à chaque
ligne). D'où les **fonctions d'agrégat en base** de la migration A (modes de paiement, revenu par service, jobs
complétés par mois, valeur vie moyenne, zones par adresse). Sans elles, le code retombe sur la lecture paginée **par
curseur** : juste, et linéaire au lieu de quadratique (Modes de paiement : 12,4 s → 6,6 s, contre 29 ms avec
l'agrégat). Pour tes entreprises actuelles (896 jobs au plus), les deux chemins sont instantanés.

**Ce qu'EXPLAIN ANALYZE montre** (rôle `authenticated`, RLS active) :
1. **Le coût dominant est la RLS, pas les index.** La politique de `jobs` appelle `has_org_membership(auth.uid(), org_id)`
   **pour chaque ligne**, et une fonction SECURITY DEFINER ne peut pas être « inlinée ». Cela fait environ 40 µs par
   ligne : 665 ms pour les 16 000 jobs d'une année, 3,7 s pour 50 000 (carte Zones sans plafond). Toute lecture directe
   de tables en souffre, pas seulement /insights.
   → Recommandation (migration à concevoir, non écrite) : réécrire le prédicat en
   `org_id in (select public.mes_orgs())`, évalué une seule fois, ou déplacer les agrégats de /insights dans des RPC
   SECURITY DEFINER gardées par permission.
2. Index manquants : `time_entries(org_id, job_id)` (rentabilité), expressions
   `coalesce(issued_at, created_at)` (facturé) et `completed_at` des jobs complétés, `invoices.paid_at`.
   → migration proposée §7-B.
3. **N+1 / doublons.** La page calculait deux fois la valeur client (`fetchClientLifetimeValue(6)` puis `(50)`) : c'est
   désormais une seule requête partagée par Top clients et Valeur vie. « Modes de paiement » enchaînait 5 appels
   `rpc_list_payments`, chacun recalculant un `count(*) over()` sur toute la période : c'est remplacé par une lecture
   directe.
4. **Calculs en JS qui devraient être en SQL** : revenu par service, modes de paiement, valeur moyenne, fidélité et
   zones rapatriaient les lignes pour les additionner dans le navigateur. → agrégats en base (migration A), avec repli
   paginé juste tant qu'elle n'est pas appliquée.
5. Graphiques : calculs en `useMemo`, aucun recalcul à chaque rendu. Aucune librairie de graphiques : tout est en SVG
   fait main, donc pas de bundle à alléger. La page est déjà en `React.lazy`. Seule la carte Zones charge Leaflet et
   les contours des villes (Nominatim), et elle le fait déjà à la demande.

---

## 6. Statistiques manquantes (comparées à Jobber, Housecall Pro, ServiceTitan) — propositions seulement

Par ordre d'utilité pour un entrepreneur en services :

1. **Période personnalisée + comparaison à la période précédente** (flèches ↑↓ sur chaque KPI). Standard chez les trois. La RPC `rpc_insights_period_comparison` existe déjà.
2. **Âge des comptes à recevoir** (0–30, 31–60, 61–90, 90+ jours), avec clic vers la liste filtrée. C'est le rapport le plus consulté chez Jobber.
3. **Filtres technicien / équipe / vendeur / service / client** sur toute la page.
4. **Revenu et marge par technicien et par vendeur**, commissions dues et payées (`fs_commission_entries`) : ServiceTitan en fait son écran central.
5. **Taux d'acceptation des soumissions** en nombre et en valeur, et délai envoi → acceptation (Housecall Pro « Estimates »).
6. **Revenu par service du catalogue** (`job_line_items`), plutôt que par titre de job.
7. **ROI des sources de leads** : leads, conversions et revenu par source. La donnée est déjà calculée (`breakdown`) mais n'est pas affichée.
8. **Taxes perçues (TPS/TVQ) par période**, pour les déclarations au Québec.
9. **Revenu récurrent** (contrats et factures récurrentes) et clients perdus.
10. **Utilisation des techniciens** : heures facturées / heures pointées, durée réelle vs prévue.
11. **Revenu planifié** (jobs à venir) / prévision : `rpc_insights_revenue_forecast` existe, sans écran.
12. **Rappels et retours** (jobs refaits), et avis clients par technicien.
13. **Export** CSV/PDF de chaque carte (aujourd'hui dans Réglages → Rapports seulement).

---

## 7. Migrations — APPLIQUÉES le 2026-09-30 (staging puis prod, avec ton accord)

| Fichier | Contenu | Validé comment |
|---|---|---|
| **A** `supabase/migrations/20261004300000_statistiques_fuseau_encaisse_roles.sql` | 5 fonctions d'agrégat pour les cartes calculées dans le navigateur (le code les utilise si elles existent, sinon lecture paginée) ; fuseau du tenant dans les 13 RPC de stats ; encaissé net des remboursements + factures importées (`stats_encaissements`) ; exclusion des deals du classement, délai sur `won_at` ; garde de permission de la page Rôles (`stats_lecture_permise`, service_role explicite) ; « aujourd'hui » local ; dernière activité = date du job. **Signatures et types de retour inchangés.** Effet aussi sur Réglages → Rapports et l'aperçu multi-bureaux (mêmes fonctions : ils deviennent cohérents). | Appliquée sur la base locale uniquement : exactitude 104/104, sécurité et parité Lumi vertes (hors 2 écarts connus), chargement 230 ms p50 sur 50 000 jobs. |
| **B** `supabase/migrations/20261004300100_statistiques_index.sql` | 6 index partiels (aucun changement de données). | Appliquée en local avec A pour les mesures du §5. Utile surtout à la lecture de repli et à `rentabilite_jobs` ; secondaire une fois les agrégats en place. |

Appliquées par `db:apply` sur staging, puis contrôlées : `check:broken-objects` (aucun objet cassé), `check:schema-refs` (aucun écart), `check:db-coherence` (3 écarts QuickBooks **préexistants**, sans lien avec ces migrations). Ensuite `db:apply:prod`. Vérifié : prod = staging = local validé (empreintes des fonctions), `anon` sans aucun droit, 6 index présents. Effet en prod : l'entreprise principale affiche 279 261,15 $ encaissés (au lieu de 0 $), et le taux de réussite n'est plus un faux 100 %.

Non écrites, à décider ensemble :
- ~~E-9~~ : fait au §8.
- Perf RLS (§5.1) : réécriture des politiques de `jobs`, `invoices`, etc.
- M-11 : suppression de `rpc_insights_budget_vs_actual` (fonction morte).

---

## Hors périmètre, mais à savoir tout de suite

- **Les sauvegardes prod ne tournent plus depuis le 26 septembre** : le dernier fichier de `../lume-backups/` date du 26/09. Le mot de passe prod de `.env.local` (`SUPABASE_DB_PASSWORD`) est refusé par la prod, tout comme celui de staging dans `SUPABASE_DB_URL` : ils ont probablement été changés sans mise à jour de `.env.local`.
- **Staging ≠ prod** : 592 fonctions `public` en staging, 474 en prod (travail d'autres sessions posé sur staging seulement). `crm_is_org_member` et `crm_is_org_admin` diffèrent aussi en prod de leur définition dans le dépôt.
- **Incident de ma part** : pendant l'audit, un appel en lecture à l'API Management (`/postgrest`, pour lire `max_rows`) a aussi renvoyé le **secret JWT de la prod**, qui s'est affiché dans la sortie de cette session (locale). Je ne l'ai ni réutilisé ni recopié. Une rotation est prudente si les transcriptions de session sont conservées.

---

## 8. Deuxième lot (2026-09-30) — « corrige tout »

### Ce qui change à l'écran

| Avant | Maintenant |
|---|---|
| Un sélecteur de période **par carte** (10, liés sans le dire — B-2), aucun filtre, aucune comparaison, aucun export | **Une barre** en tête : période (dont **personnalisée**), **Comparer à la période précédente**, filtres **Équipe / Technicien / Vendeur / Service / Client**, **Exporter (CSV)**. Tout est dans l'URL : un lien partagé rouvre la même vue. |
| Une carte ignorait le filtre sans le dire | « Filtre non appliqué ici : … » sur la carte concernée (ex. l'entonnoir n'a pas d'équipe). |
| Variation impossible à lire (∞ sur un mois à 0 $) | Pastille ↑↓ : %, points (taux) ou jours (délais) ; « nouveau » quand la période précédente est à 0 — jamais ∞. |
| Cliquer « À recevoir » ouvrait toutes les factures (B-3) | **« Voir le détail »** sur chaque chiffre : les lignes exactes (paiements, factures, jobs, soumissions, leads, deals), **leur somme = le chiffre** (vérifié par les tests), chaque ligne mène à sa fiche. |
| « Revenu » partout, sans dire lequel | Chaque carte dit ce qu'elle mesure : encaissé **taxes incluses** net des remboursements, lignes de jobs **avant taxes**, etc. |
| Revenu par service = titre des jobs créés | Lignes des **jobs complétés**, rattachées au **service du catalogue** (nom normalisé) ; « (jobs sans lignes) » visible au lieu d'être perdu. |
| Entonnoir mêlant leads et soumissions (% > 100 possible) | **Cohorte** : leads créés dans la période → ceux qui ont eu une soumission → ceux devenus un job ; % toujours sur les leads créés, + délai moyen de conversion. |
| Top clients par valeur des jobs, à vie | Par argent **encaissé dans la période** (même définition que la courbe Revenu). |
| Équipes : deux cartes qui se recoupaient | Une seule : revenu des jobs complétés, jobs complétés / créés, taux. |
| Contrôles imbriqués dans des cartes-boutons (B-1) | Plus de carte cliquable : titre, définition et bouton « Voir le détail » séparés ; le graphique se parcourt au clavier (flèches, Entrée = détail du mois). |
| « Aucun compte connecté » sur panne de l'API (B-4) | « lecture impossible — réessaie plus tard ». |

Lumi suit les mêmes fonctions : `get_top_services` = `rpc_insights_service_mix`, `get_top_clients` sur une période = `rpc_insights_top_clients` (parité testée).

### Base de données (migrations C et D)

- **C** `20261004300200_statistiques_filtres.sql` : paramètre `p_filtres` sur les agrégats de la page ; nouvelles fonctions `rpc_insights_top_clients`, `rpc_insights_entonnoir`, `rpc_insights_soumissions`, `rpc_insights_detail` (les lignes derrière chaque chiffre). Même garde de permission que le lot A.
- **D** `20261004300300_membres_remuneration_privee.sql` (E-9) : `authenticated`/`anon` ne lisent plus `hourly_rate_cents`, `labour_cost_hourly` ni `birth_date` sur `team_members` et `memberships` (grants **par colonne**). `membres_remuneration(p_org)` rend sa propre fiche, ou toute l'équipe à qui a `team.update`, `financial.view_margins` ou `financial.view_reports` (date de naissance d'un autre : `team.update`). Écrans adaptés : Gestion d'équipe (la cellule Taux/h n'existe que pour qui gère l'équipe), fiche membre (le taux n'est jamais réécrit par qui ne l'a pas lu), Commissions, Profil ; serveur : rentabilité (client service, permission déjà vérifiée), outil Lumi `set_hourly_rate`. La paie passait déjà par le client service. La vue `v_org_members` (lue par aucun code) projetait ces colonnes : elles y valent désormais NULL, sinon toute lecture de la vue échouait.
  **Règle durable** : une colonne ajoutée à ces deux tables doit recevoir `grant select (col) … to anon, authenticated` ; `check:db-coherence` le signale.

### Tests

Exactitude (oracle SQL, filtres compris) 171/171 · sécurité 104/104 (E-9 inversé : le test passe) · parité Lumi 17/17 · rendu 8/8 · E2E : filtres, période personnalisée par l'URL, comparaison, détail = chiffre, clavier, export CSV, états, cache, 3 largeurs.

### Performance (T4 : 50 000 jobs)

Mesuré après ce lot, 14 appels de la page (dont un filtre technicien + service) :

| | p50 | p95 |
|---|---|---|
| Chargement complet (appels en parallèle, 12 mois) | 291 ms | 791 ms |
| Passage à « 3 dernières années » | 1,26 s | 2,74 s |
| Revenu filtré technicien + service, 3 ans | ≈ 0,7 s | — |

Deux défauts trouvés par cette mesure, et corrigés dans la migration C avant toute application en prod :
- **Filtres évalués ligne par ligne** : pour chaque paiement, le filtre technicien / service rejouait ses sous-requêtes (pointages, visites, équipes, noms de lignes sans accents). Sur 3 ans avec technicien + service : **plus de 20 s**, donc délai dépassé. Désormais, l'ensemble des jobs retenus est calculé **une fois** (`stats_jobs_filtres`) et chaque carte teste l'appartenance : **0,7 s**. Au passage, revenu par service 98 → 15 ms, équipes 242 → 17 ms, valeur vie 630 → 102 ms (p50).
- **Encaissé sans filtre** : les jointures aux jobs étaient faites même sans filtre. Il y a maintenant un chemin direct (revenu 3 ans 1,4 → 0,6–0,9 s, modes de paiement 1,1 → 0,3–0,5 s). Une version « inlinable » a été essayée : plus rapide sans filtre, mais délai dépassé avec un filtre technicien, donc écartée.

M-15 (inchangé) : la carte Rentabilité, à 50 000 jobs, sature encore le pool de connexions (`toutLire` pagine par OFFSET) ; aucun effet aux volumes actuels.

### Encore ouvert

- M-11 : suppression de `rpc_insights_budget_vs_actual` (fonction morte).
- Perf RLS (§5.1).
- Hors page : la politique d'UPDATE de `memberships` laisse un membre modifier SA propre ligne, y compris `memberships.hourly_rate_cents` (colonne que la paie ne lit pas — elle lit `team_members` — mais que la copie vers un nouveau bureau reprend, `office-access.ts`). À verrouiller avec l'équipe multi-bureaux.

