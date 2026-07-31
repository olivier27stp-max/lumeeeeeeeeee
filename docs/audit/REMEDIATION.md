# REMEDIATION — ce qui bloque le lancement, et dans quel ordre

Source : `AUDIT_FINDINGS.md` · Correctifs : `RLS_FIXES.sql` (**non appliqués**)
Audit du 2026-07-31 sur le commit `9680ec5`, confirmé déployé en production.

---

## 0. État d'application au 2026-07-31

**Branche `fix/audit-p0`, basée sur `origin/main` @ `9680ec5`. Non poussée.**
Typecheck serveur : 0 erreur introduite (les 6 erreurs restantes viennent de
deux fichiers non suivis préexistants, `server/scripts/arm-setup-test.ts` et
`server/scripts/test-integrations.ts`).

| Correctif | État | Fichier |
|---|---|---|
| P2-1 — ne plus divulguer l'org_id publiquement | ✅ **APPLIQUÉ** | `server/routes/request-forms.ts:351` |
| DSR — garde d'org sur `POST /dsr/erase/client/:id` | ✅ **APPLIQUÉ** | `server/routes/dsr.ts` |
| DSR — garde d'org sur `POST /dsr/erase/lead/:id` | ✅ **APPLIQUÉ** | `server/routes/dsr.ts` |
| Gamification — cloisonnement de `joinChallenge` | ✅ **APPLIQUÉ** | `server/lib/field-sales/gamification-engine.ts` + `server/routes/gamification.ts` |
| **P0-1 — `list_archived_items`** | ✅ **APPLIQUÉ EN PROD** le 2026-07-31 à 02:20 UTC, vérifié par exécution (voir `S7_CATALOGUE_COMPLET.md` §4) — ⚠️ **à consigner dans une migration** | base de données |
| P1-1 — organisations revendicables | ❌ **NON APPLIQUÉ** | SQL + prérequis non mesurés (voir §2.3) |
| P3-3 — colonnes de `plans` | ❌ **NON APPLIQUÉ** | SQL |
| P2-3 — planification des sondes | ❌ **NON APPLIQUÉ** | SQL |

⚠️ **Les correctifs de code ci-dessus rendent les routes DSR d'effacement
_sûres_, pas _fonctionnelles_.** Le droit à l'effacement reste cassé en
production : `anonymize_client` garde avec `has_org_admin_role(auth.uid(), …)`
et `auth.uid()` est NULL sous `service_role`. Réparer le RPC est un travail
séparé — et la garde de route ajoutée ici en est le **prérequis de sécurité**,
puisque sans elle, réparer le RPC ouvrirait un effacement destructif
cross-tenant.

---

## 1. Critères de mise en service

| # | Critère | État | Justification |
|---|---|---|---|
| 1 | Aucune fuite de données client vers un utilisateur non authentifié | ✅ | 35 tables sensibles + 5 buckets testés en direct : 0 fuite |
| 2 | RLS activée, **forcée**, et pourvue d'au moins une policy sur toutes les tables | ✅ | `check_rls_coverage()` = 0 manquement |
| 3 | Aucun secret serveur dans le bundle client | ✅ | `dist/` inspecté : 0 occurrence |
| 4 | Aucune injection SQL dans les fonctions | ✅ | 225 fonctions `security definer` relues : 0 concaténation |
| 5 | Aucun secret en dur dans le schéma | ✅ | Seul accès secret via `vault`, correctement révoqué |
| 6 | Impossible de s'auto-promouvoir dans son organisation | ✅ | Trigger `enforce_membership_role_change` |
| 7 | **Aucune fonction `SECURITY DEFINER` servant des données sur la seule foi d'un paramètre org** | ❌ | **P0-1 — `list_archived_items`** |
| 8 | **Impossible de prendre le contrôle d'une organisation tierce** | ❌ | **P1-1 — 12 orgs sur 31 revendicables** |
| 9 | **Aucune divulgation publique d'identifiant d'organisation** | ❌ | **P2-1 — `request-forms.ts:351`** |
| 10 | **Isolation entre deux utilisateurs authentifiés d'organisations différentes prouvée par test** | ✅ **en lecture** | Campagne exécutée : 45 tables + 4 vues avec données réelles d'orgs tierces, **0 fuite** (`S5_TESTS.md`). Écriture cross-org non couverte ; 125 tables non mesurables faute de données multi-org. |
| 11 | **Traçabilité en cas d'incident** | ❌ | **P2-3 — 6 tables de télémétrie sécurité vides** |
| 12 | **Le schéma déployé est reproductible depuis les migrations** | ❌ | **P2-2 — dérive confirmée + 25 collisions de version** |

**Verdict : 6 critères sur 12 satisfaits. Le lancement n'est pas bloqué par une
fuite active, mais par trois défauts structurels et deux angles morts.**

---

## 2. Bloquant avant mise en service

### 2.1 — P0-1 · `list_archived_items` (Vague 1)
La seule vulnérabilité à chaîne d'exploitation complète et vérifiée. Elle ne
restitue rien aujourd'hui **uniquement parce qu'aucune organisation n'a encore
archivé quoi que ce soit**. Le premier client archivé après la mise en service
l'active.

