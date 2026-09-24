# Test manuel — glisser-déposer des cartes du pipeline

**Pourquoi ce document.** L'audit QA du 24 septembre 2026 n'a pas pu tester
le glisser-déposer : quatre tentatives (souris et clavier) ont échoué sans
que la carte bouge. On ne sait donc pas si c'est un bug réel ou une limite
de l'automatisation — et **on ne corrige pas à l'aveugle**.

Le déplacement par le menu déroulant « Étape » fonctionne, lui. Si le
glisser-déposer est cassé, le pipeline reste utilisable : ce n'est pas
bloquant, mais c'est le geste principal du vendeur.

## Ce qui est déjà établi

Le code utilise `@dnd-kit` (`DndContext`, `useSortable`, `DragOverlay`,
`PointerSensor` avec une contrainte d'activation de 4 px). C'est cette
contrainte qui explique probablement l'échec de l'automatisation : un clic
synthétique qui ne parcourt pas 4 px réels ne déclenche jamais le glissement.

**Donc : un échec en automatisation ne prouve rien. Seul un humain tranche.**

## Préparation

1. Compte de test, jamais un vrai client.
2. Le pipeline visé doit contenir **au moins 3 deals** répartis sur
   **au moins 2 étapes ouvertes**.
3. Noter l'état de départ : quel deal, dans quelle colonne.

## Procédure — à refaire sur chaque navigateur

Pour chaque cas : noter **ce qui se passe à l'écran** et **ce qui reste après
un rechargement (F5)**. Un déplacement qui s'annule au rechargement n'a pas
été enregistré — c'est un bug différent d'un déplacement qui ne part pas.

### Cas 1 — déplacer entre deux étapes ouvertes
1. Cliquer et **maintenir** sur une carte, bouger d'au moins 10 px avant de
   déplacer (la contrainte de 4 px).
2. Déposer dans une autre colonne ouverte.
3. Attendu : la carte reste dans la nouvelle colonne, les compteurs des deux
   colonnes changent, et **ça tient après F5**.

### Cas 2 — déplacer vers « Gagné »
1. Glisser une carte vers la colonne « Gagné ».
2. Attendu : la fenêtre « Créer la job » s'ouvre **et** la carte est déjà
   passée en Gagné.
3. Cliquer **Annuler**.
4. Attendu : la carte **reste** en Gagné, avec le badge « Job à créer ».
   *(C'était le bug P0-1, corrigé le 25 septembre — à revérifier ici.)*

### Cas 3 — déplacer vers « Perdu »
1. Glisser une carte vers « Perdu ».
2. Attendu : la fenêtre de raison s'ouvre. **Sans raison, rien n'est écrit.**
3. Annuler : la carte revient à sa colonne d'origine.

### Cas 4 — relâcher hors d'une colonne
1. Prendre une carte et la relâcher au milieu de la page, hors de toute
   colonne.
2. Attendu : la carte revient à sa place, aucun message d'erreur.

### Cas 5 — clavier (accessibilité)
1. Tabuler jusqu'à une carte, appuyer sur **Espace**.
2. Flèches gauche/droite pour changer de colonne, **Espace** pour déposer.
3. Attendu : même résultat qu'à la souris. *(Si le clavier ne fonctionne pas
   alors que la souris oui, c'est un défaut d'accessibilité à signaler —
   pas un blocage.)*

## Navigateurs à couvrir

| Navigateur | Testé par | Date | Cas 1 | Cas 2 | Cas 3 | Cas 4 | Cas 5 |
|---|---|---|---|---|---|---|---|
| Chrome (ordinateur) | | | | | | | |
| Safari (Mac) | | | | | | | |
| Safari (iPhone) | | | | | | | |
| Chrome (Android) | | | | | | | |

Sur téléphone, le glissement demande un **appui long** avant de bouger : si
la page défile au lieu de prendre la carte, c'est le comportement à signaler.

## Quoi faire du résultat

- **Tout passe** → le glisser-déposer marche, l'échec du QA venait de
  l'automatisation. Rien à corriger.
- **La souris marche, le clavier non** → défaut d'accessibilité, à corriger
  dans une vague suivante, non bloquant.
- **Rien ne bouge sur un navigateur donné** → bug réel. Noter le navigateur,
  sa version, et **ouvrir la console** (F12 → Console) : une erreur
  JavaScript au moment du glissement est l'indice décisif.
- **La carte bouge mais revient après F5** → l'écriture échoue en base. La
  console et l'onglet Réseau montreront la requête refusée.
