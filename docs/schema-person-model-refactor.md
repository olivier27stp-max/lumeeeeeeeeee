# Refonte du modèle « personne » — spec pour le dev

> **Révisé le 2026-08-03** contre la prod. Les chiffres de la version de juillet
> étaient **largement périmés** : le problème de DONNÉES a quasi disparu, seul
> le problème de STRUCTURE reste. Conclusion pratique : ce n'est plus une
> migration de données de plusieurs jours, c'est un refactor de code ciblé.

## Le problème (structure)

L'identité d'une personne est **dupliquée sur 4 tables**, sans source de vérité
unique — et surtout, **sous des noms de colonnes différents d'une table à
l'autre** (`full_name` ici, `first_name`/`last_name` là, `display_name`
ailleurs). C'est ce qui fait que le code finit par *deviner* un nom de colonne.

| Table | Rôle réel | Identité stockée (❌ dupliquée) | Lignes (2026-07-08 → 2026-08-03) | Fichiers |
|---|---|---|---|---|
| `profiles` | profil du user auth (1:1 avec `auth.users`) | `full_name, avatar_url` | 23 → **46** | — |
| `memberships` | **user ↔ org + rôle** (système principal) | `full_name, avatar_url` (copie) | 18 → **40** | 36 |
| `team_members` | annuaire d'employés (concept **parallèle**) | `first_name, last_name, email, phone, avatar_url, street*, city…` | 6 → **2** | 10 |
| `field_sales_reps` | rep de vente terrain | `display_name, avatar_url` | 1 → **3** | 2 |

### Ce qui a changé depuis juillet (mesuré en prod le 2026-08-03)

| Constat de juillet | Réalité aujourd'hui |
|---|---|
| `team_members` : 5 lignes sur 6 **sans** `user_id` | **0 sur 2** — toutes rattachées à un compte |
| 5 fiches démo `@lume.crm` à nettoyer | **0** — déjà nettoyées |
| 0 chevauchement `team_members` ↔ `memberships` | **1 sur 2** chevauche |
| — | `profiles` ↔ `auth.users` : **46/46, parfait**, 0 orphelin des deux côtés |
| — | **0 divergence de nom** entre `memberships.full_name` et `profiles.full_name` |
| 1 membership orpheline | **toujours 1** (org de test vide `repro-views-…`) |

**Traduction :** `team_members` ne contient plus que **2 lignes** (les 2
propriétaires) et `field_sales_reps` **3** (dont 2 comptes QA). Il n'y a
pratiquement **rien à migrer**. Le coût du refactor est maintenant dominé par
le code (12 fichiers), pas par les données.

### Pourquoi le faire quand même

La nuit du 2026-08-03 a montré le coût réel de cette dispersion : plusieurs
bugs venaient de code qui écrivait dans la mauvaise table ou devinait un nom de
colonne (`team_members.phone`/`city` NOT NULL oubliés, `profiles` recevant 8
colonnes inexistantes à l'inscription D2D). `npm run check:schema-refs` attrape
désormais ces erreurs — mais supprimer l'ambiguïté vaut mieux que la détecter.

## Le principe visé : une info = un seul endroit

```
              ┌────────────────────────────────────┐
              │  profiles  (= LA meta-table)        │  identité : id(=auth.uid),
              │  la personne, une seule fois        │  full_name, avatar_url, phone
              └───────────────┬────────────────────┘
                              │ user_id (FK)
                   ┌──────────┴──────────┐
                   │  memberships         │  la RELATION : org_id, role, team_id,
                   │  + données d'emploi  │  status, hourly_rate_cents,
                   │                      │  working_hours, permissions…
                   └──────────────────────┘
```

- **`profiles`** = qui est la personne. Une ligne par humain.
- **`memberships`** = à quelle org + rôle + **données d'emploi**. Un « team
  member » = **une membership**, point.
- **`team_members`** = supprimée (fusionnée dans `memberships`).
- **`field_sales_reps`** = réduite à `user_id` + `is_active` + `role`, sans
  identité.

## Décisions à trancher

1. **Employés sans compte** : le cas n'existe plus en prod (0 ligne), mais le
   produit doit le supporter. Recommandé : `memberships` avec `user_id NULL` +
   `invited_email` + `status='invited'` — tout reste dans une table.
2. **`phone`** : aujourd'hui sur `team_members`. Le déplacer sur `profiles`
   (l'identité) plutôt que sur `memberships` (la relation).
3. **`team_members.permissions`** vs `memberships.permissions_custom` : les deux
   existent déjà. Choisir `memberships.permissions_custom` (déjà lu par le
   système de permissions) et abandonner l'autre.

## Plan de migration (ordre sûr)

> À faire **sur staging d'abord** (`npm run db:apply`), valider, puis prod
> (`npm run db:apply:prod`). Coordonner avec le coéquipier.

1. **Ajouter à `memberships`** les colonnes d'emploi manquantes :
   `hourly_rate_cents`, `labour_cost_hourly`, `working_hours jsonb`,
   `communication_preferences jsonb`, `compensation_mode`, `suspended_at`.
   (`ADD COLUMN IF NOT EXISTS`, valeurs par défaut non nulles.)
2. **Migrer les 2 lignes** de `team_members` vers la membership correspondante
   (les 2 ont un `user_id`). Migration triviale, vérifiable à l'œil.
3. **Créer la vue `v_org_members`** = `memberships ⋈ profiles` exposant
   (org_id, user_id, full_name, avatar_url, role, status, hourly_rate_cents…)
   avec `security_invoker = on` — **impératif**, sinon fuite inter-org (c'est
   exactement le bug trouvé sur `properties_active` en juillet).
4. **Repointer le code** — 12 fichiers, du plus simple au plus risqué :
   - `src/lib/weatherApi.ts`, `src/lib/profitabilityApi.ts`, `server/routes/leaderboard.ts` (lecture seule)
   - `src/components/TeamProfilesGrid.tsx`, `src/pages/RepProfile.tsx`
   - `src/lib/teamMembersApi.ts`, `src/pages/TeamMemberDetails.tsx`, `src/pages/settings/ProfileSettings.tsx` (écriture)
   - `server/routes/payroll.ts`, `server/routes/team-compliance.ts` (paie + conformité : tester en dernier)
   - `field_sales_reps` : `server/routes/field-sales.ts`, `server/lib/field-sales/territory-assignment-engine.ts`
5. **Retirer la duplication d'identité** de `memberships` (`full_name`,
   `avatar_url`) seulement APRÈS que tous les lecteurs passent par la vue.
6. **Déprécier puis DROP `team_members`** (garder 1-2 semaines en lecture).
7. Nettoyer la membership orpheline + les **15 orgs de test sans propriétaire**
   (toutes vides : `Test Lume Inc` ×8, `e2e-3d-…`, `repro-views-…`, `test-…`).
   Vérifié : aucun vrai client concerné.

## Vérification (avant / après)

```bash
npm run check:schema-refs        # doit rester à 0 après chaque étape
npm run db:diff                  # prod == staging après application des deux côtés
npm run test:rls                 # aucune fuite inter-org (surtout après l'étape 3)
node scripts/test-e2e-flow.mjs   # 26/26
```

- Avant : `select count(*) from team_members` = 2, identité dans 4 tables.
- Après : table absente, identité uniquement dans `profiles`, `v_org_members`
  retourne nom/avatar joints, `memberships` → `auth.users` sans orphelin.
