Les livrables de l'audit utilisateur de la page Automatisations (mission du 2026-10-01). **Aucun code de l'application ne change** : deux documents, des scripts de vérification et une commande npm.

- `AUTOMATIONS_UI_MAP.md` — la carte des 377 éléments de la section (liste, bibliothèque de modèles, messages, éditeur, API).
- `AUTOMATIONS_UI_AUDIT.md` — le rapport : verdict pour le launch du 26 octobre, couverture, appareils et navigateurs, les 68 constats et leur statut, ce qui reste à décider, ce qui n'a pas été testé.
- `scripts/qa/automations-prod/` + **`npm run test:automations:e2e`** — 64 vérifications pilotées dans un vrai navigateur (Chromium, WebKit avec l'agent d'un iPad) **sur lumecrm.net**, dans le bureau de test « Grok Audit (TEST) » en bac à sable. Sortie en JSON et en markdown, code 1 si une vérification échoue. 64/64 le 2026-10-01 à 19 h 50 UTC.

Garde-fous des scripts : ils refusent tout autre bureau que le bureau de test (vérifié par son nom en base), exigent qu'il soit en bac à sable, n'écrivent que des brouillons de test retirés par identifiant, et ne cliquent jamais « M'envoyer un essai ».

C'est une passe **après déploiement** : elle juge ce qui est en ligne. Ce qui bloque un merge reste la CI.

À merger après la fenêtre de mesure en cours (session f1) : un merge sur main redéploie, même sans code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
