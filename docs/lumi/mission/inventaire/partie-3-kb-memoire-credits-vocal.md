# Partie 3 — Connaissances, mémoire, crédits, vocal, support

Inventaire en lecture seule. Rien n'a été exécuté : ni serveur, ni test, ni script, ni requête à la base.
Chaque fait renvoie au code (`chemin:ligne`) ou à une migration. « Non trouvé » = cherché, absent.

**État du dépôt lu.** `C:\Users\Rafba\lume-lumi-mission`, branche `mission/lumi-fiabilite`, HEAD `39f6ffc2` (= `origin/main` local).
Un `git fetch --dry-run` indique que le `main` distant est rendu à `54c2309e` : ce checkout a donc au moins un commit de retard. Rien n'a été rapatrié.
L'état de la **production** vient de `supabase/SCHEMA_SNAPSHOT.md` (« Généré le 2026-09-30 … depuis la production », ligne 14). L'état de staging n'est pas vérifiable ici.

---

## 1. Base de connaissances

### 1.1 Les sources

| Source | Où elle vit | Portée | Comment elle change |
|---|---|---|---|
| FAQ du support (`ARTICLES`) | Code : `src/components/supportArticles.ts:22` | Globale (même pour toutes les entreprises) | Déploiement seulement |
| Pages Fonctionnalités (`FONCTIONS`) | Code : `src/pages/marketing/fonctionsData.ts`, indexé par `server/lib/agent/tools-aide.ts:152-159` | Globale | Déploiement |
| Carte de l'app (`CARTE_APP`) | Code : `server/lib/support/carte-app.ts:44`, indexée par `tools-aide.ts:93-120` | Globale | Déploiement |
| « Savoir » de l'équipe (📌 Slack) | Table `support_savoir` (`supabase/migrations/20260917120000_support_savoir_avis.sql`) | **Globale : la table n'a pas de colonne `org_id`** | Slack, sans déploiement |
| Réponses mémorisées (cache sémantique) | Redis Upstash ou mémoire du processus (`server/lib/lumi/magasin.ts:75-84`) | Par entreprise **et** globale par langue | Automatique (voir 1.5) |

Le canal Slack **#lumi-training** : **non trouvé dans le code**. Seule mention : `docs/audits/2026-09-15-cost-tokens.md:7` (canal de livraison d'un audit). L'apprentissage passe par les fils de tickets, pas par un canal dédié.

### 1.2 Alimentation par Slack (épingle 📌)

| Geste | Effet | Renvoi |
|---|---|---|
| Message de fil qui commence par `📌`, `:pushpin:` ou « Lumi, retiens : … » | Retenu, **pas** relayé au client. Minimum 10 caractères. | `server/lib/support/savoir.ts:44-51`, `server/lib/support/relais-slack.ts:108-115` |
| Réaction 📌 sur une réponse humaine du fil | Retenue aussi (relevé périodique, toutes les 45 s) | `relais-slack.ts:161-168`, cadence `relais-slack.ts:192-196` |
| Ce qui est stocké | `question` = premier message du client du ticket (300 car. max), `reponse` (4 000 max), `auteur` (nom Slack), ticket source, canal + `ts` | `savoir.ts:54-57`, `savoir.ts:80-85` |
| Accusé | Réaction 🧠 sur le message ; ❌ + une ligne si échec | `savoir.ts:103-114` |
| Anti-doublon | Index unique `(slack_channel_id, slack_ts)` + ensemble en mémoire | migration `20260917120000…sql:25`, `savoir.ts:36,59-61` |
| Qui peut enseigner | Toute personne qui écrit dans le fil. Un bot tiers listé dans `SLACK_BOTS_RELAYES` passe aussi par ce chemin. | `relais-slack.ts:72-86`, `relais-slack.ts:105-115` |
| Relecture ou approbation avant diffusion | **Non trouvé** | — |
| Retirer une réponse apprise | **Non trouvé.** La colonne `deleted_at` existe, aucun code ne l'écrit. | `savoir.ts:68` (lecture seule du filtre) |

### 1.3 Recherche (`search_help` → `chercherAide`)

Recherche par **mots-clés**, sans plongement. Index construit en mémoire au premier appel (`tools-aide.ts:147-163`).

| Élément | Valeur | Renvoi |
|---|---|---|
| Normalisation | minuscules, sans accents, mots > 2 lettres, mots vides retirés, radical grossier (pluriel, `-ation`, `-e`) | `tools-aide.ts:36-54` |
| Synonymes | ajoutés à la **question** seulement (« effacer » → « supprimer », « soumission » → « devis »…) | `tools-aide.ts:62-84` |
| Score | mots communs × poids du passage ; un mot présent dans le titre compte double | `tools-aide.ts:169-174` |
| Poids | titre de page 3, carte de l'app 3, savoir de l'équipe 3, points et FAQ 2, étapes 1 | `tools-aide.ts:106,117,125,143,155-158` |
| Résultat | 3 passages au plus, 2 par page au plus | `tools-aide.ts:175-185` |
| Titre d'un passage « savoir » | « Réponse de l'équipe Lume — » + 90 premiers caractères de la **question du client d'origine** | `tools-aide.ts:138-145` |

### 1.4 Réponses servies sans appel au modèle

Ces étages servent le chat de support **et** le premier message d'une conversation Lumi (`server/routes/lumi.ts:581-610`).

| Étage | Condition | Seuils | Renvoi |
|---|---|---|---|
| 0 — FAQ exacte | Énoncé normalisé identique à une question de `ARTICLES` | égalité stricte | `server/lib/support/faq.ts:160-163` |
| 0 — FAQ par mots-clés | Question courte, sur le produit | score ≥ 2, écart ≥ 1 avec le 2e, ≤ 14 mots, refus si la question vise les données du compte | `faq.ts:44-48`, `faq.ts:68-129`, `faq.ts:165-183` |
| 0 — Plusieurs questions collées | 2 à 6 lignes, toutes couvertes (tout ou rien) | — | `server/lib/support/aide-multi.ts:32-34,55-81` |
| 4 — Cache sémantique | Premier message seulement | cosinus ≥ 0,92 **et** ≥ 75 % des mots porteurs communs | `server/lib/lumi/cache-semantique.ts:33,102-124` |
| 5 — Aide directe | Premier message, forme « comment… », ≤ 16 mots | score ≥ 6 et 1er ≥ 1,6 × 2e ; ou Q/R dont le titre recouvre ≥ 50 % des mots | `server/lib/support/articles-dabord.ts:38-42,77-139` |

Plongements : Gemini `gemini-embedding-001`, 256 dimensions (`cache-semantique.ts:34,38,66-82`). Le texte de la question (2 000 car. max) part chez Google. Coût non journalisé (`cache-semantique.ts:7-9`).

### 1.5 Ce qui entre dans le contexte du modèle, et quand

