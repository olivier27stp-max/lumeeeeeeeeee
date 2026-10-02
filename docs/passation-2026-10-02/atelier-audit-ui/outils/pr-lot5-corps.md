Lot 5 de l'audit Automatisations : les décisions laissées ouvertes dans `AUTOMATIONS_UI_AUDIT.md` § 6 (Rafba : « finis tout »), et la leçon de la panne de prod du 2026-10-01 pour la passe de vérification.

## 1. L'onglet « Modèles » de la liste s'appelle « Prêtes à publier »
« Modèles » désignait deux choses : cet onglet (les automatisations fournies pas encore publiées, qu'on publie en place) et la « Bibliothèque de modèles » du menu Créer. Le mot reste à la bibliothèque.

## 2. Publier une étape restée sur le texte d'exemple demande confirmation
Une étape ajoutée à la main naît avec un texte envoyable (« Bonjour [client_name], c'est [company_name]. Merci ! ») ; rien ne disait à la publication que personne ne l'avait rédigé (vécu en prod). Les contrôles de publication rendent un avertissement — jamais un blocage — par étape concernée : l'éditeur le montre dans sa confirmation, la liste (interrupteur et lot) ouvre « Publier avec le texte d'exemple ? ». Texte rédigé : rien ne change.

## 3. « Publiée » ne s'écrit plus que par le serveur, et la base garde les automatisations (roles-05/06/07)
Un membre qui a le droit de modifier les automatisations pouvait appeler la base directement pour publier une règle incomplète, se déclarer « automatisation fournie », changer le déclencheur d'une règle fournie, la purger, ou supprimer une règle pour de bon.

- **Serveur** : publier passe par le rôle de service, après une preuve de droit écrite avec la session de l'utilisateur (`changerPublication`). Créer « déjà publiée », publier par PATCH et copier vers un autre bureau écrivent d'abord un brouillon avec la session, puis le serveur publie.
- **Base** : `supabase/migrations/20261007300000_automation_rules_garde.sql` — un déclencheur qui refuse à une session d'utilisateur ce qu'aucun écran ne fait. Il lit `current_user`, pas le jeton : le semis des automatisations fournies (fonction SECURITY DEFINER) passe. Aucun droit ni policy ne change. **À appliquer APRÈS le déploiement de cette PR** (staging, puis prod) ; appliqué avant, la publication depuis l'app serait refusée. Retour arrière : `drop trigger trg_automation_rules_garde on public.automation_rules;`
- **Preuve** : `scripts/qa/verifier-garde-automatisations.mjs` joue 9 écritures interdites et 7 légitimes avec le rôle d'une session d'utilisateur, chaque tentative annulée aussitôt. Sur staging **avant** la migration : les 9 interdites passent (7/16).

## 4. La passe sur le vrai site s'arrête d'elle-même quand la prod ralentit
`npm run test:automations:e2e` ouvrait une session par script et a continué à charger des pages pendant que la base de prod tombait. Elle réutilise maintenant une session par rôle, lit `/api/health` avant chaque script et chaque onglet, met vingt secondes entre deux scripts, et s'interrompt (code 2) au premier 429 ou dès que la base dépasse 1 500 ms.

## Vérifications
- `tsc --noEmit`, suite complète locale : 7 173 tests verts.
- Nouveaux tests : `texte-exemple-a-la-publication` (9), liste P-008 (5, vus rouges sans le correctif), `publication-par-le-service` (5), « qui écrit publiée » (6), `garde-automation-rules-migration` (5).
- Après le merge : déploiement surveillé, puis migration staging → script (16/16 attendu) → prod → script, puis `check:broken-objects` et `check:db-coherence`, et une vérification à l'écran dans le bureau de test (publier, repasser en brouillon).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
