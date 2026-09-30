### En bref

- **Aucune action sensible ne s'exécute sans carte** : argent, envoi au client, irréversible et droits sont `toujours` sur carte, quel que soit le mode, et « toujours confirmer » est refusé pour eux par le serveur. Les 180 actions ont maintenant un aperçu qui nomme la cible réelle (lue en base).
- **Ce que la carte montre est ce que le serveur exécute** : mêmes arguments (numéros résolus avant la carte), taxes calculées par la même fonction, identifiants inventés signalés, garde refaite au clic.
- **Zéro faux « c'est fait »** mesuré sur l'éval ; les reçus disent incertain, partiel, déjà fait.
- **Écarts de permissions** : escalade de droits fermée (écran ET Lumi), paie sur soi-même refusée, montants non écrits par qui ne les voit pas, clés alignées sur l'écran — sans toucher aux préréglages.
- **Constats** : 80 relevés ; restent ouverts 1 (schedule_job, laissé à la session agenda qui modifie sa RPC) et 8 partiels ; 3 décisions produit (mode par défaut, send_email, limiteur de textos). Migration team_members appliquée avec ton accord ; Loi 25 confiée à la session Statistiques.
- **Éval (456 cas, mêmes conditions)** : outil exact 79,4 % → **84,3 %** ; paramètres + cible sur la carte 37,4 % → **98 %** ; clarification quand il faut 82,8 % → **93,1 %** ; faux « c'est fait » 0 → **0** ; requêtes bloquées 3 → **0** ; coût 10,47 → 10,74 $ / 1000 demandes (+2,6 %). Sensibles : 75,2 % → 80,4 % (objectif de 100 % non atteint, voir section 4).

Branche : `feat/audit-outils-lumi` (à fusionner seulement avec ton accord). Tests : suite Lumi complète au vert, `tsc` serveur et client au vert.
