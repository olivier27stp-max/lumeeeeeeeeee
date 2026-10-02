# Tri des échecs E2E — section Automatisations de Lume (2026-10-01)

Tu es une paire de la session qui tient `e2e/automations/**`. Une passe complète (1 054 tests Playwright,
projet « bureau ») vient de tourner sur une pile LOCALE. Ton travail : pour UN dossier de specs, dire de
chaque échec ce qu'il est, réparer les specs qui ont vieilli, et rendre la liste des vrais défauts du produit.

## Où
- Dépôt de travail : `D:/lume-uiaudit/wt-e2e` (worktree git, HEAD = le code de la PR #889, en prod depuis
  22:34 UTC ; ne fais AUCUNE opération git qui change les fichiers : ni checkout, ni stash, ni reset). **Tu n'écris QUE dans
  `e2e/automations/<ton dossier>/**`** (et jamais dans `_outils/`). Tu ne touches à AUCUN fichier du produit
  (`src/**`, `server/**`, `supabase/**`, `tests/**`) : une autre session (« 98 ») les modifie en ce moment.
- Résultats de la passe : `D:/lume-uiaudit/sorties/e2e-local/passe1.txt` (liste `ok` / `x`),
  `D:/lume-uiaudit/sorties/e2e-local/resultats/<test>/error-context.md` (erreur + arbre de la page),
  résumé par fichier : `D:/lume-uiaudit/sorties/e2e-local/echecs.md`.
- Carte des écrans : `AUTOMATIONS_UI_MAP.md` (identifiants `[LST-012]`, `[EDT-058]`…). Rapport de l'audit et
  tableau des constats : `AUTOMATIONS_UI_AUDIT.md` § 8.

## Relancer une spec (pile locale, jamais staging ni prod)
Les serveurs (proxy, API, Vite) tournent déjà. Depuis `D:/lume-uiaudit/wt-e2e` :

    E2E_PORT_PROXY=48422 E2E_PORT_API=48303 E2E_PORT_VITE=5194 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/tri-<ton dossier> E2E_JEU=<ton dossier> E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs <ton dossier>/<fichier>.spec.ts --project=bureau [-g "titre"]

- Les trois `E2E_PORT_*` sont OBLIGATOIRES : ils visent le jeu de serveurs réservé au tri (Vite 5194). Sans
  eux tu tomberais sur les serveurs de la passe en cours (5193), qui s'arrêtent quand elle finit.
- `E2E_JEU=<ton dossier>` te donne TES bureaux de test : ne l'oublie pas, sinon tu écris dans ceux d'un autre.
- La première relance crée tes bureaux (une minute) ; les suivantes les retrouvent.
- UN seul worker, une seule commande à la fois, en avant-plan avec un délai long (`timeout` 600000) ou en
  arrière-plan (`run_in_background`) — pas de boucle `sleep`. Le poste est partagé : pas de passe complète
  du dossier plus de deux fois.
- N'arrête ni ne redémarre aucun serveur ni conteneur. Ne lance pas `npm install`, `tsc`, ni Vitest.
- Les sorties vont dans `D:/lume-uiaudit/sorties/…`, jamais dans le dépôt.

## Classer chaque échec
Le marqueur `@defaut` à la fin d'un titre veut dire : « le test affirme le comportement ATTENDU pour un
défaut constaté ; il reste rouge tant que le défaut existe ». Depuis l'écriture des specs (ce matin), cinq
lots de corrections ont été livrés (#859, #866, #870, #876, #881, #889) et d'autres sessions ont livré dans
le produit. Donc :

1. **DÉFAUT** — le produit se trompe encore. Le test garde (ou reçoit) ` @defaut` et reste rouge. Tu
   décris le défaut en mots d'utilisateur : où, quoi faire, ce qu'on voit, ce qu'on devrait voir.
2. **SPEC PÉRIMÉE** — le produit a changé EXPRÈS (un libellé renommé, un champ devenu une liste, un onglet
   « Modèles » devenu « Prêtes à publier », une confirmation ajoutée, un ordre de familles revu…). Tu
   vérifies dans le code du produit ou `git log -p` que le changement est voulu, tu ajustes la spec pour
   qu'elle affirme le NOUVEAU comportement avec la même rigueur, tu la relances : elle doit passer.
3. **ENVIRONNEMENT** — la pile locale n'est pas staging : pas de stockage de fichiers (`/storage/v1` rend
   404), pas de clé d'IA (Lumi ne génère rien), base neuve (aucune donnée d'avant). Si un test ne peut pas
   passer ici pour cette seule raison, dis-le ; ne le modifie pas pour le faire passer.
4. **TEST FRAGILE** — le produit a raison et la spec aussi, mais le test dépend d'un délai, d'un ordre ou
   d'une donnée d'un autre test. Rends-le déterministe (attendre un état, pas un délai).

Un test `@defaut` qui PASSE maintenant : le défaut est corrigé — retire ` @defaut` du titre (rien d'autre)
et note-le. La liste est dans `passe1.txt` (lignes `ok` contenant `@defaut`).

## Interdits
- Affaiblir une attente pour faire passer un test, `skip`, `fixme`, `fail`, tolérance ajoutée au moniteur,
  `retries`. Dans le doute entre « défaut » et « spec périmée » : c'est un DÉFAUT, et tu le dis.
- Conclure sans avoir relancé : une spec réparée est une spec que tu as VUE passer.
- Écrire un script avec un heredoc bash (les `\` y sont mangés) : utilise les outils Write / Edit.

## Ce que tu rends
1. Tes specs réparées, sur disque (pas de commit).
2. Un fichier `D:/lume-uiaudit/sorties/triage/<ton dossier>.md` :

       # <dossier> — N échecs à la passe, après tri : D défauts, P specs réparées, E environnement, F fragiles
       ## Défauts du produit encore ouverts
       | Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
       ## Défauts corrigés depuis (marqueur @defaut retiré)
       ## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)
       ## Environnement
       ## Encore rouge sans conclusion (et pourquoi)

3. Ton message final : les quatre nombres, la commande de ta dernière relance et son résultat (N passés /
   M échoués), et tout ce que tu n'as PAS pu vérifier. Pas de résumé flatteur : ce qui reste rouge, dis-le.
