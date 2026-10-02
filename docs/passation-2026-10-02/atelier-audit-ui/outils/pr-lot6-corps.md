Lot 6 de l'audit Automatisations : la passe complète de bout en bout a enfin tourné, et ses tests entrent dans le dépôt. **Aucun fichier du produit n'est touché** (ni `src/`, ni `server/`, ni `supabase/`).

## 1. Les 1 058 tests de bout en bout — `e2e/automations/`
62 fichiers Playwright, un test par élément de `AUTOMATIONS_UI_MAP.md` et par parcours : liste, bibliothèque de modèles et messages, éditeur, déclencheurs, actions, rôles (interface, API directe, base directe). Écrits le 1er octobre, ils n'avaient jamais tourné en entier : staging tombait sous leur charge.

Ils tournent maintenant sur une **pile locale jetable** (`scripts/qa/automations-e2e/`) : Postgres + GoTrue + PostgREST + Realtime en conteneurs, schéma = `supabase/baseline/` + les migrations ajoutées depuis sa dernière vraie régénération (77 le 1er octobre, rejouées sans erreur), deux tables de référence lues dans une sauvegarde (`plans`, `role_permission_defaults`), aucune donnée de client. Le banc refuse toute adresse qui n'est pas `127.0.0.1` : ni staging, ni prod.

Résultat, après une première passe (565 / 489 bruts), le tri de chaque échec et la relance de chaque dossier :

| | Tests | Verts | Rouges `@defaut` |
|---|---|---|---|
| banc + moteur | 6 | 6 | 0 |
| actions | 177 | 143 | 34 |
| déclencheurs | 123 | 95 | 28 |
| éditeur | 184 | 135 | 49 |
| liste | 205 | 156 | 49 |
| modèles et messages | 222 | 173 | 49 |
| rôles | 141 | 114 | 27 |
| **Total** | **1 058** | **822** | **236** |

- Un test `@defaut` affirme le comportement **attendu** d'un défaut du produit et reste rouge tant que le défaut existe. Les 236 rouges sont décrits un par un dans `e2e/automations/_tri/` (écran, geste, ce qu'on voit, ce qu'on devrait voir, spec et ligne) : c'est la liste de travail de la session qui corrige les écrans (branches `mission/auto-finale-*`).
- 81 marques `@defaut` retirées : ces défauts ont été corrigés par les lots 1 à 5.
- Environ 140 specs remises d'aplomb là où le produit avait changé exprès (libellé, champ devenu une liste, sous-navigation en liens, onglet « Prêtes à publier »…), sans affaiblir ce qu'elles prouvent ; une dizaine de tests fragiles rendus déterministes (heure d'envoi des textos, données laissées par un autre test, droits gardés 60 s par le serveur).
- **Ces tests ne tournent pas en CI** (il faut Docker et deux heures) : `npm run test:automations:e2e:local`. Mode d'emploi : `e2e/automations/README.md`. La CI les couvre par le contrôle de types (`tsc` : 0 erreur).

Limites, dites dans le rapport : un seul projet lancé en entier (« bureau », Chromium 1440 × 900) ; une seule relance complète par dossier ; pas de stockage de fichiers ni de clé d'IA dans la pile (réponses de Lumi simulées) ; le 95 / 28 des déclencheurs est déduit d'une relance à 96 / 27 suivie d'un test remis en `@defaut`.

## 2. Passe du vrai site — `scripts/qa/automations-prod/`
- `80-publication.mjs` : publier puis repasser en brouillon avec l'interrupteur de la liste, base relue à chaque fois — 3/3 en prod avant ET après la migration de garde `20261007300000`.
- `outils.mjs` : la session gardée d'un script à l'autre est maintenant celle que l'app LAISSE à la fermeture. L'app renouvelle son jeton en cours de visite ; un jeton de rafraîchissement déjà servi ferme la session, et le script suivant atterrissait sur la page d'accueil.
- Dernière passe : 68 / 68 le 2026-10-01, 23 h 21 → 23 h 31 UTC, un script à la fois.

## 3. Garde en base — `scripts/qa/verifier-garde-automatisations.mjs`
Mode `--etendue` : l'état visé, où plus aucune session d'utilisateur n'écrit le contenu d'une automatisation (déclencheur hors catalogue, texto de 5 000 caractères, texto vidé d'une règle publiée, suppression dure d'une adresse d'appel). Aujourd'hui 16/16 en mode normal, 10/20 en mode étendu : la preuve avant / après de la fermeture en préparation. Sait aussi viser une base locale (`GARDE_DB_URL`, refuse toute adresse distante).

## 4. Rapport — `AUTOMATIONS_UI_AUDIT.md`
Verdict revu : **pas prêt** à déclarer « chaque bouton fonctionne » — 236 tests rouges, environ 220 défauts, une vingtaine de majeurs listés. Ajoutés : la passe complète et comment la lire, la garde livrée (#889 + migration) et ce qu'elle ne ferme pas encore, les incidents du 1er octobre (staging deux fois, base de prod une heure) et ce qui a changé depuis.

## Vérifications
- `tsc --noEmit` : 0 erreur.
- Suite complète locale (`vitest run --maxWorkers=4`, poste chargé) : 7 614 passés, 10 échecs sur des dépassements de délai dans 7 fichiers sans rapport avec cette PR ; ces 7 fichiers relancés seuls : 94 / 94.
- Passe du vrai site : 68 / 68.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
