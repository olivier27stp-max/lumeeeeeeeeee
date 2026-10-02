# Cahier commun — tournée « chaque bouton » de la section Automatisations (Lume CRM)

Tu fais partie d'un audit utilisateur exhaustif de la section **Automatisations** de Lume CRM (CRM pour entreprises de services, React + Vite + Express + Supabase, interface FR/EN ; modèle visé : l'écran Workflows de GoHighLevel). Lancement public le 26 octobre : c'est la passe finale. À la fin, chaque bouton, chaque action, chaque parcours doit fonctionner.

Le principe : **agir comme un vrai utilisateur dans un vrai navigateur** et ne rien conclure de la seule lecture du code. Chaque élément interactif d'une carte déjà dressée (`D:/lume-uiaudit/sorties/map-*.md`) doit être **cliqué et vérifié**, et le résultat doit rester sous forme de **test Playwright permanent** : la tournée et la suite de non-régression sont le même travail.

## Ce qui existe déjà

- **L'app locale tourne** : `http://127.0.0.1:5183` (Vite) → API `http://127.0.0.1:3112`. Ne la démarre pas, ne l'arrête pas, ne tue aucun processus. Base : **staging**. L'API tourne sans tâche de fond et sans aucun fournisseur (Twilio, courriel, Stripe, IA : vides). « Construire avec Lumi » n'est donc PAS branché sur cette instance (une autre passe s'en charge).
- **Bureaux de test en bac à sable** : chaque agent a son propre jeu (bureau A, bureau B, comptes propriétaire / admin / technicien), créé automatiquement par le banc selon `E2E_JEU`. Tout texto, courriel ou webhook d'un bureau de test est retenu dans la table `envois_simules` au lieu de partir. Un test canari l'a prouvé.
- **Le banc Playwright** : `D:/lume-uiaudit/wt/e2e/automations/_outils/banc.ts` — LIS-LE EN ENTIER avant d'écrire une ligne. Exemple d'usage : `e2e/automations/00-banc.spec.ts`. En résumé :
  - `import { test, expect, creerRegle, lireRegle, reglesParNom, envoisSimules, attendre, appelApi, clientDe, ouvrirListe } from '../_outils/banc';`
  - `page` est déjà connectée (propriétaire du bureau A, français). Autre rôle ou langue : `test.use({ compte: 'adminA' | 'techA' | 'proprioB', langue: 'en' })`.
  - **`moniteur` est automatique** : erreur de console, exception, promesse rejetée, requête qui n'aboutit pas, réponse 4xx ou 5xx → le test échoue tout seul. Un 4xx VOULU par le test (validation, refus de permission, panne simulée par `page.route`) se déclare avec `moniteur.attendu(/motif/, 'pourquoi')`, et le test doit alors vérifier le message montré à l'utilisateur.
  - `bureau.admin` : client service_role pour **vérifier en base** ce que l'écran affirme ; `bureau.orgA`, `bureau.orgB`, `bureau.comptes`.
  - `marque` : préfixe unique à mettre dans le NOM de toute règle créée ; le ménage est automatique.
  - `autreOnglet({ compte, langue })` : second onglet (deux onglets, autre rôle). `jetonDe(compte)` + `appelApi(...)` : appel d'API direct sans passer par les boutons. `clientDe(jeton)` : client supabase-js soumis à la RLS.
- **Les cartes** (tirées du code, à recouper avec ce que tu VOIS) :
  - `D:/lume-uiaudit/sorties/map-liste.md` — liste, modèles, éditeurs de message, vue d'ensemble, réglages globaux (IDs LST-, MOD-, MSG-, APR-, REG-) ;
  - `D:/lume-uiaudit/sorties/map-editeur.md` — éditeur plein écran et catalogue (IDs EDT-…) ;
  - `D:/lume-uiaudit/sorties/map-entrees-api.md` — routes, points d'entrée ailleurs (EXT-), API serveur, rôles, Lumi.
  Chaque carte finit par une liste de **soupçons** : ce sont des pistes à trancher à l'écran, pas des faits.
- **Outil d'observation libre** : `D:/lume-uiaudit/outils/nav.mjs` (ouvrir un onglet connecté, moniteur, `inventaire(page)` des éléments interactifs visibles avec position / recouvrement / débordement, `capture(page, nom)`). Sers-t'en dans de petits scripts jetables pour REGARDER l'écran avant d'écrire un test : prends des captures et lis-les avec l'outil Read (tu vois les images). Exemple : `D:/lume-uiaudit/outils/02-releve-ecrans.mjs`. Pour l'utiliser avec TON jeu de bureaux, passe par le banc plutôt (les specs) ; `nav.mjs` ouvre le jeu « uiaudit », à ne modifier qu'en lecture.

## Comment lancer tes tests

Depuis `D:/lume-uiaudit/wt` (remplace NOM par le nom de ton lot, donné dans ta mission) :

```
E2E_BASE=http://127.0.0.1:5183 E2E_JEU=NOM E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-NOM \
PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers \
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts \
  --project=bureau --workers=1 e2e/automations/NOM/
```

- `--project=bureau` = Chromium 1440×900 (le projet de référence). Les autres projets (`ipad-paysage`, `ipad-portrait`, `mobile`, `firefox`, `webkit`) ne lancent que les tests dont le titre contient `@matrice` ; ne t'en sers que si ta mission le demande.
- Toujours `--workers=1` : le poste est partagé par plusieurs sessions.
- Captures et traces des échecs : `D:/lume-uiaudit/sorties/e2e-NOM/resultats/` (lis les `.png` avec Read, et `error-context.md` qui donne l'arbre d'accessibilité de la page au moment de l'échec).
- Pour un script jetable avec nav.mjs : `cd D:/lume-uiaudit/outils && PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers node --env-file=D:/lume-uiaudit/wt/.env.local NOM/mon-script.mjs` (mets tes scripts dans `D:/lume-uiaudit/outils/NOM/`).

## Règles d'écriture des tests

1. **Un fichier de spec par zone**, dans `D:/lume-uiaudit/wt/e2e/automations/NOM/`. Commentaire d'en-tête en français qui dit ce que le fichier prouve.
2. **Le titre de chaque test commence par le ou les ID de la carte qu'il couvre** : `test('[LST-012] le menu ⋮ « Dupliquer » crée une copie indépendante', …)`. Plusieurs ID possibles : `[LST-020][LST-021] …`. C'est ce qui permet de calculer la couverture : un ID sans test = un élément non testé. Si tu trouves à l'écran un élément ABSENT de la carte, donne-lui un ID nouveau dans ta série (`LST-N01`, `EDT-N01`…) et signale-le.
3. Pour chaque élément, dans chaque état où il apparaît, vérifie : il est visible et cliquable ; il fait quelque chose de visible ; c'est la BONNE chose, au BON endroit ; les états sont cohérents (désactivé quand il faut et seulement là, chargement visible, succès confirmé, erreur expliquée) ; le libellé est clair, en bon français, sans clé de traduction brute ni anglais qui traîne ; ce qui est enregistré en base est exactement ce que l'écran affirme (**double vérification écran + base** avec `bureau.admin`), y compris après un rechargement de la page.
4. **Pas de délai fixe** (`waitForTimeout`) : attends un état (`expect(...).toBeVisible()`, `expect.poll`, `attendre(...)`). **Aucune reprise** : un test instable est un bug — trouve pourquoi.
5. Sélecteurs d'utilisateur : `getByRole`, `getByLabel`, `getByText`. Un élément qu'on ne peut atteindre que par une classe CSS est lui-même un constat d'accessibilité (note-le), mais teste-le quand même.
6. TypeScript strict : pas de `any`, pas de `!` sans raison écrite. Style du dépôt : commentaires et titres en français.
7. **Quand le produit a un défaut** : le test affirme le comportement ATTENDU et reste ROUGE. N'affaiblis jamais une attente pour faire passer un test, ne le désactive pas (`skip`, `fixme`, `fail` interdits), n'ajoute pas de tolérance au moniteur pour masquer un vrai problème. Ajoute ` @defaut` à la fin du titre du test et consigne le constat (ci-dessous). C'est une autre passe qui corrigera le produit.
8. Tu ne modifies **AUCUN fichier du produit** (`src/`, `server/`, `supabase/`, `tests/`, config). Tu n'écris que dans `e2e/automations/NOM/`, `D:/lume-uiaudit/outils/NOM/` et `D:/lume-uiaudit/sorties/NOM/`. Si le banc (`_outils/banc.ts`) a un manque ou un bug, ne le modifie pas : décris-le dans ton rapport (un autre agent travaille en même temps avec ce fichier).
9. Pas de `git commit`, `git checkout`, `git stash`, `npm install`, ni de suite vitest complète.

## Sécurité — non négociable

- Staging et bureaux de test seulement. Jamais la production, jamais un autre bureau que ceux du banc.
- Aucun envoi réel n'est possible ; s'il te semble qu'un texto, un courriel ou un webhook est RÉELLEMENT parti (autre chose qu'une ligne dans `envois_simules`), **arrête tout** et dis-le en premier dans ton rapport.
- Ne saisis jamais de vraie adresse courriel ni de vrai numéro : `…@lume-qa.test` et `+1555555 01xx` uniquement.

## Ce que tu livres

Dans `D:/lume-uiaudit/sorties/NOM/` :

1. **`couverture.md`** : un tableau `| ID | Test (fichier › titre) | Résultat |` avec TOUS les ID de ton lot. Résultat : `OK`, `DÉFAUT → C-xx`, ou `NON TESTABLE — pourquoi` (à éviter : cherche d'abord comment provoquer l'état).
2. **`constats.jsonl`** : une ligne JSON par défaut trouvé :
   `{"id":"NOM-01","ids_carte":["LST-012"],"ecran":"…","element":"…","attendu":"…","observe":"…","gravite":"bloquant|majeur|mineur|cosmetique","capture":"chemin .png","test":"fichier › titre","cause_probable":"fichier:ligne — explication courte si tu l'as trouvée"}`
   Gravité : *bloquant* = l'utilisateur ne peut pas faire ce qu'il veut, ou perd des données, ou un message faux part au client ; *majeur* = ça marche mal ou ça trompe ; *mineur* = gêne ; *cosmetique* = texte, alignement.
   Regarde l'écran comme un utilisateur exigeant : un libellé ambigu, un bouton qui ne dit pas ce qu'il a fait, une liste qui clignote, un menu coupé sont des constats.
3. Les specs dans `e2e/automations/NOM/`.

Ta réponse finale, courte : nombre d'ID couverts / total du lot, nombre de tests (verts / rouges), les constats par gravité (une ligne chacun), ce que tu n'as pas pu tester et pourquoi, et tout manque du banc.
