Lot 2 des correctifs de l'audit « chaque bouton » de la page Automatisations (2026-10-01). Quatre agents ont travaillé en parallèle, chacun sur ses fichiers ; l'intégration, les raccords entre leurs périmètres et la relecture sont de la session principale. Chaque correctif a son test, vu rouge sur l'ancien code.

## Liste
- La liste suit l'ordre alphabétique des noms **affichés** (elle était triée sur les noms stockés en anglais : mélangée en français).
- Un seul menu ouvert à la fois (« Créer » et « ⋮ ») ; un double clic sur « Tout arrêter » ne referme plus la confirmation.
- L'aperçu d'un parcours à étapes montre un exemple (« Bonjour Marie »), plus la variable brute.
- « Texto envoyé au client » partout ; en anglais « Build with Lumi » dans l'en-tête comme dans le menu.
- La bulle « Aide et support » ne recouvre plus « 10 / page » ; espaces insécables du dialogue « Tout arrêter ».
- Accessibilité : sous-navigation en liens avec section courante (un seul composant pour les trois pages), langue active annoncée, onglets reliés à leur panneau, colonne d'actions nommée, bouton × de la fenêtre de forfait « Fermer ».
- Langue du bureau illisible : plus de « FR » / « Français » affiché d'office — l'écran dit qu'il ne sait pas.

## Éditeur
- **Le dernier déclencheur choisi est celui qui reste** : les choix rapprochés ne se doublent plus, la carte montre le nouveau choix tout de suite et l'indicateur dit « Enregistrement… ».
- Un seul panneau à droite (« Quand » et une étape ne s'ouvrent plus côte à côte) ; « + » pendant que les réglages du déclencheur sont ouverts ouvre bien le tiroir.
- Tiroir d'étapes : curseur dans la recherche à l'ouverture, Échap le ferme.
- Ctrl+Z / Ctrl+Y annulent et rétablissent (hors d'un champ de saisie).
- Automatisation supprimée pendant l'édition : « Cette automatisation n'existe plus. » au lieu d'enregistrements en échec sans fin.
- La carte « Quand » garde le nom du déclencheur quand son drapeau est éteint (plus de « payment.failed ») ; info-bulle sur un libellé coupé ; écran de chargement avec texte.
- Textes : l'option vide des menus dit ce que « vide » veut dire (plus de « — Inchangé — » hors sujet) ; « Suivi à faire » ; apostrophes typographiques.

## Bibliothèque de modèles
- L'aperçu dit les conditions en clair ; un modèle annonce autant d'étapes que l'éditeur en montrera, branches « si oui / si non » et canaux compris (« Relance de devis » : 23 étapes, courriel inclus).
- Catégorie cochée toujours visible ; « Tous les modèles » ne ment plus pendant une recherche ; focus placé dans l'aperçu.
- 54 textes de notification / tâche reçoivent leur version anglaise — et le moteur les utilise (cloche dans la langue du destinataire, notification d'équipe et tâche dans celle du bureau).

## Serveur
- Corbeille : publier par PATCH → 422 (même refus que la route de publication, test J-065 de main) ; dupliquer ou « Tester » une règle à la corbeille → 409 ; règle supprimée définitivement → 404 partout, y compris publication et outil Lumi.
- Modifier / supprimer une règle qui n'existe plus → 404 « Automatisation introuvable. » (c'était 500 / `ok: true`).
- « Visite déplacée » annoncée pour une visite qui n'a pas bougé ne renvoie plus de confirmation au client.
- Refus de permission : `error` inchangé, plus `message` / `message_en` lisibles — et les écrans les affichent.
- Notification « job prêt à facturer » dans la langue du destinataire.

## Non fait, à décider
- roles-05/06/07 : une écriture directe par supabase-js contourne les gardes du serveur (publier une règle incomplète, toucher `is_preset`, supprimer pour de bon). Demande une migration (grants par colonne + trigger) et de basculer cinq écritures serveur : proposition détaillée dans le rapport d'audit.
- modeles-13 : le mot « Modèles » désigne deux choses (onglet de la liste / bibliothèque) — proposition : onglet « Prêtes à publier ».
- liste-12 : « Anniversaire client » = 12 mois après la création de la fiche (décision de produit).

## Vérifications
- `tsc --noEmit`, suite complète locale (`--maxWorkers=4`), instantanés du filet régénérés et relus (seuls les textes voulus changent).
- Aucune migration. Aucun navigateur ni serveur lancé contre staging.
- Après le merge : surveillance du déploiement ≥ 3 min, puis vérification sur lumecrm.net dans le bureau de test en bac à sable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
