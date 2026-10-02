Lot 3 de l'audit Automatisations : la passe « appareils » (phase 4). Tout a été **mesuré sur lumecrm.net**, WebKit avec l'agent utilisateur d'un iPad, dans le bureau de test en bac à sable — puis le correctif a été simulé sur la vraie page avant d'être écrit.

## Ce qui était cassé sur iPad
- **Liste** : le tableau gardait 980 px de large dans une zone de 710 px (paysage 1024) puis 486 px (portrait 768). L'interrupteur publier / brouillon, la flèche des messages et le menu « ⋮ » étaient hors écran : **0 sur 10 atteignables**. En portrait, on ne voyait plus que la colonne « Nom ».
- **Barre du haut** (toutes les pages) : en portrait, 551 px dans 536 px — l'avatar « Mon profil » dépassait de l'écran.
- Cibles trop petites au doigt : « Tout arrêter » (18 px de haut), bascule FR/EN (26 px), « + » entre deux étapes (20 px), menu « … » d'une carte (24 px).

## Ce qui change
- Liste : les colonnes secondaires se replient par palier — compteurs à partir de 1024 px, dates à partir de 1280 px. Case, nom, statut, statistiques et actions restent toujours là. Mesure avec le correctif simulé : 10/10 atteignables à 1024 et à 768, sans défilement horizontal.
- Barre du haut : la recherche ne prend sa largeur de bureau qu'à partir de 1024 px ; le sélecteur de bureau peut rétrécir (son nom se tronque déjà).
- Les quatre petites cibles gagnent de la taille **seulement au toucher** (`pointer-coarse`) : rien ne change à la souris.

## Vérifié sans rien changer
- Éditeur sur iPad paysage et portrait, avec un vrai parcours de cinq étapes : panneau d'étape, panneau « Quand » (un seul à la fois), tiroir, onglets Réglages / Historique / Journaux — tout tient, aucune erreur console ni réseau.
- Téléphone (375 px) : la section n'est pas offerte, la porte mobile s'affiche (« Le bureau sur l'ordi. Le terrain dans l'app. ») — comportement voulu.
- Firefox et Safari de bureau : écrans conformes ; Firefox remonte à chaque page l'exception du verrou de session de supabase-js (sans effet visible, notée dans le rapport d'audit).

## Tests
- `tests/automation/front-automations-liste-lot2.test.tsx` (5 nouveaux : paliers des colonnes, en-tête et cellules ensemble, actions jamais repliées), `tests/entete-tablette.test.ts`.
- jsdom ne met rien en page : la preuve à l'écran est la mesure sur le vrai site (`p8-tablette`, `p9-entete-tablette`, `p10-editeur-tablette`), rejouée après le déploiement.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
