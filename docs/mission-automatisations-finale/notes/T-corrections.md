# Corrections de l'agent T — bibliothèque de modèles, éditeurs de messages, réglages globaux

Worktree `D:/lume-final/wt-t`, branche `mission/auto-finale-t` (rien n'est poussé). Liste de travail : les 49 lignes de
`D:/lume-uiaudit/sorties/triage/modeles.md`, plus les constats A-19, E-64 et A-21. Un commit par ligne (ou par racine
commune).

## En bref

- **32 lignes corrigées dans ma zone**, chacune avec son test de régression. **31 revues à l'écran par la spec
  Playwright d'origine**, rejouée contre mes serveurs (corps vert). La 32e, `04-courriel:834`, a été vue passer par sa
  spec avant la décision sur les deux langues ; depuis, elle est vue au navigateur par mon scénario
  (`verifier.mts courriel834`, 10 contrôles) et sa spec est ROUGE sur sa dernière attente, qui fige l'ancien stockage
  (voir « Specs à mettre à jour »).
- **14 lignes dont le correctif tombe hors zone** : cause établie, test de régression écrit (rouge), et **patch prêt,
  essayé puis retiré**, dans `D:/lume-final/notes/T-a-reporter/`. Pour 9 d'entre elles (le texto de la liste), le
  serveur et l'API sont déjà corrigés : plus rien ne s'écrase ni ne s'enregistre à tort, il manque l'écran. Avec les
  patchs en place, les specs de ces lignes passent (corps vert), sauf `03-texto:345`, rouge pour la même raison que
  `04-courriel:834`.
- **2 lignes qui attendent une décision** (`02-chaque-modele:246`, `06-reglages-globaux:116`) et **1 ligne corrigée
  côté serveur que sa spec ne peut plus voir** (`03-texto:155`).
- **Le contenu d'un message ne s'écrit plus que par le serveur** (complément du coordinateur) : route
  `PATCH /api/automations/rules/:id/messages`, plus aucune écriture directe de `automation_rules` dans
  `src/lib/automationRulesApi.ts`.
- **Les deux décisions du coordinateur du 2026-10-01 sont appliquées** :
  1. *Les deux langues d'un message* — commit `5c8ff0dd`, qui cite et remplace `6e7bc921` et `ceeefc37`. Le champ
     principal porte le texte de la langue dans laquelle le bureau envoie, l'écran dit laquelle ; l'autre langue est
     dans un bloc replié, dépliable et modifiable ; corriger le texte principal seul ne bloque jamais : le bloc se
     déplie, dit « Cette version n'est plus à jour. » et offre « La retirer (vos clients recevront le texte
     ci-dessus) », coché d'office, ou « La garder telle quelle ». Fait dans l'éditeur de courriel et Réglages ›
     Messagerie ; le texto de la liste est dans le patch de `MessageEditor.tsx`. La route porte la langue du texte
     écrit (`langue`) et l'ordre `retirer_autre_version`.
  2. *Le nom d'une copie de modèle* — vérifié, aucun changement de code : la copie n'est numérotée que si une
     automatisation VIVANTE du même bureau porte déjà ce nom (ni corbeille, ni suppression définitive ; un préréglage
     fourni, même en brouillon, compte). Test `nom-copie-vivante.test.ts` (7 cas, la vraie route), commit `58bcd3ca`.
- **Des specs vertes avant deviennent rouges à cause de ces corrections et de ces deux décisions** : elles figent
  l'ancien comportement. Liste complète, avec ce qu'il faut y changer, dans « Specs à mettre à jour ». Je n'ai modifié
  aucun fichier de `e2e/automations/**`.

## Un choix de stockage à connaître (décision 1)

« Retirer l'autre version » quand le texte écrit est l'ANGLAIS (bureau qui envoie en anglais) : le texte de base
`body` ne peut pas disparaître — c'est lui que le moteur envoie faute d'anglais, et la route refuse un message sans
`body`. La route fait donc du texte anglais LE texte du message : `body` (et `subject`) reçoivent l'anglais, `body_en`
et `subject_en` disparaissent. Le message n'a plus qu'un texte, celui que l'écran montrait ; il part quel que soit le
réglage de langue. Dans l'autre sens (texte écrit en français), `body_en` et `subject_en` disparaissent, sans plus.
Si l'agent de l'éditeur applique la même règle dans son panneau d'étape, il faut qu'il stocke pareil.

## Outils

- Tests neufs : `tests/automations-finale/t/` — vrais composants en jsdom, vraie API du navigateur, VRAIE route
  montée dans une app Express de test, sur une fausse base en mémoire partagée par le navigateur et le serveur
  (`faux-supabase.ts`, `serveur-messages.ts`, `banc-composants.tsx`).
- « Rouge sans le correctif » : `bash scripts/qa/finale/t/sans-correctif.sh <fichier(s) du correctif> <test>`.
- Vrai navigateur, pile locale, bureau A « (t) » :
  `QA_AUTO_SUFFIXE=t npx tsx --env-file=.env.local scripts/qa/finale/t/verifier.mts <scénario>`.
- Spec Playwright d'origine rejouée contre mes serveurs (3498 / 5498) :
  `node scripts/qa/finale/t/rejouer-spec.mjs modeles/<fichier>.spec.ts -g "<titre>"`. **La pile locale n'a pas de
  Realtime** : chaque page journalise un WebSocket en 404, que le moniteur du banc compte comme un problème du
  produit. Aucune spec ne peut donc finir « passed » ici. Le lanceur lit le rapport et distingue **CORPS VERT**
  (toutes les attentes du test passent ; le moniteur n'a relevé QUE ce WebSocket) et **ROUGE** (une attente est
  tombée, ou le moniteur a relevé autre chose). « Corps vert » est le meilleur résultat possible sur cette pile.

