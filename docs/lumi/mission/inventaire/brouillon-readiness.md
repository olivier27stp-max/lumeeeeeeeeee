# BROUILLON — LUMI_READINESS.md (à finaliser avec : robustesse, passe finale, support)

## Décisions qui attendent Rafba (à reprendre telles quelles dans le rapport)

1. **Conservation des conversations de Lumi (Loi 25).** Aucune purge n'existe : ni tâche planifiée, ni fonction. Il faut une durée (ex. 12 mois) ; la suppression de données demande ton accord. Seul test critique encore en échec.
2. **Dictée : la débiter en crédits, ou non ?** Elle coûte ≈ 0,5 à 0,9 ¢ par dictée et n'entre pas au grand livre (la base refuse la source « voix »). La brancher change ce que le client voit de ses crédits.
3. **Limites de débit générales.** Redis (Upstash) n'est pas branché en prod : les limites par préréglage (connexion 10/min, envois 10/min, pages publiques 15/min…) sont des laissez-passer ; seul le limiteur général (1 500) joue. Lumi et la dictée ont maintenant un repli en mémoire. Brancher Upstash, ou étendre le repli à tout ?
4. **Plafond de la plateforme : 50 $ par jour pour tous les clients réunis.** À relever avant le lancement (≈ 3 800 tours par jour au total).
5. **« Payant » : revenu ou rentabilité ?** « Mes clients les plus payants » → rentabilité ; « ma job la plus payante » → revenu. Une seule lecture à choisir.
6. **Lumi doit-il refuser de retenir un code d'alarme ?** (cas memoire-08).
7. **Arrêt gracieux du serveur.** Chaque déploiement coupe les réponses en cours (le client voit maintenant un message clair). Le corriger touche l'image Docker.
8. **Écarts entre le site et la base** (non touchés) : Scale est à 347 $ partout (ta consigne disait 340) ; Minimum annonce 3 utilisateurs inclus sur le site, 2 en base ; les vidéos de formation sont à Autopilot sur le site, à Scale en base ; la FAQ de la page Tarifs dit « rabais annuel de 15 % » alors que les forfaits font 10 / 15 / 30 %.
9. **#823** : migration appliquée en prod (mémoire de Lumi lisible par tout le bureau), toujours absente de main.
10. **Blocage à zéro crédit, éprouvé en prod.** Il faudrait épuiser un bureau de test (une ligne de consommation fictive de ≈ 25 $ dans le grand livre du bureau de test, puis un remboursement). Couvert hors réseau ; je ne l'ai pas fait sans ton accord.
11. **Job CI « Lumi (npm run test:lumi) »** à déclarer obligatoire dans la protection de branche pour qu'il bloque une fusion.
12. **Noms propres dans le journal d'analyse** (`lumi_traces`) : courriels et téléphones sont masqués, les noms de clients non.

## Risques restants (à reprendre)

- Demandes à plusieurs actions : 69 % (9/13).
- Choix d'outil du modèle sur ≈ 5 % des demandes.
- Un nom d'outil peut encore apparaître dans une réponse (1 cas sur 221) : détecté, pas filtré.
- MCP (agent externe) : n'applique pas la validation des paramètres de Lumi (S5), hors périmètre de cette passe.
- Déploiements fréquents : chaque déploiement vide les limites en mémoire et les caches.
- #831 mergée sans mesure (à juger par la passe finale).
- Résultats du support : à jouer.

## Ajouts 20:05 UTC

13. **Plafond de coût d'une conversation : 40 ¢.** Réglé le 2026-09-16 quand une conversation coûtait au plus 11,7 ¢. Mesuré le 2026-10-01 en prod : une conversation de 50 tours (16 passent par le modèle) atteint 40,5 ¢ au 16e tour d'agent quand les caches sont froids — 5 démarrages de sujet à 4–6 ¢ font 26 ¢. Lumi répond alors « ouvre une nouvelle conversation ». Variable Railway `LUMI_PLAFOND_CONVERSATION_CENTS` (aucun déploiement de code). Recommandation : 120 ¢ ; la garde quotidienne (15 % du mois) et les crédits restent les vrais plafonds.
- Robustesse (19:29–20:03 UTC, éval 2) : 32 PASS, 1 FAIL (dictée d'un silence, corrigé lot 8), 7 non couverts (4 « longue » à rejouer : redéploiement de 19:42 + plafond de conversation ; 2 vocal = vrais enregistrements ; 1 panne du fournisseur non provocable). Coût 0,90 $.
