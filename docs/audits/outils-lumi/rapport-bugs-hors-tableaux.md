### Trouvés en dehors des tableaux d'audit (corrigés)

Défauts transversaux, trouvés en lisant le code d'exécution ou par l'éval — chacun touchait des dizaines d'outils à la fois.

| Sévérité | Défaut | Effet | Correction |
|---|---|---|---|
| critique | Anti-doublon PERMANENT par org (`agent_actions` sans âge ni utilisateur) | La même action redemandée des jours plus tard (relances, pointage d'un autre employé) n'était plus jamais exécutée, et Lumi répondait « déjà fait » | Empreinte par utilisateur, fenêtre de 10 min, « en cours » ≠ « fait » |
| critique | 173 actions sur 180 sans aperçu | On confirmait « Supprimer le client » ou un remboursement sans voir QUI ni COMBIEN | Aperçu générique : chaque identifiant lu en base et nommé, montants en $, dates locales, introuvable = alerte |
| critique | Confirmation par texto : pas d'expiration, pas de lien au membre, double « oui » = double exécution, seule la 1re action du groupe exécutée puis « C'est fait » | Un « oui » tardif exécutait la proposition de la veille | Expiration 15 min, proposition liée au membre, consommée une seule fois, toute la carte exécutée, aperçu déterministe dans le texto |
| critique | Filtre anti-injection SQL sur le texte libre | « Delete Sophie from my clients » bloqué (400) ET IP bannie 60 min : un utilisateur anglophone ne pouvait rien supprimer | Le texte libre (message, notes, description…) n'est plus inspecté comme du SQL (requêtes paramétrées) |
| élevé | Réponses d'aide toutes faites sur des ORDRES | « Configure mes taxes » → le chemin dans Paramètres ; « Remets les permissions de Karim » → le mot de passe oublié ; « Supprime la liste de la job 24 » → la fiche du job | Un ordre (verbe d'action, « peux-tu », « can you ») va toujours au modèle |
| élevé | Numéros affichés passés comme identifiants | « job 33 », « INV-000017 » → requête en échec, « souci de connexion à Lume » sur ~15 outils | La garde résout les numéros dans l'org, avant la carte et avant l'exécution |
| élevé | Identifiants inventés par le modèle (« jean-pierre-gagnon ») | La carte n'affichait rien, l'exécution échouait | Signalés en alerte sur la carte |
| élevé | Fuseau : « aujourd'hui » en UTC, heures sans décalage lues en UTC | Après 20 h, « demain » = après-demain ; « 9 h » devenait 5 h | Jour et heure de l'entreprise dans le prompt ; heures sans décalage converties au fuseau de l'entreprise (heure avancée comprise) |
| élevé | Reçus « C'est fait » sur un résultat incertain, partiel, déjà fait ou avec avertissement | Faux « c'est fait » | Reçus honnêtes (écran et texto) |
| élevé | `send_invoice` : message du modèle inséré en HTML | Lien d'hameçonnage possible dans un courriel au client | Texte échappé |
| moyen | Rentabilité : toutes les tranches d'ids lues en même temps | Pool PostgREST saturé sur un gros tenant (16 000 jobs) | 5 lots à la fois |
| sécu (hors Lumi) | 3 fonctions SECURITY DEFINER des Dépenses exécutables par `anon` | Total des dépenses d'une job de n'importe quelle entreprise lisible | Révoquées (migration appliquée staging + prod, PR #796) |