## Tableau — les 49 lignes du triage `modeles.md`

Légende de la colonne « Vérifié » : **spec** = la spec Playwright d'origine rejouée contre mes serveurs, résultat
« CORPS VERT » (toutes ses attentes passent ; seul le moniteur relève le WebSocket de Realtime, absent de la pile
locale) ; **nav.** = mon scénario `verifier.mts` au vrai navigateur ; **non** = pas vu au navigateur (jsdom seulement).
« AVEC le patch proposé » = vu avec le patch hors zone appliqué dans mon worktree, puis retiré.
Les tests sont dans `tests/automations-finale/t/`.

### Majeurs

| Ligne | État | Commit | Test de régression | Vérifié |
|---|---|---|---|---|
| `02-chaque-modele:131` — 180 cartes pour 23 étapes | **À REPORTER** — SequenceCanvas.tsx | `57853054` (test), `7066c143` (scénario) | `a-reporter-canevas.test.tsx` (rouge ; vert avec le patch) | spec + nav. (`verifier.mts canevas131`), AVEC le patch proposé |
| `03-texto:172` — deux textos, le 2e écrasé | serveur et API corrigés ; **écran À REPORTER** — MessageEditor.tsx | `794b532e`, `0b4715b7` | `messages-api.test.ts`, `texto-liste.test.tsx` (verts) ; `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `04-courriel:816` — deux courriels, le 2e écrasé | corrigé | `794b532e`, `0b4715b7` | `courriel-editeur.test.tsx` « 816 », `messages-api.test.ts` | spec + nav. |
| `04-courriel:394` — lien et gras détruits | corrigé | `fda5a96a` | `courriel-editeur.test.tsx` « 394 et 410 » | spec + nav. |
| `03-texto:345` — bureau anglais, texto français montré | serveur, API et Réglages › Messagerie corrigés, selon la règle des deux langues ; **liste À REPORTER** | `6e7bc921`, `ceeefc37`, puis `5c8ff0dd` (la règle) | `messages-api.test.ts` « anglais », `messages-route.test.ts` « retirer l'autre version », `reglages-messagerie.test.tsx` (10 cas) ; `a-reporter-message-editor.test.tsx` (rouge) | AVEC le patch proposé : le champ montre et modifie l'anglais (attente de la spec verte) ; la spec finit ROUGE sur sa dernière attente (`body_en`), à mettre à jour |
| `04-courriel:834` — bureau anglais, courriel français montré | corrigé, selon la règle des deux langues | `6e7bc921`, puis `5c8ff0dd` (la règle) | `courriel-editeur.test.tsx` « 834 et la règle des deux langues » (13 cas) | nav. (`verifier.mts courriel834`, 10 contrôles). Spec : corps vert avant la décision ; depuis, ROUGE sur sa dernière attente (`subject_en`), à mettre à jour |
| `04-courriel:725` — `[company_name]` d'un autre bureau | corrigé | `fae83c4e` | `apercu-nom-bureau.test.ts` | spec + nav. |
| `03-texto:316` — 1 700 caractères enregistrés | serveur corrigé (refus 400) ; **bouton grisé À REPORTER** | `0b4715b7` | `messages-route.test.ts` « 316 » ; `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `06-reglages-globaux:299` — « Active » à l'écran, `false` en base | corrigé | `d80a08ee` | `adresses-appel.test.tsx` | spec |

### Mineurs et cosmétiques