| Assistant | Injecté d'office | Sur appel d'outil |
|---|---|---|
| Support (app, portail) | Bloc stable en cache 1 h : règles, **index** de la carte de l'app, **titres** des questions de la FAQ (`server/lib/support/ia.ts:99-135,208`). Bloc variable : nom, entreprise, forfait, page courante, **dossier du compte** (`ia.ts:138-146`). | `search_help` : 3 passages (`ia.ts:281-283`) |
| Support (site public) | Le prompt de vente complet, prix compris (`ia.ts:100-107`, `server/lib/agent/promptVente.ts:9-48`) | `search_help` |
| Lumi (app) | Rien de la base de connaissances. Les notes de mémoire, elles, sont injectées (voir 2). | `search_help`, outil **différé** (absent de `OUTILS_DE_BASE`, `server/lib/lumi/orchestrateur.ts:169-180`) ; présent pour les sous-agents (`server/lib/lumi/sous-agents.ts:22`) |

Le prompt du support dit que les passages « Réponse de l'équipe Lume — … » sont « la vérité la plus à jour » et qu'il faut les utiliser d'abord, sans nommer l'autre client (`ia.ts:118`).

### 1.6 Invalidation et mise à jour

| Objet | Durée / déclencheur | Renvoi |
|---|---|---|
| Index du savoir | Rechargé au démarrage, toutes les 10 min, et après chaque apprentissage. 500 entrées les plus récentes. | `savoir.ts:31-32,64-78,116-121`, `server/index.ts:1525-1528` |
| Cache sémantique du support, global (fr, en) | 24 h ; **vidé à chaque apprentissage** | `cache-semantique.ts:36`, `savoir.ts:93` |
| Cache sémantique du support, par entreprise | 10 min + version de l'entreprise (incrémentée à chaque écriture de Lumi) | `cache-semantique.ts:35`, `server/lib/support/garde-fous.ts:24`, `server/routes/support.ts:135-137` |
| Cache d'aide global de Lumi (`lumi:sem:global:aide`) | 24 h ; **pas vidé** à l'apprentissage | `server/routes/lumi.ts:496-500,699`, `savoir.ts:93` |
| Cache exact de Lumi | 60 s, par entreprise et par personne | `server/lib/lumi/cache-reponses.ts:29,39-43` |
| 👎 du client | Retire l'entrée (entreprise + globale) | `server/routes/support.ts:294-300` |
| « Non », « pas ça », bouton Réessayer dans Lumi | Retire l'entrée des deux caches | `server/routes/lumi.ts:677-682` |
| FAQ, pages, carte | Code : un déploiement | — |

Tests existants repérés : `tests/support/savoir.test.ts`, `tests/support/faq-mots-cles.test.ts`, `tests/lumi-caches.test.ts`, `tests/lumi-aide-support.test.ts`.

---

## 2. Mémoire de Lumi

### 2.1 Deux familles d'outils à ne pas confondre

| Outils | Table | Nature |
|---|---|---|
| `remember_this`, `forget_note`, `recall_notes` | `org_knowledge`, catégorie `assistant` | La mémoire de Lumi (`server/lib/agent/tools-etendus.ts:2342-2427`) |
| `list_notes`, `update_note`, `delete_note` | `specific_notes` | L'onglet Notes d'un client, d'un job ou d'un devis. **Pas** la mémoire. (`server/lib/agent/tools-leads.ts:753-859`) |

`delete_note` est une suppression **définitive** (`tools-leads.ts:847-857`), contraire à la règle « jamais de suppression dure » du projet.

### 2.2 Faits sur la mémoire (`org_knowledge`)

| Question | Réponse | Renvoi |
|---|---|---|
| Colonnes | `id, org_id, category, key, value, importance, is_active, created_at, updated_at`. **Pas de `user_id`.** | `supabase/migrations/20260325100001_org_knowledge.sql:4-15` |
| Portée | **Par bureau** (`org_id` = bureau actif de la session). Ni par utilisateur, ni partagée entre les bureaux d'un groupe. | `tools-etendus.ts:2372,2400,2422` |
| Unicité | `(org_id, category, key)`. Une même clé **écrase** la note, quel qu'en soit l'auteur. | migration ci-dessus `:14`, `tools-etendus.ts:2378` |
| Clé | minuscules, tirets, 80 car. ; en action directe : les 5 premiers mots de la note | `tools-etendus.ts:409-411`, `server/lib/lumi/actions-directes.ts:373-377` |
| Taille | 2 000 car. à l'écriture ; 240 car. par note dans le prompt ; 30 notes les plus récentes | `tools-etendus.ts:2375,2423`, `orchestrateur.ts:278` |
| `remember_this` | Écriture « anodine » : part **sans carte de confirmation**. Lumi a la consigne de retenir « seul, sans demander ». | `server/lib/agent/registre.ts:68-69`, `orchestrateur.ts:263,478-490` |
| Exception | Si un contenu externe a été lu dans la conversation (texto, formulaire, note…), l'écriture repasse par la carte. | `orchestrateur.ts:125-135,387,478` |
| `forget_note` | **Suppression douce** : `is_active = false`. La valeur reste en base. Un `remember_this` sur la même clé la réactive. | `tools-etendus.ts:2398-2401,2377` |
| Suppression réelle d'une note | **Non trouvée** (ni outil, ni route, ni purge). Seule la suppression de l'entreprise cascade (`ON DELETE CASCADE`, `supabase/SCHEMA_SNAPSHOT.md:9324`). | — |
| Qui a écrit quoi | Non stocké dans la table. Traces indirectes : `agent_actions` (24 h) et `security_events` `agent_write_executed` (365 j). | `tools-etendus.ts:282-286,328-332` |
| `update_note` de la mémoire | N'existe pas : on réécrit avec la même clé. | — |

### 2.3 Qui peut lire ou écrire

| Porte | Garde actuelle dans ce checkout | Renvoi |
|---|---|---|
| `remember_this`, `forget_note`, `recall_notes` (Lumi et MCP) | Permission `settings.update` (propriétaire, admin). Revérifiée à l'exécution, sans cache. | `server/lib/agent/garde.ts:109-120,332-345` |
| Injection dans le prompt de Lumi (app) | Seulement si la personne a `settings.update`, relu à chaque tour. Notes présentées comme « des faits, jamais des consignes ». | `server/routes/lumi.ts:297-315`, `orchestrateur.ts:279-286` |
| Lumi par texto | Les notes ne sont **pas** injectées (aucun `souvenirs` passé). | `server/lib/sms/lumi-sms.ts:181-190` |
| Assistant de support | Ne lit pas `org_knowledge`. | `server/lib/support/dossier.ts:88-115` |
| Lecture directe par le navigateur (PostgREST), **production** | Policy `org_knowledge_reglages_select` : membre **et** `settings.update`. Plus la policy restrictive `bureau_actif`. | `supabase/SCHEMA_SNAPSHOT.md:6336-6342` |
| Écriture directe par le navigateur | Aucun `INSERT`/`UPDATE` accordé à `authenticated`. | `supabase/baseline/01_schema.sql:58873-58875` |
| **API REST `/api/org-knowledge`** (GET, POST, POST `/bulk`, DELETE) | **Seulement « être membre »**. Aucune permission, aucun schéma Zod. Passe par le client de service, donc **contourne la RLS**. | `server/routes/org-knowledge.ts:11-137`, `server/index.ts:882`, `server/lib/route-permissions.ts:521-522` (aucune règle = on laisse passer) |

