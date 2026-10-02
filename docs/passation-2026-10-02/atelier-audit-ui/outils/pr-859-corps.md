Lot 1 des correctifs de l'audit « chaque bouton » de la page Automatisations (mission du 2026-10-01). Chaque constat a été observé dans un vrai navigateur ; chaque correctif a son test, écrit pour échouer sur l'ancien code.

## Ce qui change pour l'utilisateur

**Liste**
- Échap ferme les menus (« ⋮ » d'une ligne, « Trier », « Filtrer ») et rend le focus au bouton.
- Le menu « ⋮ » d'une ligne n'est plus rogné par le tableau : sur les dernières lignes, « Supprimer » était hors de vue. Il s'ouvre vers le haut quand la place manque.
- « Tout arrêter » ne disparaît plus quand l'état de la pause est illisible : l'écran le dit, offre « Réessayer », et l'arrêt d'urgence reste utilisable.

**Éditeur**
- Une automatisation neuve affiche « Pas encore enregistrée » au lieu d'une alerte de publication ; la carte du déclencheur dit qu'elle se clique.
- Changer de déclencheur ne garde plus les conditions de l'ancien (une règle « devis » filtrée sur un champ de facture ne partait jamais).
- Une automatisation à la corbeille ne s'édite plus : écran dédié avec « Restaurer », et le serveur répond 409.
- « Déplacer l'opportunité → une étape précise » : l'étape se choisit dans un menu. C'était un champ où il fallait taper un identifiant technique.

**Courriels**
- L'« Aperçu réel » d'un courriel d'automatisation montre ce qui partira : plus de bloc « Montant à payer — 1 220,17 $ » ni de bouton « Voir et payer » inventés ; « M'envoyer un essai » envoie ce même rendu.
- La palette « Insérer » (une centaine de boutons) a une hauteur bornée, défile et se filtre en tapant. Elle occupait plus de la moitié de l'écran.

**Hors automatisations, trouvé en chemin**
- `App.tsx` : une lecture d'adhésions qui échoue ne crée plus un bureau vide au nom de l'utilisateur.

## Vérifications
- Suite complète locale (`--maxWorkers=4`) et `tsc --noEmit`.
- Aucune migration. Aucun envoi réel : tout a été observé dans les bureaux de test en bac à sable.
- Après le merge : surveillance du déploiement ≥ 3 min, puis vérification sur lumecrm.net dans le bureau de test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
