# Refonte du modèle « personne » — spec pour le dev

## Le problème (constaté en prod, 2026-07-08)

L'identité d'une personne est **dupliquée sur 4 tables**, sans source de vérité unique :

| Table | Rôle réel | Champs d'identité qu'elle stocke (❌ à ne PAS dupliquer) | Lignes | Usage code |
|---|---|---|---|---|
| `profiles` | profil du user auth (1:1 avec `auth.users`) | `full_name, avatar_url` | 23 | — |
| `memberships` | **user ↔ org + rôle** (système d'auth principal) | `full_name, avatar_url` (copie) | 18 | 36 fichiers |
| `team_members` | annuaire d'employés (concept **parallèle** à memberships) | `first_name, last_name, email, phone, avatar_url, street*, city…` | 6 | 7 fichiers |
| `field_sales_reps` | rep de vente terrain | `display_name, avatar_url` | 1 | 3 fichiers |

Faits mesurés :
- `team_members` : **5 lignes sur 6 sans `user_id`** (fiches sans compte — des employés invités qui n'ont pas de login), dont 5 = **données démo** (`@lume.crm`).
- **0 chevauchement** entre `team_members` et `memberships` : les deux systèmes ne se parlent pas.
- 1 `membership` orpheline (pointe vers un `auth.users` supprimé) — à nettoyer.

**Conséquence :** changer le nom d'une personne à un endroit laisse les 3 autres périmés → bugs « user vs team member », dérive de données.

## Le principe visé : meta-table (source de vérité unique)

Une info = **un seul endroit**. Les autres tables **pointent** (FK) vers l'identité au lieu de la recopier.

```
              ┌────────────────────────────────────┐
              │  profiles  (= LA meta-table)        │  identité : id(=auth.uid),
              │  la personne, une seule fois        │  full_name, avatar_url, phone
              └───────────────┬────────────────────┘
                              │ user_id (FK)
          ┌───────────────────┴───────────────────┐
          │                                        │
   ┌──────▼─────────────────┐            (rôle terrain = simple
   │ memberships            │             drapeau/rôle sur la
   │ user_id, org_id, role, │             membership, pas une table
   │ team_id, status,       │             "personne" séparée)
   │ + champs emploi:       │
   │   hourly_rate,         │  ← les champs UTILES de team_members
   │   working_hours,       │     migrent ICI (ce sont des données
   │   labour_cost,         │     de la relation, pas de l'identité)
   │   permissions          │
   └────────────────────────┘
```

- **`profiles`** = qui est la personne (identité). Une ligne par humain.
- **`memberships`** = à quel org la personne appartient + son rôle + ses **données d'emploi** (taux horaire, horaires, permissions). Un « team member » = **une membership**, point.
- **`team_members`** = **supprimée** (concept fusionné dans `memberships`).
- **`field_sales_reps`** = réduite à un lien fin (`user_id` + `is_active`) ou remplacée par un rôle/flag sur la membership. Pas d'identité dedans.

## Décisions de design à trancher (par le dev)

1. **Les employés sans compte** (`team_members.user_id IS NULL`) : dans le modèle unifié, ce sont des **invitations en attente**. Deux options :
   - (a) `memberships` avec `user_id NULL` + `invited_email` + `status='invited'`, converties en vraie membership à l'inscription ; ou
   - (b) une table `invitations` dédiée. **Recommandé : (a)** (garde tout dans memberships).
2. **`profiles` vs `auth.users`** : l'email vit dans `auth.users`, le reste dans `profiles`. Décider si on ajoute `phone` sur `profiles` (aujourd'hui il est sur team_members).

## Plan de migration (ordre sûr)

> ⚠️ À faire **hors prod d'abord** (branche + DB de staging/clone), testé, puis appliqué. Coordonner avec le travail en cours du coéquipier (il touche au billing/insights).

1. **Ajouter à `memberships`** les colonnes d'emploi utiles de `team_members` : `hourly_rate_cents`, `labour_cost_hourly`, `working_hours jsonb`, `communication_preferences jsonb`, `status`, `suspended_at`. (`ADD COLUMN IF NOT EXISTS`.)
2. **Migrer les données** : pour chaque `team_members` **avec** `user_id` → upsert dans `memberships` (créer si absente) en copiant les champs d'emploi. Pour ceux **sans** `user_id` → créer une membership `status='invited'` + `invited_email` (option 1a).
3. **Repointer le code** : les 7 fichiers qui lisent `team_members` (2 serveur + 5 front) → lire `memberships` + joindre `profiles` pour le nom/avatar. Les 3 fichiers `field_sales_reps` → idem.
4. **Supprimer la duplication d'identité** : retirer `full_name, avatar_url` de `memberships` (les lire depuis `profiles` via join / une vue `v_org_members`). Retirer l'identité de `field_sales_reps`.
5. **Créer une vue de confort** `v_org_members` = `memberships ⋈ profiles ⋈ auth.users` qui expose (org_id, user_id, full_name, email, avatar_url, role, hourly_rate…) — pour que le front lise UN endroit propre.
6. **Déprécier puis DROP** `team_members` (garder 1-2 semaines en lecture le temps de valider).
7. Nettoyer la **membership orpheline** (1 ligne) et les **5 fiches démo** `@lume.crm`.

## Fichiers à toucher (repérage)
- Serveur : les 2 fichiers qui référencent `team_members` + les 2 `field_sales_reps` (grep `team_members` / `field_sales_reps` dans `server/`).
- Front : les 5 + 1 fichiers correspondants dans `src/`.
- `memberships` est déjà lu par 36 fichiers → **ne pas casser son contrat** ; ajouter, ne pas retirer brutalement (retirer `full_name/avatar_url` seulement après avoir migré les lecteurs vers `profiles`/la vue).

## Vérification (avant/après)
- Avant : `select count(*) from team_members` = 6, identité dans 4 tables.
- Après : 0 `team_members`, identité uniquement dans `profiles`, `v_org_members` retourne les membres avec nom/email/avatar joints, aucun orphelin (`memberships` → `auth.users` = 0 orphelin).
