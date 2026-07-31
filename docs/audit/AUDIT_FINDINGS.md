# AUDIT_FINDINGS — base de données Lume

- **Cible** : projet Supabase `bbzcuzqfgsdvjsymfwmr` — production (https://lumecrm.net)
- **Audit mené le** : 2026-07-31, de 01:32 à 14:00 UTC
- **Point de départ** : commit `9680ec5` · **État final** : `2ddac8b`
- **9 commits, 10 migrations, tous déployés et vérifiés en production.**

> **Ce document remplace la version du 2026-07-30**, écrite avant les sept
> vagues de correctifs. Celle-ci décrivait un état qui n'existe plus et
> contenait un finding depuis prouvé faux (§3.2).

**Sévérités** — P0 : fuite ou écriture cross-org possible · P1 : contournement
sous condition · P2 : durcissement / conformité · P3 : hygiène.

---

## 1. Résumé

| | |
|---|---|
| Failles de cloisonnement fermées | **5** |
| Fonctionnalités mortes réparées | **8** |
| Findings retirés après vérification (faux positifs) | **13** |
| Mécanismes de détection installés | **2** |
| Findings encore ouverts | **4**, aucun P0 ni P1 |

**Le constat marquant de cet audit n'est pas une faille.** C'est que
**dix fonctions étaient mortes ou cassées en production sans que rien ne le
signale** — dont le droit à l'effacement (Loi 25) et l'inscription
elle-même. Le cloisonnement, lui, tenait déjà et tient toujours.

---

## 2. Findings corrigés

Chacun a été vérifié **par exécution, dans les deux sens** : le chemin légitime
doit passer, le chemin d'attaque doit être refusé.

### 2.1 — P0 · `list_archived_items()` : archives de n'importe quelle org

`SECURITY DEFINER`, propriété de `postgres` (qui a `rolbypassrls = true`,
vérifié), accordée à `authenticated`, et **sans la moindre logique
d'autorisation** — ni `has_org_membership`, ni même un appel à `auth.uid()`.
Elle filtrait sur le seul paramètre fourni par l'appelant.

Chaîne complète, chaque maillon vérifié : un visiteur **anonyme** envoyait une
image sur un formulaire public, dont la réponse contenait
`request-forms/<ORG_UUID>/…` → il obtenait l'UUID du tenant cible → il créait un
compte gratuit → il appelait la fonction et recevait les clients archivés
(nom, compagnie, **courriel**) et les jobs de la cible.

La migration `20260751101400` l'avait explicitement épargnée au motif qu'elle
« filtre par RLS en interne ». **C'était faux** : `SECURITY DEFINER` s'exécute
sous le propriétaire, qui contourne la RLS.

Ne restituait encore rien uniquement parce qu'aucune organisation n'avait
archivé quoi que ce soit. S'activait au premier archivage.

→ Garde d'appartenance ajoutée (`20260751102100`) + fuite d'UUID fermée dans
`server/routes/request-forms.ts`. Non-membre → `42501` ; membre → résultat normal.

### 2.2 — P1 · `rpc_recalculate_quote()` : écrasement des montants d'autrui

La **sœur** de la précédente : `20260751101400` les avait épargnées **toutes les
deux**, sur le même raisonnement erroné. Celle-ci **écrit** — elle recalcule
sous-total, remise, taxes et total d'un devis désigné par un simple UUID.

Impossible de révoquer : le navigateur l'appelle (`src/lib/quotesApi.ts:345`
et `:552`). → Garde dans le corps (`20260751102300`).

### 2.3 — P1 · sept fonctions ouvertes à `authenticated` sans garde