| Ligne | État | Commit | Test de régression | Vérifié |
|---|---|---|---|---|
| `04-courriel:260` — l'éditeur disparaît après « Enregistrer » | ma part faite (l'éditeur dit « Aucune modification » sans attendre la liste) ; **la disparition est À REPORTER** — Automations.tsx | `794b532e` | `courriel-editeur.test.tsx` « 260 » | spec, AVEC le patch proposé (ROUGE sans lui) |
| `04-courriel:410` — 1er paragraphe enregistré en titre | corrigé | `fda5a96a` | `courriel-editeur.test.tsx` « 394 et 410 » | spec + nav. |
| `03-texto:363` — texto modifiable dans la corbeille | serveur corrigé (409) ; **lecture seule À REPORTER** | `0b4715b7` | `messages-route.test.ts` « 363 » ; `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `03-texto:155` — erreur SQL brute | corrigé côté serveur et API (une phrase) ; **PAS VU à l'écran** | `0b4715b7` | `messages-route.test.ts` « 155 » | non — la spec intercepte PostgREST, que l'écran n'appelle plus : elle reste ROUGE tant qu'elle n'est pas mise à jour |
| `03-texto:237` — « Insérer » en fin de texte | **À REPORTER** — MessageEditor.tsx | — | `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `04-courriel:538` — « Insérer » en fin de ligne | corrigé | `b0a2b1ab` | `courriel-editeur.test.tsx` « 538 et 547 » | spec |
| `04-courriel:547` — « Insérer » sans effet sur courriel vide | corrigé | `b0a2b1ab` | idem | spec |
| `04-courriel:560` — « Insérer » actif sur l'aperçu | corrigé | `d96b8520` | `courriel-editeur.test.tsx` « 560 et 588 » | spec |
| `03-texto:259` — « Le client lira » garde le crochet | **À REPORTER** — MessageEditor.tsx | — | `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `04-courriel:620` — `[prenom]` non signalé | corrigé | `d3ec3bed` | `courriel-editeur.test.tsx` « 620 » | spec |
| `03-texto:306` — SMS comptés sur le nom des variables | **À REPORTER** — MessageEditor.tsx | — | `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `04-courriel:793` — « Envoi impossible » sans raison | corrigé | `aba755be` | `essai-courriel-api.test.ts`, `courriel-editeur.test.tsx` « 793 », `apercu-nom-bureau.test.ts` « 793 » | spec |
| `04-courriel:588` — « M'envoyer un essai » hors de vue | corrigé | `d96b8520` | `courriel-editeur.test.tsx` « 560 et 588 » | spec |
| `04-courriel:366` — objet de 300 caractères sans signal | corrigé | `6a5a21a1` | `courriel-editeur.test.tsx` « 366 » | spec |
| `04-courriel:201` — « Confirmer » ne dit pas quoi | corrigé | `12f1cde1` | `courriel-editeur.test.tsx` « 201 » | spec |
| `04-courriel:212` — focus hors de la fenêtre | corrigé | `0bf80a97` | `courriel-editeur.test.tsx` « 212 » | spec |
| `04-courriel:443` — ligne ajoutée sans curseur | corrigé | `1c250049` | `courriel-editeur.test.tsx` « 443 » | spec |
| `04-courriel:478` — corbeille invisible au clavier | corrigé | `6fbab0d6` | `courriel-editeur.test.tsx` « 478 » | spec |
| `04-courriel:683` — onglet actif non annoncé | corrigé | `02f15873` | `courriel-editeur.test.tsx` « 683 » | spec |
| `04-courriel:895` — refus en français en interface anglaise | corrigé (le serveur parle la langue de l'interface) | `0b4715b7` | `messages-route.test.ts` « 895 » | spec |
| `03-texto:438` — exemples français en interface anglaise | bibliothèque d'exemples et aperçu serveur corrigés ; **une ligne À REPORTER** — MessageEditor.tsx | `9c0d3c50` | `exemples-variables.test.ts`, `apercu-nom-bureau.test.ts` ; `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `03-texto:113` — blanc au lieu de « — » (cosmétique) | **À REPORTER** — MessageEditor.tsx | — | `a-reporter-message-editor.test.tsx` (rouge) | spec, AVEC le patch proposé |
| `01-bibliotheque:489` — Échap pendant la création | corrigé | `e9cca3fa` | `bibliotheque.test.tsx` « 489 » | spec |
| `01-bibliotheque:525` — « Failed to fetch » (création) | corrigé | `9006897a` | `bibliotheque.test.tsx` « 525, 568 et 626 » | spec |
| `01-bibliotheque:568` — « Failed to fetch » (chargement) | corrigé | `9006897a` | idem | spec |
| `01-bibliotheque:626` — raison en français sous titre anglais | corrigé | `9006897a` | idem | spec |
| `01-bibliotheque:328` — remise à zéro à moitié | corrigé | `81a4f3fc` | `bibliotheque.test.tsx` « 328 » | spec |
| `02-chaque-modele:246` — copie nommée en français en interface anglaise | **À REPORTER et À DÉCIDER** — automation-rules.ts | `fd0003ee` (test) | `a-reporter-nom-copie.test.ts` (rouge ; vert avec le patch) | non — spec ROUGE (attendu) ; le patch n'a été essayé qu'en test |
| `02-chaque-modele:263` — aperçu en anglais sans dire que le français partira | corrigé | `bd3f287e` | `bibliotheque.test.tsx` « 263 » | spec |
| `02-chaque-modele:351` — deux « Contrat signé » dans la liste | corrigé ; règle confirmée par le coordinateur (numéroté seulement si une automatisation vivante du bureau porte déjà ce nom) | `c2bbf982`, `58bcd3ca` (test de la règle) | `bibliotheque.test.tsx` « 351 », `nom-copie-vivante.test.ts` (7 cas) | spec |
| `05-vue-ensemble:155` — tuile 1, liste 1 + 1 | **À REPORTER** — automationJournauxApi.ts | `b0a2b1ab` (le test y est entré par mégarde) | `a-reporter-vue-ensemble.test.tsx` (rouge ; vert avec le patch) | spec, AVEC le patch proposé |
| `05-vue-ensemble:209` — « 0 » quand l'activité est illisible | **À REPORTER** — automationJournauxApi.ts + AutomationsApercu.tsx | idem | idem | spec, AVEC le patch proposé |
| `05-vue-ensemble:173` — « 1 envoi(s) ont échoué » (cosmétique) | **À REPORTER** — AutomationsApercu.tsx | idem | idem | spec, AVEC le patch proposé |
| `06-reglages-globaux:467` — « Aucune adresse » quand la lecture échoue | corrigé | `8b05c5e6` | `adresses-appel.test.tsx` « 467 » | spec |
| `06-reglages-globaux:183` — refus sans la raison | corrigé | `ed803c8d` | `adresses-appel.test.tsx` « 183 » | spec |
| `06-reglages-globaux:198` — trois adresses au même nom | corrigé | `61a85fd6` | `adresses-appel.test.tsx` « 198 » | spec |
| `06-reglages-globaux:329` — bouton « Active » sans état | corrigé | `54a47035` | `adresses-appel.test.tsx` « 329 » | spec |
| `06-reglages-globaux:72` — carte « Mettre en pause » (cosmétique) | corrigé | `b9c31c6f` | `reglages-globaux.test.tsx` « 72 » | spec |
| `06-reglages-globaux:116` — deux endroits pour la langue (cosmétique) | la carte le dit désormais ; **la spec reste ROUGE** : elle exige de retirer le sélecteur de la liste (Automations.tsx, hors zone — à décider) | `039fcd61` | `reglages-globaux.test.tsx` « 116 » | spec : ROUGE (attendu) |
| `06-reglages-globaux:544` — « endpoint » / « address » (cosmétique) | corrigé | `8daeb316` | `adresses-appel.test.tsx` « 544 » | spec |

### Les trois constats ajoutés

| Constat | État | Commit | Test |
|---|---|---|---|
| A-19 — Réglages › Messagerie ne liste ni « Facture en retard » ni les automatisations de Lumi | corrigé | `c865319d` | `reglages-messagerie.test.tsx` « A-19 » (6 cas) — non vu au navigateur |
| E-64 — pas de compteur de SMS dans Réglages › Messagerie et Avis clients | corrigé (les deux pages) | `725391ea` | `reglages-messagerie.test.tsx` « E-64 » — non vu au navigateur ; Avis clients : lecture du code seulement |
| A-21 — un courriel en texte brut part en un seul bloc | **À REPORTER — moteur** ; dans l'éditeur, un texte brut s'ouvre en paragraphes | `fda5a96a` (éditeur) | `courriel-editeur.test.tsx` « un courriel écrit en texte brut » |

## Specs à mettre à jour (par la session qui tient les specs — je n'ai touché à aucun fichier de `e2e/`)

Toutes étaient vertes avant (sauf les `@defaut` signalées) et sont rouges à cause d'une correction demandée par le
triage ou d'une des deux décisions du 2026-10-01.

### À cause de la décision 2 — le nom d'une copie de modèle (`02-chaque-modele:351`, commit `c2bbf982`)

Le bureau de test porte les préréglages fournis ; une copie d'un modèle du même nom s'appelle donc « <nom> (2) ».
Ces specs attendent le nom nu. Elles doivent accepter « <nom> » ou « <nom> (n) » selon ce que le bureau contient déjà.

| Spec | Ce qu'elle attend | Ce qu'elle reçoit |
|---|---|---|
| `01-bibliotheque:102`, l. 111 | `['Contrat signé']` | `['Contrat signé (2)']` |
| `01-bibliotheque:444`, l. 454-455 | `name: 'Contrat signé'`, et le bouton de l'éditeur à ce nom | « Contrat signé (2) » |
| `01-bibliotheque:465`, l. 470 | `['Contrat signé']` | `['Contrat signé (2)']` |
| `02-chaque-modele:131` — 19 des 43 cas français : `agreement_signed`, `appointment_confirmation`, `deposit_followup_2d`, `deposit_reminder`, `invoice_sent_reminder_1d` / `_3d` / `_7d` / `_14d`, `job_reminder_7d`, `lead_followup_1d` / `_3d` / `_14d`, `payment_confirmation`, `quote_followup_1d` / `_3d` / `_7d` / `_14d` / `_21d`, `reengagement_90d` | `verifierCopie(…, m.nom.fr, …)` (l. 56) et le bouton de l'éditeur au nom nu | « <nom> (2) » |
| `02-chaque-modele:198`, cas `payment_confirmation` | idem, en interface anglaise | « Confirmation de paiement (2) » |

Le 20e cas rouge de `02:131` (`pack_relance_devis`, le `@defaut`) est le canevas, hors zone : corps vert avec le patch.

### À cause de la décision 1 — les deux langues d'un message (commit `5c8ff0dd`, et le patch de `MessageEditor.tsx`)

| Spec | Pourquoi elle tombe | Ce qu'il faut y changer |
|---|---|---|
| `04-courriel:834` (`@defaut`) | tout passe jusqu'à la dernière attente : après « Enregistrer » sans autre geste, elle lit `config.subject_en`. Avec « La retirer » coché d'office, le français est retiré et l'anglais devient le seul texte : la correction est dans `config.subject`, il n'y a plus de `subject_en` | lire `config.subject` ; ou cocher « La garder telle quelle » avant « Enregistrer » pour garder l'attente sur `subject_en` |
| `03-texto:345` (`@defaut`) — une fois le patch de `MessageEditor.tsx` appliqué | même chose : elle lit `config.body_en` | lire `config.body`, ou cocher « La garder telle quelle » |
| `03-texto:190` — une fois le patch de `MessageEditor.tsx` appliqué | le texto du test porte `body_en: 'Hello'` ; elle corrige le français et attend `body_en` intact. Avec « La retirer » coché d'office, `body_en` est retiré | attendre le texto sans `body_en` ; ou cocher « La garder telle quelle » avant « Enregistrer » |

### À cause des corrections demandées par le triage

| Spec | Pourquoi elle tombe | Ce qu'il faut y changer |
|---|---|---|
| `04-courriel:502` (chaque bouton « Insérer ») | elle clique au CENTRE du champ avant chaque bouton, puis attend la variable en FIN de texte ; dès que le texte dépasse le milieu du champ, ce clic pose le curseur au milieu, et la variable s'y insère — ce que `04:538` demande | après `objet(page).click()` et `blocs(page).nth(1).click()`, appuyer sur Fin (ou `focus()` sans clic) |
| `04-courriel:353` (objet de 300 caractères enregistré en entier) | la route applique la borne du catalogue : 200 caractères pour un objet | objet ≤ 200 ; le paragraphe de 5 000 caractères passe toujours |
| `04-courriel:375` et `03-texto:137` (panne à l'enregistrement) | elles simulent la panne sur `**/rest/v1/automation_rules**` (PATCH) ; l'écran n'écrit plus par PostgREST | simuler sur `**/api/automations/rules/*/messages` ; le message attendu devient celui du serveur |
| `03-texto:155` (`@defaut` — erreur SQL brute) | même interception ; côté serveur la panne donne « Enregistrement impossible pour le moment : rien n'a été modifié. Réessayez dans un instant. » (`messages-route.test.ts`) | même changement d'adresse ; l'attente (`/Enregistrement impossible|Réessayez/`) passera |
| `04-courriel:159` et `04-courriel:859` | elles cliquent « Confirmer » / « Confirm » dans la confirmation de fermeture, renommé « Fermer sans enregistrer » / « Close without saving » par `04:201` | cliquer le nouveau libellé |
| `06-reglages-globaux:515`, l. 541 | elle attend deux adresses au même nom (`['My website form', 'My website form']`) ; `06:198` demande des noms distincts : la seconde s'appelle « My website form (2) » | attendre le nom numéroté |

### Seulement une fois les patchs hors zone appliqués

| Spec | Pourquoi elle tombe | Ce qu'il faut y changer |
|---|---|---|
| `04-courriel:273` — après le patch d'`Automations.tsx` | l'éditeur ne disparaît plus après « Enregistrer » (c'est `04:260`) : le texte attendu existe alors deux fois à l'écran (bloc compact ET éditeur resté ouvert), et le localisateur strict refuse | viser le bloc compact, ou fermer l'éditeur avant de regarder |
| `05-vue-ensemble:115` et `05-vue-ensemble:269` — après le patch d'`AutomationsApercu.tsx` | elles attendent l'ancienne phrase « 1 envoi(s) ont échoué… » / « 1 send(s) failed in the last 7 days. », que `05:173` demande de changer | attendre « 1 action a échoué ces 7 derniers jours. » / « 1 action failed in the last 7 days. » |

### Une spec qui me paraît fausse sur le fond

`06-reglages-globaux:116` n'accepte qu'une issue (retirer le sélecteur « FR / EN » de la liste). Voir « À décider ».

## Blocs « À REPORTER » (fichiers hors de ma zone)

Chaque patch a été APPLIQUÉ dans mon worktree, vérifié (tests, et specs quand c'est dit), puis RETIRÉ : mon arbre ne
contient aucun de ces changements. Les patchs sont dans `D:/lume-final/notes/T-a-reporter/` (`git apply <fichier>`
depuis la racine d'un worktree à jour de ma branche).

### À REPORTER — src/components/automations/MessageEditor.tsx (agent de l'éditeur)
Patch : `T-a-reporter/MessageEditor.patch`. Ferme, côté écran, `03-texto:172`, `:345`, `:316`, `:363`, `:237`, `:259`,
`:306`, `:438`, `:113`. Tests : `tests/automations-finale/t/a-reporter-message-editor.test.tsx` (19 cas, tous verts
avec le patch ; 17 rouges sans lui). Le patch a été refait après la décision sur les deux langues (`538fba60`) ; il a
besoin du commit `5c8ff0dd` (le composant `AutreVersionMessage` et la route).
Ce que le patch change, dans l'ordre du fichier :
1. **Quatre propriétés** : `rang` (rang du message parmi ceux du même type), `bodyEn` (`body_en`), `langueBureau`
   (`'fr' | 'en' | null`), `lectureSeule` (automatisation à la corbeille).
2. **Les deux langues** (`03:345`, règle du coordinateur du 2026-10-01) : le champ « Texto envoyé au client » montre
   et modifie le texte qui PART (l'anglais si le bureau envoie en anglais et que `body_en` existe), et une phrase dit
   dans quelle langue les messages partent ; l'autre langue est dans le bloc replié `AutreVersionMessage` (le même
   composant que l'éditeur de courriel et Réglages › Messagerie, déjà dans ma branche), dépliable et modifiable.
   Corriger le texte principal sans l'autre ne bloque rien : le bloc se déplie, dit « Cette version n'est plus à
   jour. » et offre « La retirer (vos clients recevront le texte ci-dessus) » — coché d'office — ou « La garder telle
   quelle ».
3. **Un seul message écrit** (`03:172`) : `updateRuleMessage(ruleId, 'send_sms', texte, undefined, { rang, corpsLu: body })`
   dans le cas courant ; `ecrireMessageDeRegle(…, { body?, body_en?, retirer? }, cible)` dès que l'autre langue est
   écrite ou retirée. Après un enregistrement, le champ repart du texte enregistré (`useEffect` sur `body` / `bodyEn`).
4. **1 600 caractères** (`03:316`) : au-delà, la phrase « Un texto fait 1 600 caractères au plus… » et « Enregistrer »
   grisé ; la borne vient du catalogue (`trouverAction('send_sms')`).
5. **Corbeille** (`03:363`) : champ en lecture seule, ni « Insérer » ni « Enregistrer » ni « Modifier » (courriel), et
   « Cette automatisation est à la corbeille : restaurez-la pour modifier ses messages. »
6. **« Insérer » au curseur** (`03:237`) : la variable va là où est le curseur (à la fin tant qu'on ne l'a pas mis dans
   le champ).
7. **« Le client lira »** : variables inconnues remplacées par du vide (`03:259`), « — » pour un texte fait d'espaces
   (`03:113`), exemples dans la langue de l'interface (`remplacerVariables(texte, fr)`, `03:438`).
8. **Nombre de SMS** (`03:306`) : compté sur le texte que le client lira (`libelleSegments(remplacerVariables(texte, fr), fr)`).

Tests EXISTANTS que ce patch oblige à adapter (ils figent l'ancien code) :
- `tests/automation/front-automations-ecran.test.tsx` l. 500 : `toHaveBeenCalledWith(RULE_ID, 'send_sms', texte)` —
  l'appel porte maintenant la cible en 5e argument ;
- `tests/emails/automation-editeur.test.ts` : `libelleSegments(texte, fr)` et
  `disabled={!modifie || vide || enregistrement}` (devient `disabled={!enregistrable}`) ;
- `tests/emails/email-body-text.test.ts` l. 232 : `libelleSegments(texte, fr)`.

### À REPORTER — src/pages/Automations.tsx (agent des statistiques et journaux)
Patch : `T-a-reporter/Automations.patch` (trois endroits).
1. `load(options: { silencieux?: boolean } = {})` : `if (!options.silencieux) setLoading(true);` — et
   `onSaved={() => { void load({ silencieux: true }); }}` sur `<MessageEditor>`. C'est la cause de `04-courriel:260` :
   `load` (l. 557) remplace le tableau par la roue, ce qui démonte la ligne dépliée, donc l'éditeur de courriel resté
   ouvert. Avec ce changement l'éditeur reste ouvert et dit « Aucune modification » (ma part, déjà faite, commit `794b532e`).
2. Les quatre propriétés passées à `<MessageEditor>` (l. ~2250) :
   `rang={messages.slice(0, i).filter((m) => m.type === a.type).length}`,
   `bodyEn={typeof a.config?.body_en === 'string' ? a.config.body_en : undefined}`,
   `langueBureau={langueIllisible ? null : orgLang ?? undefined}`, `lectureSeule={!!rule.deleted_at}`
   (avec `.map((a, i, messages) => …)`).
3. `06-reglages-globaux:116` — À DÉCIDER : la spec n'accepte qu'une issue, retirer le sélecteur « FR / EN » de la
   liste (l. ~1355-1372) puisque la langue se règle dans Paramètres. J'ai fait dire à la carte des Réglages globaux
   que ce sélecteur change le même réglage (commit `039fcd61`) ; retirer le sélecteur est un choix de produit.

### À REPORTER — src/components/automations/SequenceCanvas.tsx (agent de l'éditeur) — `02-chaque-modele:131`
Patch : `T-a-reporter/SequenceCanvas.patch`. Test : `a-reporter-canevas.test.tsx` (23 cartes pour 23 étapes avec le patch).
Cause : `rendre` (l. 282-327) déroule les deux branches d'un « Si » jusqu'au bout, chacune de son côté ; `vues` ne
protège que d'une boucle le long d'UN chemin. Une étape où les branches se rejoignent est dessinée une fois par chemin
(cinq « Si » de suite : 32 copies de chaque relance, 180 cartes).
Correctif : `jonction(si)` = la première étape de la branche « oui » que la branche « non » atteint aussi ;
`rendre(id, vues, arret)` s'arrête à la jonction (un trait au lieu de « fin ») ; la suite commune est dessinée UNE fois
sous les deux branches, sous une pastille « ensuite, dans les deux cas ». Les tests existants du canevas restent verts.
Vu au navigateur avec le patch (`verifier.mts canevas131` : 23 cartes pour 23 étapes) et par la spec d'origine
(corps vert). Le rendu reste à regarder par l'agent de l'éditeur : la suite commune est centrée sous les deux branches.

### À REPORTER — src/lib/automationJournauxApi.ts et src/pages/AutomationsApercu.tsx (agent des statistiques)
Patch : `T-a-reporter/AutomationsApercu-et-automationJournauxApi.patch`. Test : `a-reporter-vue-ensemble.test.tsx`
(5 cas, verts avec le patch).
- `05-vue-ensemble:155` — `activiteParSemaine` dédoublonne par (semaine, fiche, événement) : la RÈGLE n'est pas dans
  la clé, donc deux automatisations déclenchées par le même prospect comptent pour une. Correctif : lire aussi
  `automation_rule_id` et l'ajouter à la clé.
- `05-vue-ensemble:209` — la même fonction avale l'échec de lecture (elle journalise puis rend `{ total: 0 }`).
  Correctif : elle lève après avoir journalisé (« [apercu] activité par semaine », que la spec attend) ; la page garde
  `activiteIllisible`, affiche « — » dans la tuile et « Les déclenchements n'ont pas pu être lus pour le moment.
  Réessayez dans un instant. » à la place de la courbe — sans second `console.error` (le moniteur de la spec n'en
  attend qu'un).
- `05-vue-ensemble:173` — « N envoi(s) ont échoué » : « 1 action a échoué ces 7 derniers jours. » / « N actions ont
  échoué… » (et l'anglais).

### À REPORTER et À DÉCIDER — server/routes/automation-rules.ts (agent de l'éditeur) — `02-chaque-modele:246`
Patch : `T-a-reporter/automation-rules.patch` (une ligne, l. 770). Test : `a-reporter-nom-copie.test.ts`.
Cause : `POST /api/automations/templates/utiliser` nomme la copie (et choisit sa description) d'après la langue des
MESSAGES du bureau (`default_language`), pas d'après celle de l'INTERFACE (`Accept-Language`, que l'écran envoie
déjà). Correctif : `const en = langueDe(req) === 'en';`.
**C'est une décision, pas un oubli** : `tests/automation/bibliotheque-modeles-route.test.ts` (« langue d'automatisation
de l'entreprise : nom anglais si "en" ») fige la règle actuelle et devient rouge avec le patch.

### À REPORTER — server/index.ts (coordinateur)
Monter le routeur des messages, juste après celui des règles (il hérite de `reglesLimiter`, déjà posé sur
`/api/automations/rules`). Fait dans CE worktree seulement, commit séparé `24628d4d` :
```ts
import automationMessagesRouter from './routes/automation-messages';
// …
app.use('/api', automationRulesRouter);
// Le texte d'un message d'automatisation : PATCH /api/automations/rules/:id/messages.
app.use('/api', automationMessagesRouter);
```

### À REPORTER — server/lib/route-permissions.ts
Le chemin n'est PAS dans la table des gardes RBAC : sans entrée, le middleware laisse passer (« No rule found — let
route handler's own auth handle it »). La route vérifie donc elle-même `automations.update`
(`messages-route.test.ts` « sans le droit… : 403 »). À ajouter, à côté de `'PATCH /api/automations/rules/:id'` :
```ts
  // Le texte d'un message (texto, courriel) : même droit que modifier la règle.
  'PATCH /api/automations/rules/:id/messages': 'automations.update',
```

### À REPORTER — tests/automation/rbac-routes-automatisations.test.ts
Ajouter `'automation-messages.ts'` à la liste `fichiers` (l. 29), APRÈS la ligne de la table ci-dessus (sinon ce test
devient rouge).

### À REPORTER — moteur (`server/lib/actions/index.ts`, l. 1330 et 1485) — constat A-21
Un courriel dont le corps est du TEXTE BRUT (ce que Lumi écrit : `"Bonjour …,\n\nVotre facture…"`) part en un seul
bloc : le moteur colle le corps tel quel dans le gabarit HTML. La cause n'est pas dans le rendu d'aperçu que je
possède (`POST /api/emails/apercu` reçoit le HTML que l'éditeur construit). Dans l'éditeur, un corps en texte brut
s'OUVRE désormais en paragraphes, une ligne chacun, et l'« Aperçu réel » les montre — mais tant que personne ne
l'enregistre depuis l'éditeur, c'est le texte brut qui part : l'aperçu est alors plus beau que l'envoi. Correctif à
faire au moteur : un corps sans balise de bloc passe par `texteVersHtml` (`src/lib/emailBodyText.ts`, déjà copié
dans l'image) avant le gabarit. Test rouge existant :
`tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts`.

### Information — fichiers hors de toute zone que j'ai créés ou modifiés (aucun autre agent n'y touche à ce jour)
- `src/components/automations/AutreVersionMessage.tsx` (NOUVEAU, `5c8ff0dd`) : le bloc de l'autre langue et la phrase
  « Vos messages partent en… ». L'agent de l'éditeur peut s'en servir tel quel dans son panneau d'étape pour que les
  quatre écrans disent la même chose ;
- `src/lib/emailTemplatesApi.ts` (`envoyerEssaiCourriel` : la raison d'un essai refusé — seul appelant : l'éditeur de courriel) ;
- `src/lib/emailBodyText.ts` (`remplacerVariables(texte, fr = true)` : exemples anglais ; second argument facultatif) ;
- `src/pages/SettingsReviews.tsx` (compteur de SMS — le constat E-64 la nomme) ;
- `tests/support/carte-app-empreinte.json` (régénérée deux fois, `f15fa73f` puis `7c735ddf` : mes pages ont changé de libellés — à régénérer à la fusion) ;
- quatre tests existants ADAPTÉS, aucun affaibli : `tests/emails/email-body-text.test.ts`,
  `tests/emails/automation-editeur.test.ts`, `tests/automatisations-v4-message.test.tsx` (ils figeaient
  l'écriture directe dans la table et `texteVersHtml(blocsEnTexte(blocs))` ; ils vérifient les mêmes règles là où elles
  vivent maintenant).
- Le schéma Zod de la route (`corpsMessageSchema`) vit dans `server/routes/automation-messages.ts`, `validation.ts`
  étant hors zone.

## Écritures directes de `automation_rules` / `automation_webhooks` dans ma zone (complément du coordinateur)

- `src/lib/automationRulesApi.ts` : **plus aucune**. Le texte d'un message passe par
  `PATCH /api/automations/rules/:id/messages` ; publier / dépublier (`toggleAutomationRule`) passait déjà par le
  serveur (`changerPublication`). Il n'y reste que des LECTURES de `automation_rules` (liste, relecture d'un message).
- `src/components/automations/AdressesDAppel.tsx` : créer, activer / désactiver, régénérer et supprimer une adresse
  passaient DÉJÀ par des routes (`/api/automations/webhooks…`, `src/lib/automationWebhooksApi.ts`) ; « Tout arrêter »
  aussi (`/api/automations/pause`). Rien à changer.
- Reste, hors de ces deux tables : `setAutomationLanguage` écrit `company_settings.default_language` directement
  (avec `.select()` : 0 ligne = refus dit à l'écran). Non touché — ce n'est pas le contenu d'une automatisation.
- Garde RBAC : le chemin de la nouvelle route n'est PAS dans `server/lib/route-permissions.ts` (bloc « À REPORTER »
  plus haut) ; la route vérifie elle-même `automations.update`.

## À décider (Rafba / coordinateur)

1. **`06-reglages-globaux:116`** — la langue des messages se change à deux endroits (Paramètres, et le sélecteur
   « FR / EN » de la liste). La spec n'accepte qu'une issue : retirer le sélecteur de la liste. J'ai seulement fait
   dire à la carte que c'est le même réglage (`039fcd61`) ; retirer le sélecteur = `src/pages/Automations.tsx`, hors zone.
2. **`02-chaque-modele:246`** — le nom d'une copie de modèle suit-il la langue de l'INTERFACE (ce que la spec demande)
   ou celle des MESSAGES du bureau (ce qu'un test existant fige) ? Le patch d'une ligne est prêt pour la première réponse.
3. **`04-courriel:834` et `03-texto:345`** — ces deux lignes majeures ne peuvent plus être prouvées par leur spec telle
   qu'elle est écrite : la décision sur les deux langues (« La retirer » d'office) change ce qu'elles lisent en base à
   la fin. Soit les specs sont mises à jour (voir plus haut), soit le choix d'office devient « La garder » — je n'ai
   pas tranché, j'ai appliqué la règle reçue.
4. **Objet d'un courriel : 200 caractères** — la borne du catalogue, que la route applique maintenant aussi à la liste
   et aux Réglages (elle ne valait que dans l'éditeur plein écran).
5. **Les quatre fichiers `a-reporter-*`** sont sous `tests/`, que la CI lance : ils la rendront rouge tant que les
   patchs ne sont pas appliqués. À fusionner avec les patchs, ou à déplacer d'ici là.

## Résultats

### Fin des majeurs
- `npm run lint` (`tsc --noEmit`) : **propre** (code 0).
- `npx vitest run --maxWorkers=3 --exclude "tests/automations-finale/**"` (la configuration écarte déjà
  `tests/quarantaine`) : **596 fichiers passés, 10 sautés ; 7 625 tests passés, 12 « échec attendu », 399 sautés ;
  0 échec** (237 s).

### Fin du lot, avant les deux décisions (arbre propre du commit `7066c143`)
- `npm run lint` : **propre** (code 0).
- La même suite : **596 fichiers passés, 10 sautés ; 7 625 tests passés, 12 « échec attendu », 399 sautés ; 0 échec**
  (234 s).

### Après les deux décisions (arbre propre du dernier commit, `7c735ddf`)
- `npm run lint` : **propre** (code 0) — lancé sur l'arbre du commit `538fba60` ; le commit suivant ne change qu'un
  fichier JSON.
- `npx vitest run --maxWorkers=3 --exclude "tests/automations-finale/**"`, lancée UNE fois, sur `538fba60` :
  **593 fichiers passés, 3 en échec, 10 sautés ; 7 623 tests passés, 3 en échec, 12 « échec attendu », 399 sautés**
  (505 s — deux fois la durée habituelle, le poste était chargé). Les trois échecs :
  - `tests/support/carte-app-fraicheur.test.ts` — dû à mon changement (libellés de Réglages › Messagerie) : carte
    relue, empreinte régénérée, commit `7c735ddf` ;
  - `tests/lumi-agent.test.ts` (« le tour utilise le modèle et l'effort du palier ») et
    `tests/automation/bibliotheque-modeles-lot2-ecran.test.tsx` (« AUCUN modèle servi ne montre une clé… ») — deux
    dépassements du délai de 10 s, sans assertion tombée.
  Ces trois fichiers relancés seuls ensuite : **3 fichiers passés, 83 tests passés**. Je n'ai PAS relancé la suite
  entière après cela : « 0 échec » n'a donc pas été vu d'un seul tenant sur le dernier commit.
- `npx vitest run --maxWorkers=2 tests/automations-finale/t` : 16 fichiers — **12 passés, 4 rouges ; 177 tests passés,
  25 rouges**. Les 25 rouges sont TOUS dans les quatre fichiers `a-reporter-*`, rouges exprès jusqu'au report (verts
  avec les patchs de `T-a-reporter/`).

### Specs Playwright d'origine, rejouées contre mes serveurs (pile locale, jeu `t`)
Aucun test ne peut finir « passed » sur cette pile (WebSocket de Realtime en 404, que le moniteur compte) : « corps
vert » = toutes les attentes du test passent. Sorties dans `D:/lume-final/sorties/`.

| Rejeu | Sortie | Tests | Corps verts | Rouges |
|---|---|---|---|---|
| `01-bibliotheque` entier (sans patch) | `e2e-t-0102-entier.txt` | 48 | 45 | 3 : `:102`, `:444`, `:465` (le nom numéroté) |
| `02-chaque-modele` entier (sans patch) | `e2e-t-0102-entier.txt` | 58 | 36 | 22 : 19 cas de `:131` et `:198` (le nom numéroté), `:131` `pack_relance_devis` (canevas, hors zone), `:246` (à décider) |
| `02-chaque-modele:131` `pack_relance_devis`, avec le patch du canevas | `e2e-t-02-131-avec-patch.txt` | 1 | 1 | 0 |
| `03-texto` entier, avec les patchs de `MessageEditor.tsx` (règle des deux langues) et d'`Automations.tsx` | `e2e-t-03-avec-patch-langues.txt` | 24 | 20 | 4 : `:137`, `:155` (PostgREST), `:190`, `:345` (deux langues) |
| `04-courriel` entier, après la règle des deux langues (sans patch) | `e2e-t-04-langues.txt` | 48 | 41 | 7 : `:159`, `:859`, `:353`, `:375`, `:502`, `:260` (correctif hors zone), `:834` (deux langues) |
| `04-courriel:260`, `:273`, `:834`, avec le patch d'`Automations.tsx` | `e2e-t-04-avec-patch-langues.txt` | 3 | 1 (`:260`) | 2 : `:273`, `:834` |
| `05-vue-ensemble` entier, avec son patch | `e2e-t-05-avec-patch.txt` | 13 | 11 | 2 : `:115`, `:269` |
| `06-reglages-globaux` entier (sans patch ; avant la règle des deux langues, qui ne touche pas cet écran) | `e2e-t-06.txt` | 30 | 28 | 2 : `:116`, `:515` |

Chaque rouge de ce tableau est expliqué dans « Specs à mettre à jour » ou « À décider ». Avant la règle des deux
langues, `04:834` et `03:345` étaient corps verts (`e2e-t-04-final.txt`, `e2e-t-03-avec-patch.txt`).
`e2e-t-0102.txt` (22 h 11) est un rejeu de 01 et 02 tout rouge dont je n'ai pas établi la cause ; refait deux fois
depuis (`e2e-t-0102-final.txt`, `e2e-t-0102-entier.txt`), il donne le tableau ci-dessus.

### État laissé
- Branche `mission/auto-finale-t`, dernier commit `7c735ddf`, arbre propre, **rien de poussé**, aucune migration,
  aucune requête vers staging ni la prod. Aucun essai de courriel envoyé hors de la pile locale.
- Mes serveurs (3498 / 5498) sont arrêtés, par PID ; les ports sont libres.
- Aucun fichier de `e2e/automations/**` modifié. Aucun test existant désactivé ni affaibli.
- Les cinq patchs de `T-a-reporter/` s'appliquent sur le dernier commit (`git apply --check`).
- `tests/support/carte-app-empreinte.json` sera à régénérer à la fusion (`npm run carte:empreinte`).