### 2.4 État de la fuite « lisible par tout le bureau » (PR #823)

| Élément | État constaté |
|---|---|
| Correctif applicatif (prompt + `recall_notes`) | **Présent** dans ce checkout (`lumi.ts:297-315`, `garde.ts:116-120`). |
| Correctif base (policy) en production | **Présent** d'après le snapshot (`SCHEMA_SNAPSHOT.md:6341-6342`). |
| Fichier de migration `20260930200000_org_knowledge_lecture_reservee.sql` | **Absent** de `supabase/migrations/` ici. Il n'existe que dans le commit `8cd3ebac`, sur la branche `origin/fix/org-knowledge-lecture-reservee`, qui n'est **pas** un ancêtre de HEAD. |
| Baseline (`supabase/baseline/01_schema.sql:49712-49715`) | Porte encore l'**ancienne** policy `org_knowledge_org_member_select` (être membre suffit). Un nouvel environnement monté depuis la baseline rouvre la fuite. |
| Staging | Non vérifiable ici. |
| Route `/api/org-knowledge` | **Toujours ouverte** à tout membre (voir 2.3). La même donnée sort par cette porte. |

Tests existants repérés : `tests/lumi-rbac-couverture.test.ts` (vérifie la présence de la garde dans le code, ligne 87).

---

## 3. Crédits

### 3.1 Du coût réel aux crédits

| Étape | Règle | Renvoi |
|---|---|---|
| Coût d'un appel | tokens × tarif du modèle, en cents US avec 4 décimales. Modèle inconnu = tarif Opus (jamais 0). | `server/lib/lumi/tarifs.ts:18-43,86-99` |
| Taux | **1 crédit = 3 ¢ US** de coût réel. Table `lumi_credit_taux`, version `2026-10`. | `server/lib/lumi/credits.ts:20`, `supabase/migrations/20261005200000_lumi_credits.sql:36-48` |
| Stockage | `ai_usage.credits_micro` = `round(cost_cents × 1 000 000 / taux)`, calculé par un trigger à l'insertion | même migration `:64-76` |
| Affichage | crédits entiers, **arrondis vers le bas** | `credits.ts:29-31,57-75` |
| Allocation | `plans.lumi_credits_mensuels` : Autopilot 1 000, autres 0 | migration `:26-33` |
| Plafond interne | crédits × 3 ¢ = 3 000 ¢ (30 $ US) pour Autopilot | `credits.ts:34-36`, `server/lib/lumi/budget.ts:169-170` |
| Idempotence | index unique `(org_id, request_id)` : un même appel fournisseur n'est débité qu'une fois | migration `:55-57`, `budget.ts:305-307` |
| Grand livre | `ai_usage` en **ajout seul** : `UPDATE` et `DELETE` directs refusés par trigger | migration `:78-92` |

### 3.2 Réservation avant l'appel, règlement après

1. Estimation pessimiste : caractères ÷ 3,5 + 3 000 tokens d'outils, au tarif d'entrée plein, + sortie au plafond `max_tokens` (`budget.ts:120-123`, appel `orchestrateur.ts:407-409`).
2. `reserve_ai_budget` prend un **verrou consultatif par groupe d'entreprises** (`pg_advisory_xact_lock`), additionne dépense + réservations ouvertes + demande, refuse (`capped`) si le plafond serait dépassé, sinon inscrit la réservation (`supabase/migrations/20261005500000_lumi_credits_rendus.sql:82-158`).
3. `capped` → rien ne part au modèle ; le tour rend `plafond: true` (`orchestrateur.ts:410-412`).
4. Après l'appel : journal dans `ai_usage`, puis `settle_ai_budget` au coût réel (`orchestrateur.ts:441-442`, `supabase/migrations/20260916120000_lumi_budget_reservations.sql:180-199`).
5. Réservation orpheline (serveur tombé) : expirée après 5 min par la tâche `lumi_expire_reservations`, active en production (`…lumi_budget_reservations.sql:202-241`, `SCHEMA_SNAPSHOT.md:10462-10477`).

**Deux sessions simultanées** : le verrou par groupe et le décompte des réservations ouvertes empêchent de dépasser. Les bureaux d'un même groupe partagent le même pot (`lumi_groupe_orgs`). Test existant : `tests/lumi-budget-reservation.test.ts`.

Repli : si la RPC est absente, le code continue **sans plafond** après un avertissement (`budget.ts:134-141`). « Construire avec Lumi » fait l'inverse et refuse (`server/lib/lumi/generer-parcours.ts:526-539`).

### 3.3 Paliers

Calculés sur (dépense + réservations ouvertes) ÷ plafond (`budget.ts:55-61,207-210`).

| Palier | Seuil | Modèle | Effort | Historique | Étapes d'outils | Renvoi |
|---|---|---|---|---|---|---|
| normal | < 70 % | `LUMI_MODEL`, défaut `claude-sonnet-5` | `low` par défaut | 60 messages | 8 | `budget.ts:77`, `tarifs.ts:51` |
| économe | ≥ 70 % | `claude-haiku-4-5` | `low` | 6 messages | 8 | `budget.ts:78` |
| restreint | ≥ 90 % | `claude-haiku-4-5` | `low` | 6 messages | 2 | `budget.ts:79` |
| épuisé | ≥ 100 % | aucun appel | — | — | 0 | `budget.ts:80` |

Garde-fou journalier par entreprise : si ≥ 15 % du plafond mensuel est dépensé depuis minuit, palier **restreint** jusqu'au lendemain (`budget.ts:194-210`, `server/lib/lumi/regles-cout.ts:51`). Pour Autopilot : 150 crédits dans la journée.

Autres crans, tous en code : 6 ¢ par tour (au-delà, le modèle conclut sans outils ; coupé au double), 40 ¢ par conversation, 60 tours par personne et par heure (`regles-cout.ts:49-50`, `orchestrateur.ts:399-404`, `lumi.ts:722-739`, `lumi.ts:517-520`).

### 3.4 Blocage à zéro : messages exacts

| Où | Texte | Renvoi |
|---|---|---|
| Réponse de Lumi (gabarit serveur) | « Tes crédits Lumi sont épuisés jusqu'au {date}. Les actions rapides et le reste de Lume marchent toujours. » | `budget.ts:106-113` |
| Bandeau de la page Lumi | « Tes crédits Lumi sont épuisés jusqu'au {date}. Les actions rapides et tout le reste de Lume fonctionnent toujours. » | `src/i18n/fr.ts:3948`, `src/components/lumi/CreditsLumi.tsx:70-91` |
| Champ de saisie (désactivé) | « Crédits Lumi épuisés jusqu'au {date}. » | `src/i18n/fr.ts:3949`, `src/pages/Lumi.tsx:586-590,836-841` |
| Avis à 80 % | « Il te reste {n} crédits Lumi jusqu'au {date}. » | `src/i18n/fr.ts:3947` |
| Courriel au propriétaire (100 %) | Sujet « Tes crédits Lumi sont épuisés » | `server/lib/lumi/avis-credits.ts:29-37` |
| Lumi par texto | même gabarit serveur | `server/lib/sms/lumi-sms.ts:167-169,226` |
| Forfait sans Lumi | « Lumi est inclus dans le forfait Autopilot. » | `src/pages/Lumi.tsx:815-816` |

