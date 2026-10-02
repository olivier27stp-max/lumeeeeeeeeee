# devis-08 — convert_quote_to_job demande au lieu de proposer la carte

Source : passe complète de la session f1, 2026-10-02 00:23 → 00:51 UTC, prod, bureau « [TEST] QA Lumi éval 4 »,
main 19378a5c. Fichier : C:\Users\Rafba\lume-lumi-evals\evals\lumi\resultats\passe-finale-eval4\ (cas `devis-08-convertir-job`).

- **Demande** : « Chantal Lévesque a accepté sa soumission pour la terrasse, fais-en une job. »
- **Étage** : 6 (tour d'agent, modèle principal).
- **Outils appelés** : `list_quotes` (lecture). Aucune carte proposée.
- **Réponse** : « Veux-tu que je planifie tout de suite une première visite, ou je convertis la soumission en job sans date pour l'instant ? »
- **Attendu par le jeu** : la carte `convert_quote_to_job`.

Lecture : la personne n'a pas donné de date. Convertir sans date est la réponse ; la planification vient après.
