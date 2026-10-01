### Comment lire ces chiffres

- **Outil exact** : Lumi a proposé (écriture) ou appelé (lecture) l'outil attendu, et aucun outil « interdit » (le mauvais geste : supprimer au lieu d'archiver, annuler au lieu de supprimer…).
- **Paramètres + cible** : quand l'outil est le bon, ses paramètres attendus (montant, canal, date…) sont exacts ET la cible est visible sur la carte (numéro de facture, nom du client). C'est la mesure « l'action exécutée est celle que la carte montre ».
- **Clarification** : sur les 29 cas ambigus (homonymes, montant manquant, texte manquant), Lumi n'a rien proposé et a posé une question.
- **Faux « c'est fait »** : réponse qui affirme une action alors que rien n'a été exécuté (en mode « demander », rien ne l'est).
- **Partiel** : Lumi a cherché la bonne fiche mais elle n'existait pas sur staging (job n° 9, demande reçue, contrat…) — ni un succès ni un faux pas.

Conditions identiques pour les deux passes : même jeu de 456 cas, même org de staging, forfait avec Lumi et budget relevé le temps de la batterie (sinon le plafond journalier bascule en palier « restreint » — autre modèle — et fausse tout), serveurs sans aucun identifiant d'envoi.

### Ce que l'éval a trouvé (et qui est corrigé)

L'éval n'a pas seulement mesuré : elle a trouvé 6 défauts que la lecture du code n'avait pas vus — le filtre anti-SQL qui bloquait l'anglais, les réponses d'aide et les raccourcis de lecture qui répondaient à des ORDRES (y compris servis par le cache de réponses), les numéros affichés passés comme identifiants, les identifiants inventés, et la carte de deal qui lisait une colonne inexistante.

### Objectifs de la mission

| Objectif | Résultat |
|---|---|
| 100 % sur l'éval sensible | **Non atteint** (voir le tableau) : les écarts restants sont surtout des cas « partiels » (fiche absente de staging) et quelques choix d'outil du modèle. Aucun écart ne peut exécuter une action sensible sans carte. |
| Zéro faux « c'est fait » | **Atteint** (avant et après) |
| Zéro action différente de la carte | **Atteint par construction** : la carte est calculée sur les MÊMES arguments que l'exécution (numéros résolus avant la carte, taxes par la même fonction), la garde est refaite au clic, et la carte signale toute cible introuvable ou inventée. |
| Zéro écart de permission | **Atteint pour Lumi** (section 3) ; restent 2 décisions produit (send_email, mode par défaut). |
