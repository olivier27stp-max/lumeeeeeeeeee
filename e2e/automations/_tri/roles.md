# roles — 139 échecs à la passe, après tri : 27 défauts, 13 specs réparées, 1 environnement (+ la cause unique des 139), 7 fragiles — et 1 rouge sans conclusion

> Les 139 échecs de la passe complète avaient UNE cause, de préparation : le jeu de bureaux « (roles) » n'existait pas
> sur la pile locale (`ARRÊT : 0 bureau(x) …`). Le dossier n'avait donc pas tourné. Une fois le jeu posé, le dossier
> compte **141 tests** (139 + 2 nés de deux scissions, voir plus bas).
>
> **Dernière passe complète du dossier (une seule a abouti) : 113 verts, 28 rouges.** 27 rouges sont des défauts du
> produit (`@defaut`, tous attendus ; aucun `@defaut` n'est sorti vert). Le 28ᵉ n'est PAS un `@defaut` : `10:78`
> « propriétaire : chaque écran s'ouvre… », rouge par le seul moniteur (« Lock broken by another request with the
> 'steal' option. », cinq fois, sur `/automations/apercu`). Rejoué seul aussitôt après : vert (1 passé / 0 échoué).
> Intermittent, cause non établie — voir « Encore rouge sans conclusion ». Ni la spec ni le moniteur n'ont été touchés.
>
> Les quatre nombres comptent des TESTS : 27 rouges pour un défaut, 13 dont la spec a été réparée (8 vertes, 5 dont
> l'attente finale reste rouge pour un défaut), 7 rendus déterministes, 1 échec d'environnement vu une seule fois.

## Préparer le jeu de bureaux sur la pile locale (une commande)

    node D:/lume-uiaudit/outils/roles/preparer-jeu-local.mjs

- Parle DIRECTEMENT à GoTrue (`127.0.0.1:48999`) et à PostgREST (`127.0.0.1:48300`), sans le proxy
  (`outils/roles/client-local.mjs`) ; refuse toute adresse qui n'est pas `http://127.0.0.1`. Idempotent.
- Si les bureaux « [TEST] QA Automatisations A / B (roles) » n'existent pas, il lance UNE fois le banc commun
  (`lancer.mjs 00-banc --project=bureau`, `E2E_JEU=roles`, ports `E2E_PORT_*` de l'environnement, défaut 48424 / 48305 /
  5196), puis vérifie : un A, un B, bac à sable, forfait Autopilot, les quatre comptes du banc ; il pose les cinq
  comptes de rôle du lot (vendeur, lecteur, éditeur + `lecteur-sms-a`, `vendeur-sms-a`, voir « Specs réparées »).
- Il RÉPARE deux états qu'une passe interrompue peut laisser : un bureau renommé « Nettoyage Test A » (voir EXT-009)
  retrouve son nom ; un bureau B resté sur le forfait « starter » (55-forfait) est remis sur Autopilot.
- `garde-bureaux.mjs` (staging, identifiants de bureaux de staging en dur) n'a PAS été lancé.
- Autres outils locaux, lecture seule : `etat-jeu-local.mjs`, `lire-local.mjs` ; sonde : `sonde-etiquette-local.mjs`.

Relancer le dossier (un worker, une commande à la fois ; `lancer.mjs` démarre et arrête proxy, API et Vite) :

    cd D:/lume-uiaudit/wt-e2e && E2E_PORT_PROXY=48424 E2E_PORT_API=48305 E2E_PORT_VITE=5196 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/tri-roles E2E_JEU=roles E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs roles/ --project=bureau

Deux réglages du lot ont dû suivre la pile locale (dans `roles/_roles.ts`, rien dans `_outils/`) :
`API_DIRECTE` vaut `http://127.0.0.1:${QA_UI_PORT_API}` quand `E2E_API` n'est pas posé (le lanceur local ne transmet
pas `E2E_API` ; la valeur par défaut `:3112` est l'atelier staging) ; `SORTIES_LOT` vaut `${E2E_SORTIES}/lot-roles`
quand `E2E_SORTIES` est posé (les matrices de la passe staging, `sorties/roles/matrice-*.json`, ne sont pas écrasées).

## Les constats roles-05 / 06 / 07 (écritures directes en base) — état test par test

Garde en base de #889 (`20261007300000_automation_rules_garde.sql`, déclencheur `trg_automation_rules_garde`).

| Constat | Test | État | Ce que la base répond maintenant |
|---|---|---|---|
| roles-05 | `50-soupcons-securite.spec.ts:178` [S-04] publier directement en base un parcours que le serveur refuse | **VERT**, `@defaut` retiré | `update … set is_active = true` par l'admin puis par le membre « read + update » : refusé, la règle au texto vide reste en brouillon |
| roles-06 (1/2) | `50:197` [S-04] `is_preset` et `preset_key` ne se réécrivent pas | **VERT** (test né de la scission, sans `@defaut`) | 42501 « Le bureau et le statut « fournie » d’une automatisation ne se modifient pas. » |
| roles-06 (2/2) | `50:208` [S-04] un déclencheur hors catalogue ne s’écrit pas directement, même sur sa propre règle | **ROUGE**, `@defaut` | **passe encore** : `update automation_rules set trigger_event = 'declencheur.inexistant'` sur SA règle (non fournie) par le membre « read + update » est accepté et relu tel quel. La garde ne protège le déclencheur que des règles FOURNIES. |
| roles-07 | `50:216` [S-04] une automatisation FOURNIE ne se met pas à la corbeille, ne se purge pas, ne se supprime pas en direct | **VERT**, `@defaut` retiré | `update { deleted_at, purged_at }` refusé ; `DELETE` refusé ; la ligne existe toujours |
| roles-07 | `40-base-roles.spec.ts:153` [RLS-01][S-04] `automation_rules`, suppression par PostgREST | **VERT**, `@defaut` retiré | `DELETE` : 42501 « Une automatisation ne se supprime pas directement : elle passe par la corbeille. » pour propriétaire, admin et éditeur |
| (voisin) | `50:253` [S-04] ce que la base refuse bien : déplacer une règle vers un autre bureau, ou en insérer une chez lui | **VERT** (spec réparée) | `org_id` : 42501 de la garde ; insertion d'un brouillon dans le bureau B : 42501 « row-level security » |

Les écritures directes qui PASSENT ENCORE, toutes dans SON bureau et avec le droit « modifier les automatisations »
(aucune fuite entre entreprises) :

1. **Déclencheur hors catalogue sur sa propre règle** (`50:208`, reste de roles-06) — ci-dessus.
2. **Contenu des étapes sans les bornes du serveur** (`50:235` [S-04][S-13], rouge) : `update … set actions = […]` avec
   un texto de 5 000 caractères est accepté (le serveur répond 400 au même changement) ; et sur une règle PUBLIÉE,
   vider le texto est accepté — la règle reste publiée avec un texto vide. C'est le même état final que roles-05
   (règle publiée incomplète), obtenu par l'autre bout : on ne peut plus PUBLIER une règle incomplète en direct, mais
   on peut RENDRE incomplète une règle publiée. La garde laisse exprès « réécrire ses étapes ».
3. **Suppression DURE d'une adresse d'appel** (`40:153` [RLS-05], rouge, `@defaut` posé) : `DELETE` sur
   `automation_webhooks` par PostgREST réussit pour propriétaire, admin et éditeur (`grant … delete … to authenticated`,
   `20260929090000_webhooks_entrants.sql:142`), alors que le serveur ne fait qu'un effacement doux (`deleted_at`) ; les
   reçus de l'adresse partent avec elle (`on delete cascade`). Même famille que roles-07, sur une autre table.
4. **Brouillon créé hors forfait** (`55-forfait.spec.ts:129` [S-03] base, rouge) : sur le forfait « starter », l'insertion
   d'une règle PUBLIÉE est refusée (par la garde, pour tout forfait), mais l'insertion d'un BROUILLON est acceptée — ni
   la RLS ni la garde ne regardent le forfait.
5. Hors `automation_rules` : **étiquettes de client** (`20-points-entree.spec.ts:476` [EXT-016], rouge) — un technicien
   (sans `clients.update` ni `leads.update`) supprime et insère des lignes de `client_tags` par PostgREST (sonde :
   DELETE 1 ligne, INSERT 1 ligne). Voir le tableau.

Non rejoué : `wt-lumi/scripts/qa/verifier-garde-automatisations.mjs` (consigne).

## Défauts du produit encore ouverts

27 tests rouges, tous `@defaut`, 25 lignes (S-01 est porté par trois tests).

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| S-01, RTE-01, EXT-001 | `10-interface-roles.spec.ts:78` (membre read seul), `:111` (membre read seul), `:144` | Automatisations — liste, menu « Plus », sous-navigation | Membre à qui la page Rôles donne « voir les automatisations » seulement : il clique « Automatisations » dans le menu, ou l'onglet « Automatisations » / « Réglages globaux » depuis la Vue d'ensemble | « Accès restreint ». La route demande `automations.read` mais la page est enveloppée dans `<PermissionGate permission="automations.update">` (`src/pages/Automations.tsx:1297`) ; la liste se monte quand même derrière et la console reçoit quatre « [automatisations] bureaux cibles illisibles » ; l'onglet « Réglages globaux » lui est offert et mène aussi au refus | La liste en lecture seule (l'API la lui sert : 200), et aucun onglet offert qui mène à un refus | majeur (la permission « voir » ne sert à rien sur l'écran principal) |
| RTE-08 | `10:204` | Écran « Accès restreint » | Un technicien ouvre `/automations` | Un titre et « Contactez votre administrateur… » : ni bouton ni lien dans le panneau | Une issue dans le panneau (Retour, Accueil) | mineur |
| S-04 (roles-06, reste) | `50-soupcons-securite.spec.ts:208` | Base, par PostgREST | Membre « read + update » : `update automation_rules set trigger_event = 'declencheur.inexistant'` sur sa règle | Accepté | Refusé comme par le serveur (déclencheur validé contre le catalogue) | mineur (son bureau, la règle ne part plus) |
| S-04, S-13 | `50:235` | Base, par PostgREST | Même membre : écrit un texto de 5 000 caractères, puis vide le texto d'une règle publiée | Les deux acceptés ; la règle reste publiée avec un texto vide | Mêmes bornes que le serveur (1 600 caractères, jamais vide sur une règle publiée) | moyen (règle publiée incomplète, par l'autre bout de roles-05) |
| RLS-05 | `40-base-roles.spec.ts:153` (`automation_webhooks`) | Base, par PostgREST | Propriétaire, admin ou éditeur : `DELETE` d'une adresse d'appel | La ligne et ses reçus n'existent plus | Refus (le produit n'efface qu'en douceur) | moyen (suppression définitive que l'écran n'offre pas, journal des appels perdu) |
| S-03 (base) | `55-forfait.spec.ts:129` | Base, par PostgREST, forfait sans automatisations | Propriétaire d'un bureau « starter » : insère un brouillon d'automatisation | Accepté (l'insertion d'une règle publiée, elle, est refusée par la garde) | Refusé : le forfait n'inclut pas les automatisations | mineur (un brouillon ne part pas) |
| S-03 (serveur) | `55:107` | API, forfait sans automatisations | Même propriétaire : `GET` puis `POST /api/automations/rules` | 200, puis 201 : la règle est créée | 403 « feature_not_in_plan », rien d'écrit | moyen — la garde existe (`server/lib/feature-guard.ts`) mais son mode par défaut est `log` ; la pile locale ne pose pas `FEATURE_GUARD`. Valeur en prod NON VÉRIFIÉE d'ici |
| S-18 | `50:435` | API — `POST /api/automations/events/deal-stage-changed` | Propriétaire du bureau B, avec l'identifiant d'un objet du bureau A | 200 `{ ok: true }` ; un événement « étape changée » est consigné dans SON bureau (rien dans A, aucune donnée de A rendue) | 404, comme `lead-created` (la route ne relit pas le deal) | mineur |
| S-08, S-06 (reste de roles-12) | `50:395` | API — refus hors permissions | Éditeur : `GET /api/automations/test` ; propriétaire : `appointment-rescheduled` sans `eventId` | « Only admins can run automation tests. », « eventId is required » (pas de champ `message`) | Une phrase en français | mineur |
| EXT-016 | `20-points-entree.spec.ts:476` | Fiche client | Un technicien ouvre la fiche d'un client étiqueté | Le « × » de l'étiquette lui est offert ; le retrait s'écrit pour de bon (`client_tags` ouverte à tout membre) ; l'annonce au moteur est refusée (403 « clients.update or leads.update ») sans rien dire : les automatisations « Étiquette retirée » / « ajoutée » ne partent pas | Pas de bouton pour un rôle sans `clients.update`, et une base qui refuse l'écriture | moyen (un rôle sans droit modifie les étiquettes ; déclencheur muet) — NOUVEAU, `@defaut` posé |
| EXT-007, S-12 | `20:440` | Réglages › Messagerie SMS | (1) un technicien ouvre la page ; (2) un membre qui a « voir les intégrations » sans « voir les automatisations » l'ouvre | (1) sous « Votre numéro » : « Permission denied: integrations.read », en anglais technique — et la section « Textos automatiques » n'apparaît pas ; (2) « Aucune automatisation SMS configurée pour cette organisation. » alors que le bureau en a 34 publiées | (1) la phrase que le serveur fournit (« Votre rôle ne permet pas cette action. ») ; (2) un message qui dit que c'est le rôle qui ne peut pas les lire | mineur |
| EXT-007, S-12, S-08 | `20:493` | Réglages › Messagerie SMS › Textos automatiques | Membre en lecture seule : bascule l'interrupteur d'une règle | Le serveur refuse (403), l'interrupteur revient en arrière, aucun message (`handleToggle` avale l'erreur, `SettingsMessaging.tsx:482`) | Un message, en français | mineur |
| EXT-007 | `20:189` | Même section | — | 15 interrupteurs sans nom accessible (`role="switch"` sans `aria-label`) | Le nom de la règle commandée | mineur (accessibilité) |
| EXT-002, S-10 | `20:73` | Palette de commandes (Ctrl+K) | Taper « automatisations » | Rien : la commande s'appelle « Automations », mots-clés anglais (`CommandPalette.tsx:103`) | La commande « Automatisations » | mineur |
| EXT-003, S-10 | `20:94` | Recherche globale | Taper « automatisations » + Entrée | Une recherche de texte (`/search?q=automatisations`) | La liste des automatisations (alias français, `searchParsing.ts:65`) | mineur |
| EXT-005, S-16 | `20:123` | Réglages › Lume Payments › Reçu automatique | Cliquer le lien « Automatisations » | Toute l'application se recharge (`<a href>`, `PaymentSettings.tsx:203`) | Une navigation interne | mineur |
| EXT-006, S-20 | `20:151` | Réglages › Modèles de courriel, compte en anglais | Ouvrir la page | « Les relances automatiques », « N relances automatiques », « Soumissions, factures… » en français | La section en anglais | mineur |
| EXT-020, S-11 | `20:292` | Aide › « Comment fonctionnent les automatisations ? » | Lire l'article depuis la liste | « Rien ne se supprime : une règle inutile se met en pause. » — la liste a une corbeille et une suppression définitive | Un article qui dit ce que fait l'écran | mineur |
| EXT-025, S-19 | `20:326` | Centre d'activités | Cliquer une notification « Échec d'envoi » d'automatisation | Rien : on reste sur l'accueil | Arriver sur l'automatisation (ou la liste) | mineur |
| EXT-002, S-16 | `20:380` | Palette de commandes, technicien | Taper « autom » | La commande lui est offerte ; elle mène à « Accès restreint » | Pas de commande pour un rôle qui ne peut pas l'ouvrir | mineur |
| EXT-004, S-16 | `20:415` | Réglages › menu, technicien | Ouvrir les Réglages | « Automatisations » offert sans filtre (`SettingsLayout.tsx:95`) | Entrée absente | mineur |
| RTE-09 | `55-forfait.spec.ts:89` | Fenêtre d'offre de forfait (« Fonctionnalité premium / Automatisations ») | Ouvrir `/automations` sur un forfait qui ne l'inclut pas, puis Échap | La fenêtre n'a pas le rôle « dialog » (`role="presentation"`, `PlanUpgradeModal.tsx:279`) ; Échap ne la ferme pas | Une fenêtre de dialogue annoncée, fermée par Échap | mineur (accessibilité) — NOUVEAU, test né de la scission de RTE-09 |
| MOB-03, S-20 | `60-telephone.spec.ts:63` | Porte mobile, compte en anglais | Ouvrir `/automations` sur un téléphone | « Le bureau sur l'ordi. Le terrain dans l'app. » (`MobileAppGate.tsx:63`) | La porte en anglais | mineur |
| S-08, S-20 | `70-evenements-et-messages.spec.ts:119` | Automatisations — liste | Membre « read + update » non admin | « Tout arrêter » et « Messages en EN » lui sont offerts, cliquables ; le refus vient après (et il est clair, tests voisins verts) | Commandes absentes ou désactivées pour qui sera toujours refusé | mineur |
| S-15 | `70:133` | Réglages globaux › Adresses d'appel | Une adresse reçoit un appel (reçu en base) | Rien à l'écran : ni compteur, ni date du dernier appel (`AdressesDAppel.tsx`) | De quoi savoir que l'intégration fonctionne | mineur |

