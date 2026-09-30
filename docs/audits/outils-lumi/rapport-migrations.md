## 6. Migrations en attente

Aucune migration de l'audit n'a été appliquée, aucun préréglage de rôle modifié, aucune donnée corrigée. Tout ce qui touche la base est **écrit et en attente de ton accord**.

| Fichier | Effet | Risque | Vérification prévue |
|---|---|---|---|
| `supabase/migrations/20261004500000_team_members_insert_admin_ou_soi.sql` — **APPLIQUÉE staging + prod le 2026-09-30 (accord de Rafba)** | INSERT sur `team_members` réservé aux admins, ou à soi-même | Vérifié sur staging : un vendeur ne crée plus la fiche d’un autre (refus RLS), sa propre fiche passe ; politique identique en prod ; checks sans nouvel écart | — |

À décider avant d'écrire (pas de fichier tant que la décision n'est pas prise) :

1. **Mode Lumi par défaut** : `memberships.lumi_mode DEFAULT 'argent'` → `'demander'` pour que les 180 actions aient une carte (et mise à jour des membres encore au défaut).
2. **Loi 25 — taux horaire et date de naissance** : restreindre `hourly_rate_cents`, `labour_cost_hourly`, `birth_date` de `team_members` aux admins. Demande d'abord de passer `ProfileSettings.tsx`, `TeamMemberDetails.tsx` (`select('*')`) et `Commissions.tsx` par une RPC, sinon ces écrans cassent.
3. **Recherche sans accents** (« Levis » = « Lévis ») : extension `unaccent` + index ; aujourd'hui `search_clients` ne trouve pas un nom tapé sans accent.

Hors audit, déjà fait pendant la session (hors de la règle « outils de Lumi », accord permanent sur les migrations, PR #796) : `20261004210000_secdef_champs_depenses_revoke.sql` — fermeture à `anon`/`authenticated` de 3 fonctions SECURITY DEFINER des Dépenses, appliquée staging + prod, ACL vérifiées.