**À mesurer avant d'appliquer** : `select prosrc from pg_proc where proname =
'list_archived_items';` — confirmer que le corps en production correspond bien à
celui de la migration (la dérive P2-2 prouve que ce n'est pas garanti).

### 2.2 — P2-1 · fuite d'UUID d'organisation (Vague 3)
Correctif d'une ligne, casse la racine commune de P0-1 et P1-1.
**À mesurer avant** : chercher l'usage de `path` dans le composant de formulaire
public côté `src/`.

### 2.3 — P1-1 · organisations revendicables (Vague 2)
**À mesurer avant** : le délai réel entre création d'org et premier membre dans
l'inscription, et le sort décidé pour les 12 organisations vides — le correctif
les rend définitivement non revendicables.

### 2.4 — Obtenir l'accès catalogue
Ce n'est pas un correctif mais un **prérequis** : 11 contrôles majeurs n'ont pas
pu être exécutés (texte des policies, grants réels, vues sans `security_invoker`,
FK sans index, contraintes `NOT VALID`, Advisors Supabase…). Générer un jeton
`sbp_…` sur https://supabase.com/dashboard/account/tokens et le placer dans
`.env.local` avec `SUPABASE_PROJECT_REF=bbzcuzqfgsdvjsymfwmr`.

**Tant que ceci n'est pas fait, personne ne peut affirmer que la RLS est
correcte — seulement qu'elle est présente.**

### 2.5 — Exécuter S5 (tests d'isolation authentifiés)
Créer la branche Supabase jetable de la Phase 0, y créer deux organisations et
deux utilisateurs, et prouver qu'aucun ne voit l'autre — en lecture **et** en
écriture. Rappel : **un `UPDATE`/`DELETE` bloqué par la RLS retourne 0 ligne
sans lever d'erreur** ; il faut donc vérifier le nombre de lignes affectées, pas
l'absence d'exception.

C'est le seul moyen de valider le critère 10, et c'est exactement la menace
qu'exploite P0-1.

---

## 3. Dans les 4 semaines suivantes

| Action | Finding | Prérequis |
|---|---|---|
| Brancher les 7 sondes d'invariants sur un cron **avec destination d'alerte** | P2-3 | Décider où part l'alerte, sinon on recrée un cron muet |
| Alimenter la télémétrie de sécurité (6 tables vides) | P2-3 | Code d'écriture à ajouter, pas de la donnée manquante |
| Faire échouer la CI quand `RLS_TEST_DB_URL` manque | — | Aujourd'hui elle sort **en vert** : un contrôle de sécurité qui ne détecte rien |
| Corriger l'`ALTER DEFAULT PRIVILEGES` qui oublie `authenticated` | — | Toute table créée ensuite repart écrivable par tout compte connecté |
| Résoudre les 25 collisions de timestamps de migrations | P2-2 | Rend `supabase db push` utilisable et supprime l'application manuelle |
| Vérifier `data_export_log` (Loi 25) | P2-3 | Exécuter un export de portabilité et confirmer la ligne |
| Trancher le cas `avatars` (bucket public) + poser des limites de taille | P2-4 | Décision produit |
| Réduire les colonnes de `plans` exposées à `anon` | P3-3 | Vérifier l'usage des plafonds sur la page tarifaire |

---

## 4. Ce qui attend

- **Doublons clients (P3-1)** — 7 lignes sur 66. Décision métier de fusion ;
  aucune requête automatique ne doit être écrite pour cela.
- **113 tables vides exposées (P3-2)** — tri produit à faire entre
  fonctionnalités à venir et code mort.
- **Dette de modélisation** — trois représentations du montant sur `jobs`,
  colonnes en doublon maintenues par triggers, `CHECK` contradictoires.
  **Non confirmée en base** : ces constats viennent d'une lecture de source
  partiellement périmée. Ne rien entreprendre avant l'accès catalogue.

---

## 5. Avertissement de méthode

Cet audit a produit **7 findings de fuite cross-tenant qui se sont tous révélés
faux**, parce qu'une passe avait analysé un répertoire local **741 commits en
retard** sur la branche déployée (`AUDIT_FINDINGS.md` §3).

Deux conséquences :

1. **Toujours auditer `origin/main`**, jamais le répertoire de travail. La
   branche `feat/mobile-profile-web-parity` ignore tout le durcissement de
   juillet ; la fusion demandera une revue de sécurité dédiée.
2. **Ne jamais appliquer un correctif de sécurité sans avoir relu la fonction
   appelée en aval.** Les six faux positifs venaient tous de gardes situées dans
   la fonction appelée ou dans une pré-vérification, et non dans le handler.
   « Corriger » ces routes aurait ajouté des vérifications redondantes — ou pire,
   remplacé une garde correcte par une garde approximative.

**Et la règle qui prime sur tout le reste** : ne pas laisser la même session
enchaîner audit et correction. L'agent qui vient de trouver un problème veut le
régler, et c'est précisément là que les policies se font « nettoyer ».
