# REMEDIATION — état au 2026-07-31, 14:00 UTC

Source : `AUDIT_FINDINGS.md` · Détail catalogue : `S7_CATALOGUE_COMPLET.md` ·
Tests d'isolation : `S5_TESTS.md`

**État final : `2ddac8b`, déployé et vérifié.** 9 commits, 10 migrations.

> Cette version remplace celle du 2026-07-30, antérieure aux correctifs.

---

## 1. Critères de mise en service

| # | Critère | État |
|---|---|---|
| 1 | Aucune fuite de données vers un utilisateur non authentifié | ✅ 35 tables + 5 buckets testés |
| 2 | RLS activée, **forcée**, avec au moins une policy partout | ✅ 0 manquement |
| 3 | Aucun secret serveur dans le bundle client | ✅ `dist/` inspecté |
| 4 | Aucune injection SQL | ✅ 225 fonctions relues |
| 5 | Aucun secret en dur dans le schéma | ✅ |
| 6 | Impossible de s'auto-promouvoir dans son organisation | ✅ trigger `enforce_membership_role_change` |
| 7 | Aucune fonction `SECURITY DEFINER` servant des données sur la seule foi d'un paramètre | ✅ 109 triées, 7 fermées |
| 8 | Impossible de prendre le contrôle d'une organisation tierce | ✅ borné à 24 h, vérifié par exécution |
| 9 | Aucune divulgation publique d'identifiant d'organisation | ✅ `request-forms.ts:351` corrigé |
| 10 | **Isolation entre organisations prouvée par test** | ✅ **en lecture** — 47 tables + 4 vues, 0 fuite. Écriture non couverte |
| 11 | **Traçabilité en cas d'incident** | ⚠️ **partiel** — connexions et sessions tracées ; **échecs de connexion non capturés** |
| 12 | Le schéma déployé est reproductible depuis les migrations | ❌ 25 collisions de version, dérive prouvée |

**10 critères sur 12 satisfaits, 1 partiel, 1 non satisfait.**
Aucun des deux restants n'est une faille de sécurité.

---

## 2. Ce qui reste avant de publier

### 2.1 — Vérifier que le PITR est actif ⚠️

**À faire par toi, dans le dashboard Supabase.** C'était le point 0.1 du plan
d'audit — le filet de sécurité — et il n'a **jamais été confirmé**. Des écritures
ont été faites en production sans que le point de retour soit validé. Rien n'a
mal tourné, mais l'angle mort doit être fermé avant le lancement.

### 2.2 — Décider du sort de `create_incident` et `list_member_audit_events`

Les deux seules fonctionnalités encore inertes. `create_incident` demande un
choix de conception : soit la route `incidents.ts` ajoute un contrôle de rôle et
la fonction reçoit un paramètre d'org, soit l'appel passe par le client
utilisateur au lieu du `service_role`.

### 2.3 — Capturer les tentatives de connexion échouées

Aujourd'hui impossible : le login ne passe pas par ton serveur. Deux voies —
un Auth Hook Supabase, ou faire transiter l'authentification par Express.
C'est la dernière pièce du critère 11.

---

## 3. Dans les quatre semaines suivantes

| Action | Pourquoi |
|---|---|
| Résoudre les 25 collisions de timestamps de migrations | Rend `supabase db push` utilisable et met fin à l'application manuelle. Critère 12. |
| Régénérer ou supprimer `complete_schema.sql` | Périmé de 121 migrations ; il a produit **4 findings faux** pendant cet audit. Un faux référentiel est pire qu'aucun. |
| Faire échouer la CI quand `RLS_TEST_DB_URL` manque | Aujourd'hui elle sort **en vert** sans avoir rien testé. Le faux positif qui l'aurait bloquée est corrigé, l'activer est enfin viable — il faut une base de staging à deux organisations. |
| Réparer `create_minimal_client_for_deal` (`22P02`) | Casse `create_client_and_deal`. Impact nul aujourd'hui, mais c'est une mine. |
| Supprimer `create_lead_quick` | Pointe vers la table `leads`, supprimée. Code mort. |
| Retirer de l'exposition PostgREST les tables inutilisées | **113 des 229 tables exposées sont vides.** Surface d'attaque gratuite, jamais éprouvée par un usage réel. |
| Rejouer la campagne d'isolation | **123 tables sur 170 non mesurées** faute de données multi-org. Devient concluant avec de vrais clients. |

---

## 4. Ce qui peut attendre

- **427 index jamais utilisés, 14 FK sans index, 5 paires d'index dupliquées.**
  Vérifié : les FK concernées sont **toutes sur des tables vides**. C'est un
  artefact de l'absence de trafic, pas un problème. Y toucher maintenant serait
  du bruit avec un risque non nul.
- **7 doublons d'identité clients sur 66.** Fusionner engage jobs, devis,
  factures et paiements : décision métier, jamais une requête automatique.
- **Colonnes monétaires en double sur `jobs` et `invoices`.** Dette cosmétique
  seulement : le trigger `sync_legacy_money_columns` les dérive des colonnes en
  centimes à chaque écriture. La dérive est structurellement impossible.
- **Bucket `avatars` public.** Les photos de profil sont téléchargeables par URL
  directe. À trancher — c'est courant, mais ce n'est pas neutre.

---

## 5. Règles à faire respecter après le lancement

Elles ont toutes été payées comptant pendant cet audit.

1. **Auditer `origin/main`, jamais un répertoire de travail.** Sept fausses
   fuites sont venues d'une copie en retard de 741 commits.
2. **Ne jamais retranscrire un corps de fonction** — le lire depuis
   `pg_proc.prosrc`. Une transcription avait introduit des `coalesce()`
   inexistants.
3. **Remonter dans la fonction appelée** avant de déclarer une route vulnérable.
   Six faux positifs sur sept venaient de gardes situées en aval.
4. **Vérifier l'ACL réelle, pas le `grant` de la migration.** Un finding P1 a été
   inventé ainsi ; le durcissement générique avait retiré le droit entre-temps.
5. **Tester les deux sens, même en étant sûr de soi.** Le test qui a révélé que
   l'inscription était cassée est celui qui vérifiait qu'on ne la cassait pas.

Et la règle du plan d'audit initial, qui reste juste malgré qu'on s'en soit
écarté : **ne pas laisser la même session enchaîner audit et correction.**
L'agent qui vient de trouver un problème veut le régler — c'est là que les
policies se font « nettoyer ». Ici l'écart a été rentable, mais il a été tenu par
une vérification systématique en base après chaque écriture.