Connu et ouvert, sans test rouge : **roles-14** — tout rôle du bureau peut annoncer « visite déplacée ». La matrice
(`30-api-roles`, API-32) le confirme sur la pile locale : les six rôles, vendeur et technicien compris, reçoivent 200
et, quand la visite a vraiment bougé, la confirmation repart. (Pour une visite qui n'a PAS bougé : corrigé, voir ci-dessous.)

## Défauts corrigés depuis (marqueur @defaut retiré)

Quatorze marqueurs retirés, plus une scission ; chaque test a été vu VERT sur la pile locale (encore à la dernière
passe complète), pour la bonne raison : les attentes « dures » du test — route de référence refusée, écriture tentée —
passent avant l'attente finale.

| Constat | Spec:ligne | Test | Correctif |
|---|---|---|---|
| roles-01 | `50:48` | [S-02] événements : barre finale, casse, double barre ne laissent pas un technicien déclencher | #862 |
| roles-02 | `50:85` | [S-02] « Construire avec Lumi » par un chemin équivalent : 403 | #862 |
| roles-03 | `50:99` | [S-02] lectures par un chemin équivalent : 403 | #862 |
| roles-04 | `50:143` | [S-02] sans jeton, barre finale : 401 | #862 |
| roles-05 | `50:178` | [S-04] publier directement en base un parcours incomplet | #889 |
| roles-07 | `50:216` | [S-04] automatisation FOURNIE : corbeille, purge, DELETE en direct | #889 |
| roles-07 | `40:153` | [RLS-01][S-04] `DELETE` d'une règle par PostgREST | #889 |
| roles-08 | `50:281` | [S-05] `PATCH { is_active: true }` sur une règle à la corbeille | #870 |
| roles-09 | `50:294` | [S-05] dupliquer une règle supprimée définitivement | #870 |
| roles-10 | `50:303` | [S-05] « Tester » une règle à la corbeille | #870 |
| roles-11 | `50:331` | [S-06] la batterie de diagnostic ne rend plus le compte SMTP ni Twilio (vérifié : l'API locale porte `SMTP_USER=piege@lume-qa.test`, absent de la réponse) | #866 |
| roles-12 | `50:373` | [S-08] refus de permission dit en français — voir aussi « Specs réparées » (le texte lu est `message`) | #870 |
| roles-13 | `70:24` | [S-07][S-19] notification « prêt à facturer » en français | #870 |
| roles-14 (partie) | `70:45` | [S-07] « visite déplacée » pour une visite qui n'a PAS bougé : `{ inchange: true }`, rien ne repart — voir « Fragiles » | #870 |

La scission : roles-06, partie `is_preset` / `preset_key`, est le test `50:197`,
vert, sans marqueur (#889).

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

Vues VERTES après réparation (8) :

| Spec:ligne | Ce qui avait changé | Preuve | Réparation |
|---|---|---|---|
| `50:155` [S-02] ce qui ne contourne PAS la garde | `//api/…` répond 403, plus 404 : les barres doublées sont réduites avant les gardes | #862, `server/lib/chemin-canonique.ts` | 403 + `error` exact ; titre ajusté |
| `50:253` [S-04] ce que la base refuse bien | Le refus de `org_id` vient de la garde (son message), plus de la RLS ; et `is_active` vaut `true` par défaut : une insertion sans cette colonne est refusée par la garde AVANT la RLS | #889, `20261007300000_automation_rules_garde.sql` | Code 42501 + message de la garde ; insertion chez B avec `is_active: false` explicite pour prouver le refus de la RLS |
| `50:373` [S-08] refus dit en français | Le refus porte `error` (texte technique, gardé comme contrat) ET `message` / `message_en` ; le toast affiche `message` | #870, `server/lib/refus-permission.ts`, `src/lib/messageDuServeur.ts` | L'attente porte sur le texte AFFICHÉ (`message`, exact, en français et en anglais), le contrat `error` est vérifié à part, et rien n'est créé |
| `30-api-roles.spec.ts:37` [API-32] `appointment-rescheduled` | La route ne ré-émet plus rien pour une visite restée à la même heure : cinq des six rôles « autorisés » n'écrivaient plus | #870, `server/routes/automation-events.ts` § 0 | `_routes.ts` : la visite du décor est VRAIMENT déplacée (par le service) avant chaque appel ; les refus (autre bureau, sans jeton) n'écrivent toujours rien |
| `10:191` [RTE-08] retour à l'accueil | L'accueil est `/day` (« / » y redirige) | `src/App.tsx:1101`, `:1562`, commit 40527874 | URL `/day`, sans écran de refus |
| `20:246` [EXT-012] Pipeline › « Ouvrir les automatisations » | Les étapes portent `name_fr` / `name_en` ; la spec lisait une colonne `name` qui n'existe pas (42703, erreur avalée → « pas de pipeline ») | `supabase/baseline/01_schema.sql` (`seed_pipeline_ventes`) ; spec jamais exécutée | Colonne corrigée, erreur de lecture vérifiée |
| `20:280` [EXT-020][EXT-021] article d'aide | « Aide et support » ouvre d'abord l'assistant Lumi ; les articles sont derrière « Parcourir l’aide » | #385, `src/components/SupportDrawer.tsx` | Passage par « Parcourir l’aide » ; le tiroir se referme à l'arrivée |
| `55:46` [RTE-09] garde de forfait | « Fonctionnalité premium » est écrit deux fois (garde + fenêtre d'offre) : le sélecteur d'origine était ambigu | `PlanFeatureGate.tsx:78`, `PlanUpgradeModal.tsx:316` | La garde se reconnaît à sa phrase ; fenêtre fermée par son bouton ; menu et sous-routes vérifiés. La partie « dialog + Échap » est devenue le test `55:89` (défaut) |

Réparées jusqu'à leur attente finale, qui reste ROUGE pour un défaut (5) : `10:144` (les onglets de la sous-navigation
sont des liens, plus des boutons — #870, `SousNavigation.tsx`), `20:292` (« Parcourir l’aide »), `20:326` (la cloche
n'a qu'un `title` : dès qu'une notification est non lue, sa pastille « 1 » devient son nom accessible — visée par
`getByTitle`), `20:440` et `20:493` (la section « Textos automatiques » ne s'affiche que si le numéro du bureau a été
lu, et `GET /api/communications/channels` exige `integrations.read` : ni le technicien ni le membre en lecture seule
ne la voyaient ; deux comptes hors matrice, `lecteurSmsA` et `vendeurSmsA`, ajoutés dans `_comptes.ts`).

Deux scissions (139 → 141 tests), mêmes écritures et mêmes attentes qu'avant : roles-06 en `50:197` (vert) + `50:208`
(rouge) ; RTE-09 en `55:46` (vert) + `55:89` (rouge). Un seul test rouge aurait caché une régression de la partie verte.

## Fragiles rendus déterministes

| Spec:ligne | Ce qui n'allait pas | Ce qui est fait | État |
|---|---|---|---|
| `20:212` [EXT-009] Réglages › Entreprise › Langue | Enregistrer la page recopie `company_name` dans `orgs.name` (`server/routes/billing.ts:2089`) : le bureau « [TEST] … A (roles) » devenait « Nettoyage Test A », et les 15 tests suivants tombaient sur « 0 bureau(x) » dès que le worker redémarrait | Le test note le nom du bureau et le rend (aussitôt l'écriture vue, et dans le `finally`) | vert |
| `70:45` [S-07] visite qui n'a pas bougé | Dépendait du test passé avant (API-32 déplace la visite du décor : l'annonce suivante devenait légitime) | Le test pose son état (une annonce, rappels planifiés), puis annonce à nouveau | vert, `@defaut` retiré |
| `10:111` [EXT-001] membre read seul, `10:144` [S-01] | « Aucun refus » lu pendant le chargement des permissions passait à tort ; l'échec ne tombait que 90 s plus tard, sur un autre motif | On attend que la page ait tranché (liste ou refus) avant de lire | rouges (S-01), pour le bon motif, en 20 s |
| `20:151` [EXT-006][S-20] | Même cause : VERT TROMPEUR à la première exécution (le texte français n'était pas encore rendu) | Attente de la carte (`data-visite="relances"`) avant la lecture | rouge (défaut) |
| `70:133` [S-15] | VERT TROMPEUR : le motif acceptait « reçu », présent dans le texte d'aide de la carte (« Appel reçu de l’extérieur ») | Motif resserré sur une vraie trace (compte d'appels, date, contenu) | rouge (défaut) |
| `55:129` [S-03] base | VERT pour une autre raison que celle du titre : l'insertion d'une règle publiée est refusée par la garde de #889, pour tout forfait | Le refus est vérifié (42501), et la création d'un brouillon hors forfait — annoncée par le titre — est tentée | rouge (défaut) |

## Environnement

- **La cause des 139 échecs** : jeu « (roles) » absent de la pile locale. Réglé par la commande en tête de fichier.
- `20:114` [EXT-005] à sa PREMIÈRE exécution seulement : `409 GET /api/reminders/settings` et « [PaymentSettings] rappels
  non chargés : A record with this value already exists. ». Vert aux deux passages suivants, spec non modifiée. Cause
  PROBABLE, lue dans le code et non prouvée par un essai : bureau neuf + Vite en mode dev (`StrictMode`, `src/main.tsx`,
  monte l'effet deux fois) → deux `GET` simultanés créent chacun la ligne par défaut (`ensureSettingsRow`,
  `server/routes/reminders.ts` : lecture puis insertion, sans `upsert`). Si c'est bien cela, la course existe aussi dans
  le produit (deux onglets à la première visite d'un bureau neuf), hors de la section.
- `20:415` (rouge pour un défaut de toute façon) : le moniteur relève aussi `net::ERR_BLOCKED_BY_ORB` sur
  `/storage/v1/object/public/avatars/…/banners/…` — pas de stockage sur la pile locale.
- `55:107` [S-03] serveur : ne peut pas passer ici, `FEATURE_GUARD` n'étant pas posé (défaut `log`) — classé défaut,
  parce que c'est le défaut du produit, mais la valeur en prod est inconnue d'ici.
- `30` [API-04] `/rules/generer` : pas de clé d'IA ; la spec accepte déjà 422 / 5xx pour un rôle autorisé (seul le refus
  des autres est prouvé).
- `60-telephone` : tourne dans le projet `bureau` (les tests fixent eux-mêmes l'agent utilisateur et la largeur ; la
  porte = agent utilisateur de téléphone ET `innerWidth < 768`, `src/lib/mobileGate.ts`). Rejoué dans le projet
  `mobile` : mêmes résultats (4 verts, MOB-03 rouge). L'en-tête de la spec, qui disait que le projet `mobile` gardait
  un agent utilisateur d'ordinateur, est corrigé.
- Arrêt des serveurs partagés du tri vers 00:40 UTC. AVANT (ports 48422 / 48303 / 5194) : toutes les relances
  fichier par fichier, la dernière finie à 00:42:33 UTC, résultats cohérents (aucune erreur de connexion). Une passe
  complète lancée à 00:42 UTC sur ces ports n'a joué AUCUN test (serveurs morts) : arrêtée, rien à en tirer.
  APRÈS (ports 48424 / 48305 / 5196, serveurs démarrés et arrêtés par `lancer.mjs`) : une première passe complète n'a
  joué aucun test non plus (« L'API ne répond pas … après 120 s », journal de l'API vide — démarrage trop lent, poste
  chargé) ; la suivante a abouti (141 joués, 113 / 28) ; puis `10:78` propriétaire rejoué seul (1 / 0).

## Encore rouge sans conclusion (et pourquoi)

- **`10-interface-roles.spec.ts:78` — propriétaire : chaque écran s'ouvre ou se refuse (sans `@defaut`)**. Rouge à la
  dernière passe complète, où il est le PREMIER test joué après le démarrage à froid de Vite : toutes ses attentes
  passent, c'est le moniteur qui le fait tomber — cinq « [exception] Lock broken by another request with the 'steal'
  option. » et « [App] vérification onboarding échouée {… AbortError: Lock broken …} », sur `/automations/apercu`.
  Vert à sa première exécution (22,6 s, serveurs chauds) et vert rejoué seul après un nouveau démarrage à froid
  (56,1 s). La même exception avait été relevée une fois sur `/day` pendant [EXT-020]. Deux occurrences sur une
  dizaine de passes, non reproduite à la demande. C'est le verrou de session de l'app (`src/lib/supabase.ts`), que le
  banc refuse exprès de ranger dans les pannes d'environnement (« défaut du produit à instruire ») : je ne l'ai donc ni
  classé « environnement » ni toléré. Hypothèse NON vérifiée : un chargement très lent (premières pages après un
  démarrage à froid) laisse expirer l'attente du verrou, qui est alors volé. À instruire dans le produit.
- **Aide partagée, non modifiée** (`_outils/banc.ts` → `tests/automations-suite/harnais/bureau-test.ts`, `assurerOrg`) :
  le bureau de test est retrouvé par son NOM. Tout test, dans n'importe quel dossier, qui enregistre Réglages ›
  Entreprise le renomme (« Nettoyage Test A ») ; au démarrage suivant le banc ne le trouve plus et en CRÉE un second.
  Le retrouver par le compte propriétaire (ce que fait `preparer-jeu-local.mjs`) supprimerait la cause.
- `scripts/qa/automations-e2e/local.mjs` (`envLocal`) ne transmet pas `E2E_API` : contourné dans `_roles.ts`.
- Bouton cloche (`src/App.tsx`, `title` seul) : son nom accessible devient le nombre de notifications non lues — hors section.