Sur les **109** fonctions `SECURITY DEFINER` appelables par un utilisateur
connecté (signalées par l'advisor Supabase), toutes ont été triées : 95 avaient
déjà une garde, 4 ne touchent aucune table, 5 étaient les primitives de garde
elles-mêmes. Restaient 7 cas réels, tous fermés par révocation
(`20260751102200`, `20260751102300`) — aucune n'était appelée depuis le
navigateur, et leurs appelants SQL sont tous `SECURITY DEFINER` propriété de
`postgres`, donc insensibles au retrait du droit.

`create_minimal_job_for_deal` (insérait un job dans n'importe quelle org),
`record_consent` (falsification d'un registre de consentement Loi 25),
`crm_next_invoice_number` (consommait la séquence de facturation d'un tiers),
`resolve_primary_property`, `user_org_ids`, `same_company_orgs`,
`check_subscription_active`.

### 2.4 — P1 · trois IDOR applicatifs

`POST /dsr/erase/client/:id` et `/erase/lead/:id` récupéraient `auth` puis ne
s'en servaient jamais ; `joinChallenge` ne cloisonnait pas le défi parent.
→ Corrigés dans `7c09dec`.

### 2.5 — P2 · l'UUID d'organisation fuyait publiquement

`server/routes/request-forms.ts:351` renvoyait le chemin de stockage
`request-forms/<ORG_UUID>/…` à un visiteur **non authentifié**. Premier maillon
de 2.1. → Champ retiré ; vérifié qu'aucun client ne l'utilisait.

---

## 3. Fonctionnalités mortes réparées

**Le vrai sujet de cet audit.** Un même motif — une garde interne sur
`auth.uid()` dans une fonction appelée en `service_role`, où `auth.uid()` vaut
NULL — a rendu **huit fonctions inertes**. Deux avaient déjà été réparées le
30 juillet sans que la cause soit cherchée ailleurs.

| Fonctionnalité | État avant | Migration |
|---|---|---|
| **Droit à l'effacement (Loi 25)** | refusait tout le monde | `20260751102400` |
| Suppression différée d'un membre (demande) | inerte | `20260751102500` |
| Suppression différée d'un membre (annulation) | inerte | `20260751102500` |
| Exigence MFA par membre | inerte | `20260751102500` |
| Rapport planifié — aperçu | inerte | `20260751102500` |
| Rapport planifié — conversion des leads | inerte | `20260751102500` |
| Export de portabilité (client) | déjà réparé le 30/07 | — |
| Export de portabilité (utilisateur) | déjà réparé le 30/07 | — |

### 3.1 — L'inscription était cassée

**Découvert en testant que je ne la cassais pas.**
`src/pages/OnboardingFlow.tsx:248` crée l'adhésion **depuis le navigateur**,
donc soumise à la RLS, donc à la branche bootstrap qui appelle
`org_has_no_members()`. Or le droit d'exécution de cette fonction sur
`authenticated` avait été retiré par le durcissement générique du 30 juillet.

Résultat : `ERROR 42501: permission denied`. Et comme le code fait `await`
**sans `try/catch`**, l'erreur était **avalée en silence** : l'utilisateur
créait son organisation et n'en devenait jamais membre.

**Impact réel : nul.** Aucune organisation n'a été créée depuis le 30 juillet,
et les 7 utilisateurs sans organisation sont tous antérieurs. La panne a duré
environ une journée et n'a atteint aucun compte réel.

→ Droit rétabli **et borné** par une policy `RESTRICTIVE` limitant la branche
bootstrap aux 24 h suivant la création de l'org (`20260751102700`). Fenêtre
justifiée par la mesure : sur les 19 organisations ayant un membre, le premier
arrive entre **45 ms et 21 min**, jamais au-delà.

### 3.2 — ⚠️ Finding RETIRÉ : « 12 organisations revendicables »

La version précédente de ce document classait ce point en **P1**. **C'est faux.**
La revendication était **déjà bloquée** — par ce même droit manquant sur
`org_has_no_members`. Le constat venait de la lecture du source
(`20260711120000:49` accorde le droit) **sans vérification de l'ACL réelle**.

Le vrai problème était l'inverse : pas un trou, une panne. Les 12 organisations
sont d'ailleurs toutes des données de test — 11 ont `created_by` NULL (créées
par script), et aucun compte utilisateur ne leur correspond.

---

## 4. Détection installée

Constat de départ : les 7 sondes `check_*` créées le 30 juillet n'avaient
**aucun appelant**, et 6 tables de télémétrie étaient **vides**.

Cause : le login se fait entièrement côté navigateur
(`src/pages/Auth.tsx:39`) et ne passe jamais par le serveur — rien n'appelait
`record_failed_login()`. `auth.audit_log_entries` est vide également. **Mais
`auth.sessions` était riche** : la donnée forensique existait, elle n'était
reliée à rien.

| Mécanisme | Fréquence | Effet |
|---|---|---|
| `sync_auth_telemetry()` | tous les quarts d'heure | `login_history` et `active_sessions` alimentés — **63 connexions, 18 utilisateurs, historique remontant au 17 avril** |
| `run_invariant_checks()` | chaque nuit | toute défaillance d'invariant écrite dans `security_events` |

Première exécution automatique confirmée : `succeeded` à 13:45:01 UTC.

**Limite assumée** : une session n'existe que si la connexion a **réussi**.
`failed_login_attempts` et `ip_blocklist` restent vides — les alimenter exige un
Auth Hook Supabase ou de faire transiter le login par le serveur.

---

## 5. Ce qui a été vérifié et trouvé CONFORME

| Contrôle | Résultat |
|---|---|
| RLS activée **et forcée** sur toutes les tables | **0 manquement** |
| Vues sans `security_invoker` | **0** |
| Fonctions `SECURITY DEFINER` sans `search_path` figé | **0** |
| Contraintes restées `NOT VALID` | **0** |
| Tables sans clé primaire | **0** |
| Colonnes `timestamp` sans fuseau | **0** |
| Montants stockés en flottant | **0** |
| Injection SQL (225 fonctions relues) | **0** |
| Secrets en dur dans le schéma | **0** |
| Références cross-tenant en base | **0** |
| Fuite de données client vers `anon` (35 tables) | **0** |
| **Isolation cross-org prouvée par exécution** | **47 tables + 4 vues, 0 fuite** |
| Cohérence des montants (`jobs`, `invoices`) | garantie par trigger `sync_legacy_money_columns` |

**Contrôle de non-régression** : la campagne d'isolation rejouée après tous les
correctifs donne un résultat **identique** à celui d'avant. Les trois tables que
l'audit a alimentées sont cloisonnées (`login_history` 63 lignes d'autres orgs
→ 0 visible ; `active_sessions` 63 → 0 ; `security_events` 88 → 0).

---

## 6. Findings encore ouverts

Aucun n'est P0 ni P1.

| Finding | Sévérité | Pourquoi non traité |
|---|---|---|
| `create_incident()` inerte | P2 | La route ne fait aucun contrôle de rôle et la fonction n'a pas de paramètre d'org. Relâcher la garde ne suffirait pas et créerait un trou : demande une décision de conception. |
| `list_member_audit_events()` inerte | P2 | Garde de forme différente (imbriquée dans une requête) ; le garde-fou du correctif automatique l'a écartée par prudence. |
| Tentatives de connexion échouées non capturées | P2 | Exige un Auth Hook Supabase ou de router le login par le serveur — décision produit. |
| `create_minimal_client_for_deal()` cassée (`22P02`) | P3 | Concaténation `text[]` avec un littéral non typé. Casse `create_client_and_deal`. Aucun appelant applicatif : impact nul. |

---

## 7. Angles morts — non mesurés, donc ni sûrs ni à risque

**123 tables sur 170 n'ont pas pu être testées en isolation**, faute de contenir
des données appartenant à plus d'une organisation. Ce n'est pas un défaut du
protocole mais du jeu de données : la production compte **8 354 lignes**, et
sur 31 organisations **deux seulement sont réelles** (les autres sont des tests).

Le script est réutilisable : il redeviendra concluant avec de vrais clients.
**À rejouer une semaine après le lancement.**

Par ailleurs, la campagne couvre la **lecture**. Pour l'écriture, rappel
essentiel : **un `UPDATE` bloqué par la RLS retourne 0 ligne sans lever
d'erreur** — il faut asserter le nombre de lignes affectées, jamais l'absence
d'exception.

---

## 8. Leçons de méthode

**Treize findings ont été retirés après vérification.** Tous avaient la même
cause : avoir conclu sur le **code source** au lieu de la **base réelle**.

| Lot retiré | Origine de l'erreur |
|---|---|
| 7 « fuites cross-tenant » dans les routes | Répertoire de travail **741 commits en retard** sur la branche déployée |
| 4 constats structurels (vues sans `security_invoker`, `search_path` mutable, contraintes `NOT VALID`, tables sans PK) | `complete_schema.sql`, périmé de 121 migrations |
| « 12 organisations revendicables » | Lecture du `grant` dans la migration sans vérifier l'ACL réelle |
| « Triple colonne de montants non synchronisée » | Trigger `sync_jobs_legacy_money` manqué dans une requête tronquée |

Trois règles en découlent, et elles ont toutes été payantes :

1. **Auditer `origin/main`, jamais le répertoire de travail.**
2. **Ne jamais retranscrire un corps de fonction** — le lire depuis
   `pg_proc.prosrc`. Une transcription manuelle avait introduit des `coalesce()`
   inexistants, rattrapés par comparaison au corps réel.
3. **Toujours remonter dans la fonction appelée** avant de déclarer une route
   vulnérable. Six des sept faux positifs venaient de gardes situées en aval.

Et la plus utile : **tester les deux sens systématiquement, y compris quand on
est sûr de soi**. Le test qui a révélé que l'inscription était cassée est celui
qui vérifiait que le correctif ne la cassait pas.
