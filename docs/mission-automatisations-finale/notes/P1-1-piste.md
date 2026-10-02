# P1.1 — « Lumi dit avoir modifié, rien ne change » : première piste (lecture seule de la prod, 2026-10-01)

La règle de Rafba : bureau « Coquin lavage », « Relance facture en retard », `invoice.overdue`,
id `b6ea80ce-916b-43e8-accd-28093f9e4e4e`, créée 18:29:05 UTC, modifiée 18:30:20 UTC, brouillon.

Sa demande n'est PAS passée par le clavardage de Lumi (aucune trace `lumi_traces` de Coquin lavage
ce jour-là) : elle est passée par le panneau « Construire avec Lumi » de l'éditeur
(`POST /api/automations/rules/generer`), dont la conversation est rangée dans
`automation_rules.lumi_conversation` :

- utilisateur : « salut lumi avec lautomatisation jai mis peux tu faire un message envoyer texto de
  mettre un texte de relance de facture »
- Lumi : « J'ai remplacé le texte d'exemple par un vrai texto de relance… Nouveau texte : • Texto :
  « Bonjour [client_first_name], votre facture [invoice_number] est en retard… » »

État en base de cette règle :

- `steps[0].action.config.body` = le NOUVEAU texte (Lumi a bien écrit).
- `actions[0].config.body` = « À compléter » (le texte d'exemple, resté tel quel).

Donc DEUX représentations du même message dans la même ligne : `steps` (parcours, le modèle
de l'éditeur plein écran) et `actions` (l'ancien modèle à plat). Lumi écrit dans `steps`,
`actions` garde l'ancien texte. Tout écran qui lit `actions` montre « À compléter » : c'est
« aucun changement visible ».

À établir (agent A, au vrai navigateur) :
1. Quels écrans lisent `actions` et lesquels lisent `steps` (liste dépliée « Voir les messages »,
   Réglages › Messagerie, aperçu, carte du canevas, panneau d'étape).
2. Lequel des deux le MOTEUR exécute quand les deux existent.
3. Qui écrit quoi : éditeur (enregistrement automatique), route /generer, outils de Lumi
   (update_automation_message écrit `steps` et ne tient `actions` à jour que s'il n'y a qu'un
   message de ce type — signalé par la session a1), préréglages, bibliothèque de modèles.
4. Combien de règles en prod ont `steps` ET `actions` qui divergent (comptes agrégés).

Correctif attendu (P6) : une seule source de vérité ; `actions` dérivé de `steps` ou retiré de
toute lecture.

## Comptes agrégés en prod (lecture seule, 2026-10-01 ≈ 22:45 UTC)
- 593 règles (hors purgées) dans 13 bureaux : 69 ont un parcours (`steps`), 524 sont « à plat » (`actions` seul).
- Publiées : 11 parcours, 350 à plat. Corbeille : 42.
- 36 parcours gardent dans `actions` le texte d'exemple « À compléter » alors que `steps` porte un vrai message :
  la divergence n'est pas un cas isolé.
- L'ancienne table `automations` (ancien moteur, server/lib/scheduler.ts) : 0 ligne.
- Vrais bureaux : 2 (91 règles, 7 parcours, 55 publiées). Bureaux de test : 11 (502 règles).