À l'épuisement, les étages sans modèle (raccourcis, caches, actions) restent servis (`lumi.ts:278-280`).
Courriel + notification au propriétaire à 80 % et 100 %, une fois par seuil, par période et par groupe (clé primaire de `lumi_credits_avis`) : `avis-credits.ts:63-120`, `supabase/migrations/20261005200200_lumi_credits_avis.sql`.

### 3.5 Période, crédits rendus, exclusions

| Sujet | Règle | Renvoi |
|---|---|---|
| Période | Mensuelle, au **jour anniversaire** de `subscriptions.current_period_start`, dans le fuseau du bureau. Repli : mois civil de Montréal. Pas de report. | `…lumi_credits.sql:104-150` |
| Crédits rendus | Table `lumi_credits_ajustements` (org, micro-crédits, motif, auteur en texte libre). Soustraits de la période **en cours** seulement, jamais sous zéro. `ai_usage` n'est pas touché. | `supabase/migrations/20261005500000_lumi_credits_rendus.sql:23-78` |
| Comment rendre des crédits | **Non trouvé** : aucune route, aucun outil, aucun script n'écrit dans cette table. Insertion à la main. | recherche `lumi_credits_ajustements` dans `server/`, `scripts/`, `src/` |
| Exclu des crédits | Source `support` (`coalesce(source,'lumi') <> 'support'`) | `…lumi_credits_rendus.sql:59,77,122` |
| Compté | Chat Lumi, routeur Haiku, Lumi par texto, « Construire avec Lumi » (source `automatisations`) | `lumi.ts:454-464,757-764`, `lumi-sms.ts:213-219`, `generer-parcours.ts:554-568` |
| Jamais journalisé (donc gratuit pour le client) | Plongements Gemini, notes vocales reçues par texto, maintien du cache (plateforme), chat public, support depuis le portail de migration (pas d'`orgId` passé) | `cache-semantique.ts:66-82`, `server/lib/sms/note-vocale.ts:120`, `server/lib/lumi/cache-chaud.ts:165-168`, `server/lib/support/portail.ts:58-60` |
| Dictée (source `voix`) | Voulue comptée, mais **rejetée par la base en production** : voir Surprises n° 4. | `server/routes/agent.ts:56-65`, `SCHEMA_SNAPSHOT.md:8035` |

### 3.6 Plafond journalier d'exploitation (à ne pas confondre avec les crédits)

Borne en dollars **par source, pour toute l'instance**, toutes entreprises confondues. Défaut : 5 $ par jour et par source. Compteur en mémoire, par processus, remis à zéro au redémarrage (`server/lib/lumi/plafond-journalier.ts:18-37,72,83-96,128-144`). Sources : `lumi`, `support`, `migration`, `public`, `cache-chaud`, `eval`, `voix`. Réglage : `LUMI_PLAFOND_JOUR_USD` ou `LUMI_PLAFOND_JOUR_<SOURCE>_USD`. Valeur réglée en production : non vérifiable ici.

### 3.7 Où un montant en dollars d'IA peut-il se voir ?

| Endroit | Constat | Renvoi |
|---|---|---|
| Écrans de l'app (page Lumi, Facturation) | Crédits seulement. Aucun montant trouvé. | `src/components/lumi/CreditsLumi.tsx`, `src/lib/lumiCreditsFormat.ts`, `src/pages/settings/BillingSettings.tsx:295` |
| Réponses de l'API Lumi | `credits` seulement. L'événement `usage` envoie le **modèle et les tokens** à tous les navigateurs (affichés seulement aux comptes `@lume-test.ca`). | `orchestrateur.ts:443-444`, `lumi.ts:1273-1279`, `src/pages/Lumi.tsx:258` |
| `GET /api/lumi/quota` | Ajoute modèle et plafonds journaliers **de toute la plateforme** pour un courriel finissant par `@lume-test.ca`. | `lumi.ts:1104-1109` |
| Lumi lui-même | Consigne « jamais en dollars » + outil `get_lumi_credits` qui ne rend que des crédits. | `server/lib/agent/consignesCollegue.ts:24`, `server/lib/agent/tools-reglages.ts:1480-1502` |
| Courriels au client | Crédits seulement. | `avis-credits.ts:27-61` |
| Courriel d'alerte interne | **En dollars**, envoyé à `LUMI_ALERT_EMAIL` ou `SECURITY_ALERT_EMAIL`. Interne tant que ces adresses le sont. | `budget.ts:237-260`, `lumi.ts:282-287` |
| Site public | « 1 000 crédits Lumi / mois », jamais d'équivalence. | `src/pages/marketing/Pricing.tsx:134-135`, `promptVente.ts:33` |
| **Table `lumi_traces`** | `cost_cents` et `params.depense_cents` **lisibles par tout membre actif** de l'entreprise via PostgREST. | policy `SCHEMA_SNAPSHOT.md:6081-6086`, `supabase/migrations/20260913000000_lumi_traces.sql:91-108`, `lumi.ts:734` |
| **Table `security_events`** | `details` de l'événement `lumi_budget_econome` porte `depense_cents` et `budget_cents` ; lisible par propriétaire et admin. | `budget.ts:245-248`, `SCHEMA_SNAPSHOT.md:7013-7023` |
| **Table `plans`** | Lisible par tout utilisateur connecté (`USING true`). Porte encore `ai_monthly_budget_cents` à côté de `lumi_credits_mensuels`. L'API, elle, retire la colonne. | `SCHEMA_SNAPSHOT.md:6606` (policy `plans_authenticated_read`), colonnes `SCHEMA_SNAPSHOT.md:3326,3330`, `server/routes/billing.ts:20` |
| `ai_usage`, `ai_usage_monthly` | Lecture retirée à `authenticated` en production. | `…lumi_credits.sql:98-101`, `SCHEMA_SNAPSHOT.md:4600-4612` |
| Message « Construire avec Lumi » | Parle de « budget Lumi du mois », pas de crédits. Pas de montant. | `generer-parcours.ts:518-524` |

Tests existants repérés : `tests/lumi-credits-serveur.test.ts`, `lumi-credits-statique.test.ts`, `lumi-credits-rendus.test.ts`, `lumi-credits-avis.test.ts`, `lumi-credits-page.test.tsx`, `lumi-plafond-journalier.test.ts`, `lumi-regles-cout.test.ts`.

---

## 4. Vocal

### 4.1 Transcription (parole → texte)

| Sujet | Fait | Renvoi |
|---|---|---|
| Fournisseur et modèle | Google Gemini, `gemini-2.5-pro` (surcharge : `GEMINI_TRANSCRIBE_MODEL`). Température 0, sortie 2 048 tokens, réflexion 512. | `server/lib/agent/transcribe.ts:19,63-69` |
| Route | `POST /api/agent/transcribe`, audio en base64 | `server/routes/agent.ts:27-80` |
| Capture | Navigateur, WAV 16 kHz mono | `src/features/agent/hooks/useVoiceInput.ts:22-28,99-117` |
| Durée | 60 s max ; arrêt automatique après 2,5 s de silence | `useVoiceInput.ts:22,26,292-298` |
| Taille | base64 ≤ 5 600 000 caractères (≈ 4,2 Mo) ; analyseur dédié de 6 Mo | `server/lib/validation.ts:164-168`, `server/index.ts:388-390` |
| Formats acceptés | webm, mp4, ogg, wav, mpeg, aac | `transcribe.ts:24` |
| Accès | **Être connecté suffit.** Pas de vérification du forfait, ni de la permission `external_agent.use`, ni des crédits. Absent de `ROUTE_PERMISSIONS`. | `agent.ts:32-33`, `server/lib/route-permissions.ts:82-88` |
| Plafond | Source `voix` : 5 $ par jour **et** 300 appels par jour, pour toute l'instance. Au-delà : HTTP 429 `plafond_jour`. | `agent.ts:41-44`, `plafond-journalier.ts:57-69` |
| Coût | 1,25 $ / M tokens en entrée, 10 $ / M en sortie. Une dictée de 60 s ≈ 0,94 ¢ (≈ 0,3 crédit). | `tarifs.ts:40`, `agent.ts:70-72` |
| Facturation en crédits | Écrite avec la source `voix`… que la contrainte de la base refuse (Surprises n° 4). | `agent.ts:56-65` |
| Texte transcrit | Non stocké dans la trace. | `agent.ts:66-75` |
| Aperçu en direct | Reconnaissance vocale **du navigateur** (Chrome, Edge, Safari) pendant l'enregistrement. L'audio part alors chez l'éditeur du navigateur, hors de Lume. | `useVoiceInput.ts:13-16,119-123,159-191` |

### 4.2 Silence et transcription vide

| Cas | Comportement | Renvoi |
|---|---|---|
| Moins de 0,6 s, ou aucun son au-dessus du seuil | Rien n'est envoyé. Message : « Je n'ai rien entendu. Réessaie en parlant plus près du micro. » | `useVoiceInput.ts:213-218` |
| Le serveur rend un texte vide | Message : « Je n'ai rien compris. Réessaie en parlant un peu plus fort. » Rien n'entre dans la zone de saisie. | `useVoiceInput.ts:226-227` |
| Consigne au modèle | « Si l'audio est vide ou inaudible, renvoie une chaîne vide. » | `transcribe.ts:30` |
| Note vocale par texto, vide | Réponse : « Je n'ai rien entendu dans ton message. Réessaie ? » | `server/lib/sms/note-vocale.ts:125,151-154` |

### 4.3 Confirmation avant d'agir

| Canal | Règle | Renvoi |
|---|---|---|
| Micro dans l'app | Le texte final **remplit la zone de saisie**. Rien ne part sans que la personne envoie. | `src/pages/Lumi.tsx:542-548` |
| Envoi pendant l'écoute | L'aperçu du navigateur (moins juste) part tel quel ; la transcription serveur est jetée. | `Lumi.tsx:476-479`, `useVoiceInput.ts:223-225` |
| Écritures ensuite | Carte de confirmation, comme au clavier. Sauf `remember_this` / `forget_note`, sans carte. | `orchestrateur.ts:478-500`, `actions-directes.ts:373-377,717-724` |
| Note vocale par texto (membre de l'équipe) | La transcription va **directement** à Lumi, sans relecture. Les lectures s'exécutent. Une écriture attend un « OUI » par texto. `remember_this` part sans « OUI ». | `server/routes/messages.ts:362-381,550-565`, `lumi-sms.ts:244-255` |

### 4.4 Notes vocales par texto (Twilio)

Même transcripteur, langue forcée à `fr` (`messages.ts:364-368`). 5 Mo max ; `SECONDES_MAX = 300` est déclaré mais **non utilisé** (`note-vocale.ts:21,24`). AMR non pris en charge (`note-vocale.ts:60-64`). La transcription a lieu pour **tout** expéditeur, avant de savoir s'il est membre (`messages.ts:362-378`), sans plafond `voix` et sans journal de coût (`note-vocale.ts:120`).

### 4.5 Lecture à voix haute (texte → parole)

Aucun fournisseur : **synthèse vocale du navigateur** (`speechSynthesis`), gratuite, rien ne passe par le serveur (`src/features/agent/hooks/useSpeakReplies.ts:11-13,52-67`). Voix `fr-CA` ou `en-US`, vitesse 1,02. Lue seulement si la question a été dictée (`Lumi.tsx:439-443`). Réglage gardé dans `localStorage` (`useSpeakReplies.ts:9,38-47`). Non facturée.

Tests existants repérés : `tests/micro-envoi-annule-transcription.test.ts`.

---

## 5. Agent de support

### 5.1 Parcours d'une question (`POST /api/support/chat`)

| # | Étape | Renvoi |
|---|---|---|
| 1 | Écran : `SupportChat` envoie message, page courante, jusqu'à 3 captures | `src/components/SupportChat.tsx:43,187-206` |
| 2 | Limites : 5 requêtes / min par personne sur `/api/support`, plus 60 / h | `server/index.ts:933`, `server/routes/support.ts:44` |
| 3 | Session, validation (message ≤ 5 000 car.), captures vérifiées sous le dossier de l'entreprise | `support.ts:66-75`, `server/lib/validation.ts:288-299`, `server/lib/support/captures.ts:50-60` |
| 4 | Ticket créé ou rouvert ; message enregistré (`support_messages`) | `support.ts:81-89` |
| 5 | Ticket déjà chez un humain : message relayé dans Slack. Si un humain a écrit il y a moins de 30 min, Lumi se tait. | `support.ts:96-102`, `server/lib/support/tickets.ts:387-391` |
| 6 | Étage 0 : FAQ exacte, par mots-clés, ou plusieurs questions | `support.ts:115-123` |
| 7 | Étage 4 : cache sémantique, global par langue puis par entreprise (premier message) | `support.ts:133-138,145-149` |
| 8 | Plafond : 60 réponses du modèle par entreprise sur 24 h. Au-delà, texte fixe « mode économe ». | `support.ts:140,150-153`, `server/lib/support/garde-fous.ts:22,52-61,75-79` |
| 9 | Étage 5 : aide directe | `support.ts:144,154-160` |
| 10 | Étage 6 : modèle, avec le dossier du compte et les captures en image | `support.ts:161-185` |
| 11 | Mémorisation : si pas de transfert, pas d'outil autre que la doc, pas de page ni de capture | `support.ts:181-184` |
| 12 | Transfert : ticket escaladé vers Slack, sinon courriel | `support.ts:194-197`, `tickets.ts:301-352` |
| 13 | Erreur de l'assistant : transfert à un humain, motif « Assistant indisponible » | `support.ts:186-191` |

### 5.2 Modèle et paramètres

| Paramètre | Valeur | Renvoi |
|---|---|---|
| Modèle | `claude-sonnet-5` (surcharge : `LUMI_SUPPORT_MODELE`) | `server/lib/support/ia.ts:41` |
| Étapes d'outils | 4 max | `ia.ts:42` |
| Sortie | 1 024 tokens | `ia.ts:43` |
| Réflexion | adaptative, effort bas | `ia.ts:235` |
| Historique | 12 derniers messages | `ia.ts:204` |
| Cache du prompt | bloc stable, 1 h | `ia.ts:208` |
| Coût | à la charge de Lume ; journalisé `source: 'support'` quand l'entreprise est connue | `ia.ts:249-263` |
| Plafond journalier | source `support`, commune à l'app, au portail **et au chat public** | `ia.ts:223-227`, `server/routes/sales-chat.ts:103-106` |

### 5.3 Ce qu'il a le droit de faire

| Outil | Effet | Surface | Renvoi |
|---|---|---|---|
| `search_help` | Lecture de la documentation | toutes | `ia.ts:150-154` |
| `transfer_to_human` | Passe la main à l'équipe | app, portail | `ia.ts:157-161,277-280` |
| `get_migration_status` | Lecture de l'état de la migration | app, portail | `ia.ts:162-168` |
| `start_migration` | **Écriture** : crée une migration en mode autonome + un lien de portail. Refus si une migration est en cours. Aucune vérification du rôle du demandeur. | app | `ia.ts:169-175`, `server/lib/support/migration-outils.ts:37-71` |

Il **ne peut pas agir sur le CRM** (clients, jobs, factures, envois) : il n'a aucun des outils de Lumi. Il lit un « dossier » du compte : forfait, renouvellement, réglages, nombre de membres par rôle, volumes, nombre de factures dues, état des paiements, migration, 5 derniers tickets, 5 dernières actions de Lumi (`server/lib/support/dossier.ts:88-157`). Ce dossier est le même pour tous les rôles.

### 5.4 Garde-fous écrits dans le prompt

Jamais inventer une fonction, un prix, un bouton ; un « comment faire » ne part jamais seul à l'équipe ; transfert seulement pour : demande d'un humain, bogue, argent ou compte, demande d'agir à la place du client (`ia.ts:112-129`). Refus du modèle → transfert (`ia.ts:269`). Aucune réponse → transfert (`ia.ts:301-313`).

### 5.5 Escalade et Slack

| Sujet | Fait | Renvoi |
|---|---|---|
| Délais annoncés | Autopilot et Enterprise : 4 h ouvrables ; Scale (`pro`) : 1 jour ; autres : 2 jours | `tickets.ts:18-30` |
| Canal | Un canal **public** `#client-<entreprise>` par groupe d'entreprises ; repli : fil dans #support | `server/lib/support/canaux-slack.ts:34-43,66-96`, `server/lib/slack.ts:72-80`, `tickets.ts:306-346` |
| Ce qui part dans Slack | Entreprise, nom, **courriel**, forfait, identifiant d'org, conversation complète, fichier `.txt`, captures par lien signé 7 jours | `tickets.ts:193-212,223-251,319-341`, `captures.ts:24` |
| Retour vers le client | Webhook signé (HMAC v0, ± 5 min) + relevé toutes les 45 s ; message `agent` + notification + courriel | `server/routes/webhooks-slack.ts:43-78`, `relais-slack.ts:92-131`, `tickets.ts:394-437` |
| Notes internes | Non relayées si elles commencent par 🔒, `[interne]`, `//`, etc., ou ressemblent à un gabarit de relance | `relais-slack.ts:56-63,117-122` |
| Bots tiers | Relayés seulement si listés dans `SLACK_BOTS_RELAYES` | `relais-slack.ts:72-86` |
| Résumé quotidien | 7 h (Montréal), dans #support, avec extraits des messages des clients | `server/lib/support/resume-quotidien.ts:22,69-95,110-140` |
| Fermeture | Ticket `answered` ou `ai` sans activité depuis 3 jours → `closed` (le client peut rouvrir) | `tickets.ts:138-162` |
| Archivage du canal | 7 jours sans demande vivante | `canaux-slack.ts:108-143` |
| Sans Slack | Courriel à `SUPPORT_EMAIL` | `tickets.ts:280-294,347-351` |

### 5.6 Prix des forfaits écrits en dur

L'assistant de support **dans l'app** n'a aucun prix dans son prompt, sa FAQ ou sa carte (recherche de `150`, `340`, `347`, `495` dans `supportArticles.ts` et `carte-app.ts` : rien). Il ne connaît que le nom du forfait du client (`ia.ts:142`). Les prix sont connus du **chat public** seulement.

| Fichier | Minimum | Scale | Autopilot | Rabais annuel | Bureaux inclus | Porte-à-porte, API |
|---|---|---|---|---|---|---|
| Base (`supabase/migrations/20260922000000_tarifs_rabais_annuels.sql`) | 150 | **347** | 495 | 10 % / 15 % / 30 % | — | — |
| Page Tarifs (`src/pages/marketing/Pricing.tsx:70,95,121,71,96,122,204-213`) | 150 | 347 | 495 | 10 % / 15 % / 30 % | 1 / 1 / 2 | Autopilot seulement |
| Quotas du serveur (`server/lib/platformFeatures.ts:108-112`) | — | — | — | — | 1 / 1 / 2 | — |
| Prompt du chat public (`server/lib/agent/promptVente.ts:29-33`) | 150 | 347 | 495 | **−15 % partout** | **1 / 2 / 5** | **dès Scale** |
| Réponse fixe « prix » (`server/lib/agent/reponsesFixes.ts:28`) | 150 | 347 | 495 | **−15 %** | **1 / 2 / 5** | **porte-à-porte dans Scale** |
| FAQ de la page Tarifs (`Pricing.tsx:231-232`) | — | — | — | **15 %** | — | — |
| Ancienne page d'accueil (`src/i18n/fr.ts:1228,1240,1253`, lue par `src/pages/Landing.tsx:144`) | **127** | **297** | **797** | — | — | — |
| Commentaire (`server/lib/feature-guard.ts:16`) | « Starter (150 $) » | — | 495 | — | — | — |

Le chiffre **340** ne subsiste que dans l'ancienne migration `20260721000000_plan_intro_promo.sql:56-62` ; Scale est à 347 depuis le 2026-09-22.

### 5.7 Réponses sans appel au modèle

| Réponse | Coût | Renvoi |
|---|---|---|
| FAQ (exacte, mots-clés, multi-questions) | 0 | `support.ts:115-123` |
| Cache sémantique (entreprise : 10 min ; global par langue : 24 h) | un plongement Gemini | `support.ts:133-149`, `garde-fous.ts:24-25` |
| Aide directe | 0 | `support.ts:154-160` |
| Plafond de 60 par jour atteint | 0 | `garde-fous.ts:75-79` |
| Chat public : 3 réponses fixes (dont « prix ») et cache partagé ; plafond global de 300 réponses du modèle par 24 h | 0 | `reponsesFixes.ts:24-48`, `sales-chat.ts:68-100`, `regles-cout.ts:53` |

Une réponse entre dans le cache **global** seulement si elle vient de la doc et ne contient ni chiffre, ni « vous avez », ni le nom de la personne, de l'entreprise ou du forfait (`garde-fous.ts:40-49`).

Tests existants repérés : `tests/support/support-ia.test.ts`, `relais-slack.test.ts`, `slack-webhook.test.ts`, `canaux-slack.test.ts`, `transcript.test.ts`, `support-moins-cher.test.ts`.

---

## 6. Loi 25 — journaux et tables

Lecture de la colonne « Purge » : seule une règle trouvée dans le code ou les migrations compte. Toutes ces tables partent en cascade si l'entreprise est supprimée, sauf mention.

| Table / stockage | Renseignements personnels en clair ? | Qui peut lire côté client | Purge ou rétention trouvée |
|---|---|---|---|
| `lumi_messages` | **Oui.** Texte intégral, arguments et **résultats d'outils** (noms, téléphones, courriels, adresses, montants de clients). Les briefings du matin y écrivent aussi. | L'auteur seulement (`SCHEMA_SNAPSHOT.md:6070-6079`) | **Aucune.** L'utilisateur peut supprimer une conversation (suppression réelle, `lumi.ts:1285-1297`). L'allègement des vieux résultats est en mémoire seulement (`orchestrateur.ts:108-118`). |
| `lumi_conversations` | Oui : `title` = 80 premiers caractères du message. `user_id` sans clé étrangère vers l'utilisateur. | L'auteur | Aucune |
| `lumi_traces` | **Oui, partiel.** `enonce_normalise` (200 car., sans accents) peut porter des noms ; `params` porte numéros, cibles, verdict du routeur ; `user_id`. Visiteurs du site : `org_id` nul. | **Tout membre actif de l'entreprise**, y compris les questions des collègues | **Aucune** (« Pas de purge pour l'instant », `20260913000000_lumi_traces.sql:28-31`) |
| `ai_usage` | Non pour le contenu (compteurs). Identifiants : `user_id`, `conversation_id`. | Personne (production) | Aucune, et **impossible à purger** hors suppression de l'entreprise (ajout seul) |
| `ai_usage_monthly`, `ai_reservations` | Non | Personne | Aucune. Les réservations sont marquées réglées, jamais supprimées : une ligne par appel au modèle. |
| `org_knowledge` (mémoire) | **Oui possible** : texte libre (« Sophie paie toujours en retard », taux horaires). | `settings.update` (production) ; tout membre par `/api/org-knowledge` | Aucune. « Oublier » = désactivation. |
| `support_tickets` | **Oui** : nom, courriel, entreprise, sujet | Le demandeur | Aucune. Fermeture automatique à 3 jours = changement de statut. |
| `support_messages` | **Oui** : texte libre (10 000 car.), nom de l'auteur, chemins des captures | Le demandeur | Aucune |
| `support_savoir` | **Oui possible** : question d'un client (300 car.), nom Slack de l'auteur. **Sans `org_id`** : survit à la suppression de l'entreprise d'origine. | Personne | Aucune. `deleted_at` jamais écrit. |
| Bucket `support-captures` | **Oui possible** : captures d'écran du CRM | Liens signés (1 h client, 7 jours équipe) | **Aucune suppression trouvée** |
| `support_slack_channels` | Nom de l'entreprise dans le nom du canal | Personne | Archivage Slack à 7 jours ; pas de suppression |
| `webhook_receipts` | Non (identifiants Slack) | Personne | Fonction `purge_webhook_receipts(30)` définie, **jamais appelée** (`20260915140000_webhook_receipts.sql:7-8,24-33`) |
| `agent_actions` | Résultat d'écriture (identifiants, parfois des noms) | Tout membre actif | **24 h**, par `oauth_menage()` appelée toutes les 6 h par le serveur (`20260903090000_agent_ecritures.sql:92-93`, `server/index.ts:1483-1488`) |
| `security_events` (`agent_write_executed`, `lumi_budget_econome`) | 300 car. du résultat d'une écriture ; montants en cents | Propriétaire, admin | **365 jours** (`20260910160000_scale_retention_logs.sql:32,76`) |
| `notifications` (escalade, crédits, réponse du support) | 180 car. de la réponse humaine | Le destinataire | Lues depuis 90 jours (`…scale_retention_logs.sql:54-67`) |
| `lumi_credits_ajustements`, `lumi_credits_avis` | Non (auteur en texte libre) | Personne | Aucune |
| Caches Redis (`lumi:rep`, `lumi:sem`) | **Oui** pour les caches par entreprise : réponses avec données de clients | — | 60 s ; 10 min ; 24 h pour le global |

Compléments :

- **Demande d'accès ou d'effacement** : `server/routes/dsr.ts` ne touche que `clients`, `dsar_requests`, `memberships`. Les tables de Lumi et du support n'y figurent pas. Un client anonymisé reste lisible dans d'anciens `lumi_messages`.
- **Tâches planifiées en production** (`SCHEMA_SNAPSHOT.md:10462-10477`) : aucune ne vise `lumi_*`, `support_*`, `ai_usage`, `org_knowledge`.
- **Destinataires hors de Lume** vus dans le code : Anthropic (Lumi, support, routeur), Google Gemini (audio des dictées, plongements des premières questions), éditeur du navigateur (aperçu vocal), Slack (tickets, transcriptions, captures), Upstash (caches), Twilio (notes vocales). Mention d'information ou consentement propre à ces flux : **non trouvé** dans le périmètre lu.

---

## Surprises et risques

Classés du plus sérieux au moins sérieux. Tout vient de la lecture du code ; rien n'a été reproduit.

1. **La mémoire de Lumi reste lisible et modifiable par tout membre via l'API.** `GET /api/org-knowledge` rend toutes les notes du bureau avec le client de service ; `POST` et `POST /bulk` les écrivent ; `DELETE` les désactive. Seule vérification : être membre (`server/routes/org-knowledge.ts:11-137`, `server/lib/route-permissions.ts:521-522`). C'est la fuite de #823 par une autre porte. De plus, un technicien peut **écrire** une note de catégorie `assistant`, qui entre ensuite dans le prompt de Lumi du propriétaire (`lumi.ts:313`). Aucun écran n'utilise cette route (recherche dans `src/` : rien).

2. **Le correctif base de #823 est en production mais pas dans `main`.** Migration absente de ce checkout, présente seulement sur `origin/fix/org-knowledge-lecture-reservee` (commit `8cd3ebac`). La baseline garde l'ancienne policy (`supabase/baseline/01_schema.sql:49712-49715`). Dérive prod ↔ source : exactement le risque décrit dans `CLAUDE.md`. À revérifier sur le `main` distant, plus récent que ce checkout.

3. **Montants en dollars lisibles par les clients au niveau de la base.** `lumi_traces.cost_cents` et `params.depense_cents` sont ouverts à tout membre actif (`SCHEMA_SNAPSHOT.md:6081-6086`). La migration des crédits a fermé `ai_usage` et `ai_usage_monthly`, pas `lumi_traces`. La même policy laisse un technicien lire les questions normalisées du propriétaire. Aussi : `security_events.details` (propriétaire, admin) et `plans.ai_monthly_budget_cents` (tout utilisateur connecté).

4. **La dictée n'est probablement pas débitée.** Le code écrit `source: 'voix'` (`server/routes/agent.ts:63`). La contrainte en production n'accepte que `lumi, support, migration, briefing, routeur, cache, automatisations` (`SCHEMA_SNAPSHOT.md:8035`, dernière définition : `20260929230200_lumi_automatisations_offertes.sql:22-24`). L'insertion échoue donc, et `journaliserUsage` ne fait que l'écrire dans les journaux (`budget.ts:308-309`). Effet : dictée gratuite, absente du grand livre.

5. **Le plafond journalier de 5 $ est commun à tous les clients, et son message est faux.** Une fois la source `lumi` à 5 $ dans la journée, **tous** les clients reçoivent « Tes crédits Lumi sont épuisés jusqu'au … », alors que leurs crédits sont intacts (`lumi.ts:424-427,466-472`, `plafond-journalier.ts:72`). La trace dit `budget_epuise` (`lumi.ts:488`). Le compteur est par processus : plusieurs instances = plusieurs plafonds. La valeur réglée en production est inconnue ici.

6. **Le chat public partage le plafond du support.** `repondreSupportIA` compte toute surface sous `support` (`ia.ts:223,239`). Des visiteurs anonymes peuvent donc épuiser les 5 $ ; chaque client de l'app est alors transféré à un humain, motif « Plafond de dépense journalier atteint ». Une source `public` existe mais n'est pas utilisée ici.

7. **Le savoir de l'équipe est global et cite un client à un autre.** `support_savoir` n'a pas d'entreprise. Le titre du passage reprend 90 caractères de la question du client d'origine (`tools-aide.ts:141`). L'étage « aide directe » peut afficher ce titre **tel quel**, sans modèle, à une autre entreprise (`articles-dabord.ts:134-138`). Pas de relecture, pas de retrait possible, bots autorisés à enseigner.

8. **Le cache d'aide global de Lumi filtre peu.** Une réponse y entre si seul `search_help` a servi et si elle ne contient pas le nom de l'entreprise ou de la personne (`lumi.ts:496-500`). Or le prompt de ce tour contient les notes de mémoire du bureau. Une réponse qui cite un prix habituel ou un nom de client peut être servie 24 h à d'autres entreprises. Le support applique un filtre plus strict (`garde-fous.ts:40-49`).

9. **La transcription est ouverte à tout compte connecté.** `POST /api/agent/transcribe` ne vérifie ni forfait, ni permission, ni crédits (`agent.ts:32-44`). Seul frein : le plafond global `voix`, qu'un seul compte peut épuiser pour tous.

10. **Notes vocales par texto : appel payant pour n'importe quel expéditeur.** Transcription Gemini avant toute identification, sans plafond ni journal (`messages.ts:362-378`, `note-vocale.ts:120`). Pour un membre, la transcription pilote Lumi sans relecture, et `remember_this` s'exécute sans « OUI ».

11. **Le chat public annonce des faits qui contredisent la page Tarifs.** Rabais annuel de 15 % partout (réel : 10 / 15 / 30), 2 et 5 bureaux (réel : 1 et 2), porte-à-porte et API dès Scale (réel : Autopilot). Voir 5.6. L'ancienne page d'accueil affiche encore 127 / 297 / 797.

12. **« Oublier » ne supprime rien, et rien n'est purgé.** `forget_note` désactive (`tools-etendus.ts:2399`). Aucune rétention sur `lumi_messages`, `lumi_traces`, `support_*`, `org_knowledge`, captures. La purge de `webhook_receipts` existe mais n'est branchée nulle part.

13. **Passage silencieux à Haiku.** À 15 % du plafond dans la journée, ou à 70 % sur la période, le client passe à un modèle moindre sans aucun avis. Les codes d'écran `ralenti` et `quota_epuise` existent (`src/pages/Lumi.tsx:809-814`) mais **aucun code serveur ne les émet**. Le texte « il répond une fois par minute » (`src/i18n/fr.ts:3950`) ne correspond à aucun mécanisme trouvé.

14. **Crédits rendus : aucun outil.** La table existe, rien n'y écrit. Un remboursement passe par une insertion manuelle en production. Les trois calculs ne soustraient pas au même niveau (par bureau dans `lumi_depense_du_mois`, par groupe ailleurs) : palier affiché et plafond réel peuvent diverger légèrement dans un groupe (`…lumi_credits_rendus.sql:41-78,124`).

15. **Restes de l'ancien budget en dollars.** Le briefing du matin choisit encore ses entreprises sur `ai_monthly_budget_cents > 0` (`server/lib/lumi/briefing.ts:223-226`). Le courriel d'alerte interne dit « jusqu'au 1er » alors que la période est anniversaire (`budget.ts:256-257`). Le commentaire parle de 60 %, le seuil est 70 % (`budget.ts:232,52`).

16. **Réservation moins pessimiste qu'annoncé.** Outils comptés pour 3 000 tokens fixes et aucune majoration d'écriture en cache (`budget.ts:120-123`). Le dernier appel avant le plafond peut le dépasser un peu. Le statut `econome` / `restreint` rendu par la RPC est ignoré ; seul `capped` est lu (`orchestrateur.ts:410`).

17. **Slack reçoit des renseignements personnels dans des canaux publics.** Courriel, nom, conversation entière, captures (liens valides 7 jours), créés avec `is_private: false` (`server/lib/slack.ts:77`). Le résumé de 7 h recopie des extraits dans #support.

18. **Le support donne le même dossier à tous les rôles et peut démarrer une migration.** Un technicien obtient forfait, date de renouvellement, volumes, nombre de factures dues (`dossier.ts:88-157`). `start_migration` ne vérifie pas le rôle (`migration-outils.ts:37-48`). Une réponse fondée sur le dossier seul est mise en cache pour toute l'entreprise 10 min (`support.ts:181-182`, `garde-fous.ts:28-30` : une liste d'outils vide passe le test).

19. **Détails.** La trace du support écrit le modèle en dur `claude-sonnet-5` même si `LUMI_SUPPORT_MODELE` est réglé (`support.ts:185`). L'en-tête de `sales-chat.ts:5` dit « Branché sur Gemini » ; le code appelle Sonnet (`sales-chat.ts:101-106`). Le compteur de 60 réponses par jour rend 0 en cas d'erreur de lecture, donc laisse passer (`garde-fous.ts:52-61`). Deux libellés différents pour le même message d'épuisement (« marchent » / « fonctionnent »).
