# Matrice de tests des automatisations — Lume CRM

Une ligne par cellule. Chaque test de `npm run test:automations` cite sa ou ses cellules dans son intitulé (`[B-012]`). Le statut **PASS / FAIL / NON COUVERT** de chaque cellule n'est PAS écrit ici à la main : il est calculé à chaque exécution par `scripts/qa/rapport-automatisations.mjs` et publié dans `rapports/automatisations/RAPPORT.md` (et `synthese.json` pour QA Smoke). La colonne « Remarque » donne le contexte, la raison d'une cellule non couverte, ou le correctif qui l'a fait passer.

| Lettre | Catégorie |
|---|---|
| A | Unitaires : conditions, rendu des variables, horaires, validation |
| B | Intégration : déclencheurs × conditions × actions, parcours, webhooks entrants |
| C | Cas négatifs |
| D | Idempotence, concurrence, boucles |
| E | Échecs et reprise |
| F | Sécurité, multi-bureaux, RLS, RBAC, injection, anti-spam |
| G | Conformité LCAP / Loi 25 |
| H | Langue et contenu |
| I | Lumi |
| J | Interface (Playwright) |
| K | Préréglages et systèmes adjacents |
| L | Observabilité |
| M | Charge |


## Matrice — catégorie A (tests unitaires : aucun réseau, aucune base)

Fichiers : `tests/automations-suite/unitaires/A-conditions-moteur.test.ts`, `A-conditions-champs.test.ts`, `A-rendu-variables.test.ts`, `A-horaires.test.ts`, `A-validation.test.ts`.
Lancer : `npx vitest run --config vitest.automations.config.ts --project unitaires tests/automations-suite/unitaires/`

Statut : toutes les cellules avec un test PASSENT ; « NON COUVERT » / « NON CORRIGÉ » expliqués dans Remarque.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| A-001 | evaluateConditions | conditions {} / null / undefined | règle part |  |
| A-002 | evaluateConditions | réglage vide ('', null, undefined) | pas de filtre |  |
| A-003 | evaluateConditions | clé champs_perso | ignorée ici (jugée par conditionsChampsOk) | conditionsChampsOk lit la base : intégration (B) |
| A-004 | evaluateConditions | client_a_etiquette / client_sans_etiquette | ignorées ici (conditionsEtiquettesOk) | lecture client_tags : intégration (B) |
| A-005 | evaluateConditions | valeur 0 / false | comparées, jamais « vides » |  |
| A-006 | evaluateConditions | plusieurs clés | ET logique |  |
| A-010 | evaluateConditions — égalité | texte identique/différent | verdict exact |  |
| A-011 | evaluateConditions — égalité | casse, espaces (sensible, voulu : statuts techniques) | verdict exact |  |
| A-012 | evaluateConditions — égalité | accents, emoji ZWJ | verdict exact |  |
| A-013 | evaluateConditions — égalité | nombre ↔ texte numérique (« 1250.50 » = 1250.5) | verdict exact | BUG corrigé 4c1a8ae8 |
| A-014 | evaluateConditions — égalité | booléen ↔ « true » | verdict exact |  |
| A-015 | evaluateConditions — égalité | null / absent / objet ≠ leur texte | verdict exact |  |
| A-016 | evaluateConditions — égalité | métadonnée liste = « contient » | verdict exact |  |
| A-017 | evaluateConditions — égalité | 10 000 car., caractères spéciaux | verdict exact |  |
| A-018 | evaluateConditions — égalité | niveau 1 seulement (pas de chemin pointé) | verdict exact |  |
| A-019 | evaluateConditions — égalité | liste hors opérateur ne correspond jamais | verdict exact |  |
| A-020 | evaluateConditions | eq (texte, nombre, booléen, liste, absent) | verdict exact |  |
| A-021 | evaluateConditions | neq | verdict exact (absent = différent) |  |
| A-022 | evaluateConditions | eq + neq combinés | ET |  |
| A-030 | evaluateConditions | in | verdict exact ; liste vide = rien |  |
| A-031 | evaluateConditions | not_in | verdict exact ; liste vide = tout |  |
| A-032 | evaluateConditions | in / not_in sans liste | REFUSÉ | BUG corrigé 6e4fd2fd (laissait tout passer) |
| A-040 | evaluateConditions — nombres | gt | verdict exact aux bornes |  |
| A-041 | evaluateConditions — nombres | gte | verdict exact aux bornes |  |
| A-042 | evaluateConditions — nombres | lt | verdict exact aux bornes |  |
| A-043 | evaluateConditions — nombres | lte | verdict exact aux bornes |  |
| A-044 | evaluateConditions — nombres | nombres en texte, 0, négatifs, espaces | verdict exact aux bornes |  |
| A-045 | evaluateConditions | suffixes cle__gt/gte/lt/lte | = opérateur sur cle |  |
| A-046 | evaluateConditions | intervalle (2 conditions, 2 opérateurs, min > max) | bornes inclusives ; impossible = rien |  |
| A-047 | evaluateConditions | suffixe + objet sur le même champ | les deux s’appliquent |  |
| A-048 | evaluateConditions | clé avec « __ » sans opérateur | clé ordinaire |  |
| A-050 | evaluateConditions | métadonnée absente / null / vide | comparaison REFUSÉE |  |
| A-051 | evaluateConditions | texte libre, objet, liste, booléen, NaN, Infinity | REFUSÉE |  |
| A-052 | evaluateConditions | « 1500$ », « 100 $ », « Montant 5 », « +5 », « 1 500 »… | REFUSÉE | BUG corrigé 6bf3a8fe (Date.parse y lisait l’an 1500 : tout passait) |
| A-053 | evaluateConditions | date impossible « 2026-02-30 », « 2026-09-30junk » | REFUSÉE (pas « roulée ») | BUG corrigé 6bf3a8fe |
| A-054 | evaluateConditions | nombre comparé à une date | REFUSÉE | BUG corrigé 6bf3a8fe |
| A-055 | evaluateConditions | comparaison impossible | avertissement journalisé |  |
| A-060 | evaluateConditions — dates ISO | gt | verdict exact |  |
| A-061 | evaluateConditions — dates ISO | gte | verdict exact |  |
| A-062 | evaluateConditions — dates ISO | lt | verdict exact |  |
| A-063 | evaluateConditions — dates ISO | lte | verdict exact |  |
| A-064 | evaluateConditions — dates ISO | décalages horaires | verdict exact |  |
| A-065 | evaluateConditions — dates ISO | format Postgres (espace, +00, µs) | verdict exact |  |
| A-066 | evaluateConditions — dates ISO | 29 février 2028 | verdict exact |  |
| A-067 | evaluateConditions | objet Date / Date invalide | comparé / refusé |  |
| A-068 | evaluateConditions | intervalle de dates | bornes |  |
| A-070 | evaluateConditions | opérateur inconnu (contains, between, is_empty, EQ, faute) | REFUSÉ |  |
| A-071 | evaluateConditions | connu + inconnu, __proto__ | REFUSÉ |  |
| A-072 | evaluateConditions | objet d’opérateurs vide {} | pas de filtre | documenté : Zod le refuse à l’enregistrement (A-352) |
| A-073 | evaluateConditions | clé du prototype en nom de condition | ne lit pas Object.prototype |  |
| A-074 | étape « si » | filtre d’étiquettes dans un si | — | NON COUVERT en unitaire : chemin asynchrone qui lit la base ; piste inv-1 §9-1, à couvrir en intégration (B) |
| A-080 | regleViseCetEvenement | règle sans portée | part |  |
| A-081 | regleViseCetEvenement | même / autre étape | filtre |  |
| A-082 | regleViseCetEvenement | autre pipeline / toutes étapes | filtre |  |
| A-083 | regleViseCetEvenement | métadonnée sans étape ni pipeline | passe (voulu) |  |
| A-084 | regleViseCetEvenement | hors deal.* ; deal.stage_idle | pas de filtre / même portée |  |
| A-100 | familleDuType | 12 types de champ | famille attendue |  |
| A-101 | evaluerCondition | 20 opérateurs | = enum Zod conditionChampSchema |  |
| A-102 | evaluerCondition | type × opérateur hors famille (tous les couples) | LÈVE (règle non déclenchée) |  |
| A-103 | evaluerCondition | is_empty / is_not_empty × 4 formes de vide × 12 types | verdict exact |  |
| A-104 | evaluerCondition | is_empty / is_not_empty sur valeur remplie | verdict exact |  |
| A-110 | checkbox | « est oui » | cochée seulement si true / « true » |  |
| A-111 | checkbox | « est non » | jamais remplie = non |  |
| A-112 | checkbox | cible absente ou illisible | LÈVE |  |
| A-113 | checkbox | 1 / « oui » en base | non cochée |  |
| A-115 | texte (single_line, multi_line, email, url) | is (casse, espaces) | verdict exact |  |
| A-116 | texte (single_line, multi_line, email, url) | is_not | verdict exact |  |
| A-117 | texte (single_line, multi_line, email, url) | contains | verdict exact |  |
| A-118 | texte (single_line, multi_line, email, url) | not_contains | verdict exact |  |
| A-119 | texte (single_line, multi_line, email, url) | accents (sensibles, comme value_normalized SQL), œ, « », emojis | verdict exact |  |
| A-120 | texte (single_line, multi_line, email, url) | caractères spéciaux, 10 000 car. | verdict exact |  |
| A-121 | texte | valeur du champ vide | is/contains faux, is_not/not_contains vrai |  |
| A-122 | texte | CIBLE vide (absente, null, vide, espaces) | LÈVE | BUG corrigé 8aeb5938 (« contient (rien) » = vrai pour tous) |
| A-125 | téléphone | is en E.164 | verdict exact |  |
| A-126 | téléphone | contains / not_contains | verdict exact |  |
| A-127 | téléphone | is_not, texte non numérique | verdict exact |  |
| A-128 | normaliserTelephone | formats CA, international, invalides | E.164 ou null |  |
| A-129 | normaliserTexte | espaces, tabulations, null, nombre | normalisé |  |
| A-130 | nombre / montant | eq | verdict exact |  |
| A-131 | nombre / montant | neq | verdict exact |  |
| A-132 | nombre / montant | gt | verdict exact |  |
| A-133 | nombre / montant | lt | verdict exact |  |
| A-134 | nombre / montant | between (bornes incluses, inversées) | verdict exact |  |
| A-135 | nombre / montant | valeur vide | tout faux sauf neq |  |
| A-136 | nombre / montant | valeur de condition absente / texte / « 1500$ » | LÈVE |  |
| A-137 | nombre / montant | between sans 2e borne | LÈVE |  |
| A-138 | nombre / montant | valeur en base illisible | rien ne passe |  |
| A-140 | liste | dropdown_single any_of | verdict exact |  |
| A-141 | liste | dropdown_single none_of | verdict exact |  |
| A-142 | liste | dropdown_multi any_of | verdict exact |  |
| A-143 | liste | dropdown_multi none_of | verdict exact |  |
| A-144 | liste | valeur vide | any_of faux, none_of vrai |  |
| A-145 | liste | aucune option choisie | LÈVE |  |
| A-146 | liste | casse de l’identifiant | exacte |  |
| A-150 | date | today | verdict exact (heure murale Toronto) |  |
| A-151 | date | yesterday | verdict exact (heure murale Toronto) |  |
| A-152 | date | in_last (jours, 0) | verdict exact (heure murale Toronto) |  |
| A-153 | date | more_than_ago | verdict exact (heure murale Toronto) |  |
| A-154 | date | less_than_ago | verdict exact (heure murale Toronto) |  |
| A-155 | date | semaines | verdict exact (heure murale Toronto) |  |
| A-156 | date | mois | verdict exact (heure murale Toronto) |  |
| A-157 | date | before | verdict exact (heure murale Toronto) |  |
| A-158 | date | after | verdict exact (heure murale Toronto) |  |
| A-159 | date | between (inversé, avec heure) | verdict exact (heure murale Toronto) |  |
| A-160 | date | 23 h 30 locale = lendemain UTC | jour local |  |
| A-161 | date | autre fuseau (Vancouver, Paris) | jour du fuseau |  |
| A-162 | date | retour à l’heure normale 1er nov. 2026 (1 h 30 deux fois) | today / yesterday / in_last justes |  |
| A-163 | date | heure d’été 8 mars 2026, 14 mars 2027 | jours justes |  |
| A-164 | retirerDuree | 31 → 30, février bissextile 2028 | fin de mois bornée |  |
| A-165 | date | valeur vide | toujours faux |  |
| A-166 | date | date de condition absente ou illisible | LÈVE |  |
| A-167 | date | valeur en base qui n’est pas une date (« n/a ») | rien ne passe | BUG corrigé 23f6b6de (« après le 1er janv. » passait) |
| A-168 | date | durée n illisible | LÈVE / rien ne passe | BUG corrigé 23f6b6de |
| A-170 | evaluerConditions | plusieurs conditions | ET |  |
| A-171 | evaluerConditions | intervalle sur un champ | bornes |  |
| A-172 | evaluerConditions | champ disparu / liste vide | faux / vrai |  |
| A-173 | conditionsChampsOk | lecture base, champ archivé, erreur → faux | — | NON COUVERT en unitaire : lit la base (listerChamps) ; intégration (B) |
| A-180 | resolveTemplate | [cle] et {cle} | valeur |  |
| A-181 | resolveTemplate | {{client.nom}} (espaces tolérés) | valeur |  |
| A-182 | resolveTemplate | {{objet.cle}} champ perso | objet_cf_cle |  |
| A-183 | resolveTemplate | formats mélangés | tous rendus |  |
| A-184 | resolveTemplate | {{client_first_name}} (sans point) | « Marie », pas « {Marie} » | BUG corrigé c2772a07 (format annoncé par Lumi, accepté par l’éditeur) |
| A-185 | resolveTemplate | intégrée pointée vs champ perso homonyme | intégrée d’abord |  |
| A-186 | resolveTemplate | variable inconnue / vide / null | effacée |  |
| A-187 | resolveTemplate | [50], {0}, [2b] | texte intact | BUG corrigé 1d535c18 (« Rabais [50] % » → « Rabais  % ») |
| A-188 | resolveTemplate | syntaxes non reconnues | laissées telles quelles |  |
| A-189 | resolveTemplate | valeur contenant une variable | jamais relue (une passe) |  |
| A-190 | resolveTemplate | [constructor], {toString}, {{__proto__}}… (texte) | jamais le prototype | BUG corrigé a7d68532 (« function Object() { [native code] } ») |
| A-191 | resolveTemplate | idem, corps HTML du courriel | ne lève pas | BUG corrigé a7d68532 (TypeError hors try) |
| A-192 | resolveTemplate | {{client.constructor}} | vide |  |
| A-193 | resolveTemplate | applyTemplate + clés du prototype | gardées telles quelles |  |
| A-200 | resolveTemplate — valeurs | accents FR (é è ê ç à ô œ « » ’) | insérées telles quelles |  |
| A-201 | resolveTemplate — valeurs | emojis simples et multi-codepoint | insérées telles quelles |  |
| A-202 | resolveTemplate — valeurs | $& $1 $$ \ { } [ ] | insérées telles quelles |  |
| A-203 | resolveTemplate — valeurs | 10 000+ caractères, retours de ligne | insérées telles quelles |  |
| A-204 | resolveTemplate — valeurs | gabarit de 2 000 variables | insérées telles quelles |  |
| A-205 | resolveTemplate — valeurs | accents du gabarit | insérées telles quelles |  |
| A-210 | resolveTemplate (html) | <script>, <a href> | échappés |  |
| A-211 | resolveTemplate (html) | & ' " et &amp; | échappés une fois |  |
| A-212 | resolveTemplate (html) | <img onerror> | échappé |  |
| A-213 | resolveTemplate (texte) | texto, objet | aucune entité |  |
| A-214 | resolveTemplate (html) | [contract_html] | reste du HTML |  |
| A-215 | resolveTemplate (html) | champ perso en _html ({{client.notes_html}}…) | ÉCHAPPÉ | BUG corrigé 3ba3e558 (injection HTML dans le courriel) |
| A-220 | courriel envoyé (buildEmailLayout) | valeur piégée dans le corps | échappée dans le HTML final |  |
| A-221 | rendreCourrielClient | nom d’entreprise piégé | échappé partout |  |
| A-222 | rendreCourrielClient | accents, emojis ; <html lang> | conservés |  |
| A-223 | preheaderDepuis | valeur avec " < > | aperçu sans « &amp;quot; » | BUG corrigé ce86dbd1 |
| A-224 | rendreCourrielClient | logo / couleur piégés | ne sortent pas de l’attribut |  |
| A-225 | couleurBouton | couleurs pâles, invalides | repli #111827 |  |
| A-226 | echapper vs echapperHtml | 5 caractères | identiques |  |
| A-230 | sansPrenomVide | « Bonjour , » « Merci ! » | ponctuation recollée |  |
| A-231 | sansPrenomVide | « inc.. », « ... » | point simple, suspension gardée |  |
| A-232 | sansPrenomVide | dans du HTML | idem |  |
| A-233 | sansPrenomVide + resolveTemplate | prénom vide | « Bonjour, » |  |
| A-234 | accorderPluriels (fr) | 0 / 1 / 2 / 1 000 | singulier sous 2 |  |
| A-235 | accorderPluriels (en) | 0 / 1 / 2 | singulier = 1 |  |
| A-236 | accorderPluriels | sans nombre | intact |  |
| A-240 | applyTemplate | {cle} [cle] {{objet.cle}} | valeur |  |
| A-241 | applyTemplate | {{client_first_name}} | valeur | BUG corrigé c2772a07 |
| A-242 | applyTemplate | [50] | intact |  |
| A-243 | applyTemplate | inconnue / vide | gardée / effacée |  |
| A-244 | remplacerVariables (aperçu de l’éditeur) | {{client_first_name}} | « Marie » | BUG corrigé c2772a07 |
| A-245 | remplacerParExemples (aperçu des modèles) | {{client_name}} | exemple, sans accolades | BUG corrigé c2772a07 |
| A-246 | variablesInconnues | {{client_first_name}} / [prenom] | acceptée / signalée |  |
| A-247 | request_review, send_email, send_sms | double rendu, prénom de repli « Bonjour Bonjour » | — | NON COUVERT ici : exécution d’action (lit la base) — catégories B / H |
| A-260 | isQuietHours / horsFenetre | bornes 7 h 59 / 8 h / 19 h 59 / 20 h | calme ou non, heure locale |  |
| A-261 | isQuietHours / horsFenetre | minuit, 23 h 59 | calme ou non, heure locale |  |
| A-262 | isQuietHours / horsFenetre | 1er nov. 2026 (1 h 30 deux fois, 7 h 59 / 8 h EST) | calme ou non, heure locale |  |
| A-263 | isQuietHours / horsFenetre | 8 mars 2026, 14 mars 2027 | calme ou non, heure locale |  |
| A-264 | isQuietHours / horsFenetre | fuseau de l’entreprise (Vancouver, Halifax) | calme ou non, heure locale |  |
| A-265 | isQuietHours / horsFenetre | fuseau par défaut Toronto | calme ou non, heure locale |  |
| A-270 | horsFenetre | fenêtre 9-17 aux bornes | verdict exact |  |
| A-271 | horsFenetre | fenêtres 7-22, 21-22 | verdict exact |  |
| A-272 | horsFenetre | jours ouvrables ven. / sam. / dim. / lun. | week-end hors fenêtre |  |
| A-273 | horsFenetre | vendredi 23 h 30 locale ; dimanche du changement | hors fenêtre |  |
| A-274 | horsFenetre | jour de semaine lu dans le fuseau (Vancouver) | dimanche local |  |
| A-280 | nextSendTime | 20 h 18 | lendemain 8 h - 8 h 30 | constat : pas de 30 min depuis le départ (7 h 59 → 8 h 29), pas un bug |
| A-281 | nextSendTime | samedi + jours ouvrables | lundi |  |
| A-282 | nextSendTime | vendredi 22 h, 21-22 + jours ouvrables | lundi 21 h (≈ 71 h) |  |
| A-283 | nextSendTime | 1 h 30 EST le 1er nov. | 8 h EST |  |
| A-284 | nextSendTime | 1 h EST le 8 mars | 8 h EDT (6 h réelles) |  |
| A-285 | nextSendTime | 31 oct. 20 h 30 | 1er nov. 8 h |  |
| A-286 | nextSendTime | balayage 2 semaines × 6 réglages (dont changement d’heure) | toujours dans la fenêtre, 72 h au plus |  |
| A-287 | nextSendTime | fenêtre impossible (20-8, 12-12, 25-30, NaN) | fenêtre par défaut, jamais « maintenant » | BUG corrigé 8e7b0811 (message bloqué pour toujours, sans trace) |
| A-290 | corrigerChangementDHeure | 7 j avant un rdv après le 1er nov. | même heure locale |  |
| A-291 | corrigerChangementDHeure | rdv à 1 h 30 EST (heure répétée) | veille 1 h 30 EDT |  |
| A-292 | corrigerChangementDHeure | heure d’été 2026 et 2027 | même heure locale |  |
| A-293 | corrigerChangementDHeure | hors changement ; 2 h avant | aucune correction |  |
| A-294 | decalageLocalMin | été / hiver Toronto, Paris, minuit | −240 / −300 / +60 / +120 |  |
| A-300 | echeanceAvantDate | rdv déplacé plus tard, 7 j avant, à cheval sur le 1er nov. | replanifié à la même heure locale | BUG corrigé 3c4f7bd3 (rappel de parcours décalé d’une heure) |
| A-301 | planifierEtape (avant_date) | idem à la planification | tâche datée à la même heure locale | BUG corrigé 3c4f7bd3 |
| A-302 | echeanceAvantDate | moment dépassé de plus de 30 min | si_depasse |  |
| A-303 | echeanceAvantDate | moment atteint | suite |  |
| A-304 | echeanceAvantDate | rdv annulé | arrêt |  |
| A-305 | rappels-dates (balayage) | fuseau figé America/Toronto | — | CORRIGÉ : fuseauOrg lu par entreprise dans le balayage (A-rappels-fuseau-entreprise.test.ts) |
| A-310 | jourLocal (rappels-dates, dates-locales) | 23 h 59, minuit, 1er nov. | jour local |  |
| A-311 | jourDecale | ±1, 0 | jour civil |  |
| A-312 | jourDecale | 30, 365, −365, 29 février 2028 | jour civil |  |
| A-313 | jourDecale / jourLocal(décalage) | près de minuit, jour du changement d’heure | jour civil juste | BUG corrigé b4e1ec88 (visait la veille ; semaine de Lumi avec le 1er nov. en double) |
| A-314 | minuitLocal | Toronto été / hiver / jours de changement | instant UTC exact |  |
| A-315 | minuitLocal | Paris (heure d’été), Vancouver, 29 fév. | instant UTC exact |  |
| A-320 | fuseauOrg | fuseau réglé (avec espaces) | ce fuseau |  |
| A-321 | fuseauOrg | fuseau inconnu / vide / absent | repli Toronto |  |
| A-322 | fuseauOrg | cache 5 min par entreprise, oublierFuseau | une lecture |  |
| A-323 | fuseauOrg | lecture en erreur | repli, pas mis en cache |  |
| A-330 | automationRuleCreateSchema | règle minimale | acceptée ; brouillon, conditions {} |  |
| A-331 | automationRuleCreateSchema | description / folder_id / settings / steps / conditions = null | acceptés | conditions null : BUG corrigé (nullable) avec les messages clairs |
| A-332 | automationRuleCreateSchema | steps [] | = null |  |
| A-333 | automationRuleCreateSchema | conditions de chaque forme (eq…lte, suffixes, champs perso, étiquettes) | acceptées |  |
| A-334 | automationRuleCreateSchema | parcours complet (6 types d’étape et modes) | accepté |  |
| A-335 | automationSettingsSchema | réglages complets, bornes 7-22, 1-365 | acceptés |  |
| A-336 | automationRuleCreateSchema | délais 0, 1 an, −30 j | acceptés |  |
| A-337 | automationRuleUpdateSchema | clés envoyées seulement | pas de défaut qui dépublie |  |
| A-338 | automationRuleCreateSchema | 5 actions simples ; 8 dans un parcours | acceptées |  |
| A-339 | automationRuleCreateSchema | variante _en | acceptée |  |
| A-340 | automationRuleCreateSchema | nom absent / null / vide / espaces | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-341 | automationRuleCreateSchema | nom trop long / pas du texte | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-342 | automationRuleCreateSchema | description trop longue | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-343 | automationRuleCreateSchema | déclencheur inconnu / absent / null | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-344 | automationRuleCreateSchema | délai absent / null / texte / décimal | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-345 | automationRuleCreateSchema | délai > 1 an / < −30 j | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-346 | automationRuleCreateSchema | actions vides / null / absentes | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-347 | automationRuleCreateSchema | 6 actions simples / 21 actions | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-348 | automationRuleCreateSchema | action inconnue / sans config | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-349 | automationRuleCreateSchema | champ obligatoire vide ou null (texto, courriel) | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-350 | automationRuleCreateSchema | clé « to » (destinataire imposé), clé d’une autre action | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-351 | automationRuleCreateSchema | webhook http / interne / localhost | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-352 | automationRuleCreateSchema | condition : opérateur inconnu, {}, liste, null, in [] | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-353 | automationRuleCreateSchema | plus de 10 conditions, champ perso invalide | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-354 | automationRuleCreateSchema | réglage inconnu, fenêtre inversée / la nuit / en texte | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-355 | automationRuleCreateSchema | délai entre passages 0 / 366 | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-356 | automationRuleCreateSchema | publication « oui », dossier invalide | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-357 | automationRuleCreateSchema | étape de type inconnu / sans id / id illisible | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-358 | automationRuleCreateSchema | attente négative / > 1 an / avant_date sans durée ou > 30 j | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-359 | automationRuleCreateSchema | boucle, renvoi absent, fin sur attente, 31 étapes | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-360 | automationRuleCreateSchema | étape si sans conditions | REFUSÉ, message clair en français qui nomme le champ | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-361 | automationRuleCreateSchema | chaque refus A-340…A-360, interface anglaise | message anglais (params.en), sans jargon Zod |  |
| A-362 | automationRuleUpdateSchema | {}, nom null, « oui », délai en texte, déclencheur inconnu, boucle | REFUSÉ, message clair | BUG corrigé 7b406e25 « messages clairs » : avant, « Invalid input: expected string, received null », « Unrecognized key », « Invalid input » ou message anglais |
| A-363 | automationRuleUpdateSchema | conditions null | = {} |  |
| A-364 | validate → repondreDansLaLangue | même corps, fr puis en-CA | « Nom : obligatoire.; Délai : … » / « Name: required.; Delay: … » |  |
| A-370 | problemesDuGraphe | parcours vide | problème nommé en français |  |
| A-371 | problemesDuGraphe | identifiants en double | problème nommé en français |  |
| A-372 | problemesDuGraphe | renvoi absent via suivant / alors / sinon / si_reponse / si_depasse | problème nommé en français |  |
| A-373 | problemesDuGraphe | boucles directes et via sinon / si_reponse / si_depasse | problème nommé en français |  |
| A-374 | problemesDuGraphe | fin sur une attente | problème nommé en français |  |
| A-375 | problemesDuGraphe | branches qui se rejoignent | aucun problème |  |
| A-376 | sequenceEtapes (Lumi) | boucle / parcours correct | refusé / accepté |  |
| A-377 | problemesAvantPublication | déclencheur « bientôt » (non branché) | — | NON COUVERT : aucun déclencheur du catalogue actuel n’est marqué bientot |
| A-380 | verifierCoherence | délai négatif sur un déclencheur sans date / sans déclencheur | refusé, message clair |  |
| A-381 | verifierCoherence | plus de 30 j avant | refusé |  |
| A-382 | verifierCoherence | deux actions identiques | refusé |  |
| A-383 | verifierCoherence | cas valides | null |  |
| A-384 | route automation-rules | cible de demarrer / arreter_automatisation dans l’org | — | NON COUVERT en unitaire : la route lit la base — catégories B / C |
| A-385 | problemesAvantPublication | sans déclencheur / inconnu | bloquant |  |
| A-386 | problemesAvantPublication | « Date atteinte » sans champ date | bloquant |  |
| A-387 | problemesAvantPublication | rien à faire | bloquant |  |
| A-388 | problemesAvantPublication | action inconnue / indisponible (Slack) | bloquant |  |
| A-389 | problemesAvantPublication | action incompatible (envoyer_facture sur soumission) | bloquant |  |
| A-390 | problemesAvantPublication | champ obligatoire vide | bloquant |  |
| A-391 | problemesAvantPublication | renvoi vers étape supprimée (suivant, si_depasse) | bloquant | si_depasse : BUG corrigé fbf48265 |
| A-392 | problemesAvantPublication | fin sur une attente | bloquant |  |
| A-393 | problemesAvantPublication | étape fautive | etapeId renseigné |  |
| A-394 | problemesAvantPublication | condition vide, aucun message au client | avertissements |  |
| A-395 | problemesAvantPublication | règles correctes | rien de bloquant |  |
| A-396 | problemesAvantPublication | fr: false | anglais |  |
| A-397 | bloquantsPublication | préréglage au format d’origine | publiable |  |
| A-398 | bloquantsPublication | action provisoire « À compléter » | = parcours vide |  |
| A-399 | problemesPublication vs bloquantsPublication | avertissement seul | séparés |  |

## Matrice B — intégration (vrai moteur, staging, bureau de test en bac à sable)

Fichiers : `tests/automations-suite/integration/10-b-*.test.ts` (outils communs : `10-b-outils.ts`).
Lancer : `QA_AUTO_SUFFIXE=<s> npx vitest run --maxWorkers=4 --config vitest.automations.config.ts --project integration tests/automations-suite/integration/10-b-<fichier>.test.ts`

Principes : règles créées ET publiées par la vraie route de l'éditeur (`POST /api/automations/rules`) ; événements provoqués par le chemin de production (routes Express réelles montées en mémoire avec le RBAC, triggers SQL + `traiterEvenementsBase`, `pipeline_events` + `traiterEvenementsPipeline`, balayages), files traitées pour le bureau de test SEULEMENT (option `{ orgId }`). Témoin = `create_task` (ligne `tasks` exacte + journal `automation_execution_logs`). Une règle « vraie » et une « fausse » par cellule, la fausse créée d'abord (le moteur juge les règles par date de création).

## 1. Déclencheurs × condition vraie / fausse × témoin (`10-b-declencheurs.test.ts`, `10-b-webhooks-entrants.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-001 | lead.created — POST /api/leads/create | `email` = courriel du prospect | tâche liée `lead`/prospect, description rendue, 1 journal | PASS |
| B-002 | lead.created — POST /api/leads/create | `email` ≠ | aucun effet | PASS |
| B-003 | lead.status_changed — POST /api/leads/update-status | `new_status`=follow_up_1 ET `old_status`=new | tâche liée au prospect | PASS |
| B-004 | lead.status_changed | `new_status`=lost | aucun effet | PASS |
| B-005 | note.added — POST /api/activity-notes (client) | `note_sur`=client | tâche liée au client | PASS |
| B-006 | note.added | `note_sur`=job | aucun effet | PASS |
| B-007 | client.tagged — étiquette posée + POST …/client-tagged | `tag` visé | tâche liée au client | PASS |
| B-008 | client.tagged | autre `tag` | aucun effet | PASS |
| B-009 | client.untagged — POST …/client-untagged | `tag` visé | tâche liée au client | PASS |
| B-010 | client.untagged | autre `tag` | aucun effet | PASS |
| B-011 | task.completed — tâche `done` + POST …/task-completed | `task_title` exact | tâche liée au client de la tâche | PASS |
| B-012 | task.completed | autre titre | aucun effet | PASS |
| B-013 | job.ready_for_invoicing — technicien, POST …/job-completed | `job_name` | tâche liée au job | PASS |
| B-014 | job.ready_for_invoicing | autre `job_name` | aucun effet | PASS |
| B-015 | job.completed — jobs.status → completed (trigger SQL → file base) | `origine`=base ET `job_name` | tâche liée au job | PASS |
| B-016 | job.completed | autre `job_name` | aucun effet | PASS |
| B-017 | quote.sent — POST /api/quotes/send-email | `channel`=email ET `quote_number` | tâche liée au devis | PASS (courriel au client simulé) |
| B-018 | quote.sent | `channel`=sms | aucun effet | PASS |
| B-019 | quote.viewed — GET public /api/quotes/public/:jeton, vrai navigateur, anonyme | `ouverture`=premiere (liste) | tâche liée au devis | PASS |
| B-020 | quote.viewed | `is_first_view`=false | aucun effet | PASS |
| B-021 | quote.approved — acceptation signée (page publique) → trigger SQL | `origine`=base ET `quote_number` | tâche liée au devis | PASS |
| B-022 | quote.approved | autre `quote_number` | aucun effet | PASS |
| B-023 | quote.declined — refus (page publique) → trigger SQL | `client_id` | tâche liée au devis | PASS |
| B-024 | quote.declined | autre `client_id` | aucun effet | PASS |
| B-025 | quote.changes_requested — page publique | `quote_number` | tâche liée au devis | PASS |
| B-026 | quote.changes_requested | autre `quote_number` | aucun effet | PASS |
| B-027 | invoice.sent — brouillon → envoyée (trigger SQL) | `origine`=base ET `client_id` | tâche liée à la facture | PASS |
| B-028 | invoice.sent | autre `client_id` | aucun effet | PASS |
| B-029 | invoice.paid — POST /api/invoices/:id/mark-paid | `payment_type`=full, `provider`=manual, `amount_cents` | tâche liée à la facture | PASS |
| B-030 | invoice.paid | `payment_type`=deposit | aucun effet | PASS |
| B-031 | invoice.overdue — `detectOverdueInvoices` (J+1, fuseau du bureau) | `days_overdue`=1 | tâche liée à la facture | PASS |
| B-032 | invoice.overdue | `days_overdue`=3 | aucun effet | PASS |
| B-033 | invoice.viewed — drapeau `auto_consultation_documents`, GET public | `ouverture`=premiere | tâche liée à la facture | PASS |
| B-034 | invoice.viewed | `is_first_view`=false | aucun effet | PASS |
| B-035 | appointment.created — visite insérée (trigger SQL) | `title` | tâche liée au JOB porteur | PASS |
| B-036 | appointment.created | autre `title` | aucun effet | PASS |
| B-037 | appointment.cancelled — visite annulée (trigger SQL) | `job_id` | tâche liée au job | PASS |
| B-038 | appointment.cancelled | autre `job_id` | aucun effet | PASS |
| B-039 | agreement.signed — signature page publique du contrat | `signer_name` | tâche liée au job | PASS |
| B-040 | agreement.signed | autre signataire | aucun effet | PASS |
| B-041 | client.replied — texto entrant SIGNÉ Twilio (POST /api/messages/inbound) | `canal`=sms | tâche liée au client | PASS |
| B-042 | client.replied | `canal`=email | aucun effet | PASS |
| B-043 | client.inactive — drapeau `auto_client_inactif`, `balayerEntreprise` | `mois`=6 | tâche liée au client | PASS |
| B-044 | client.inactive | `mois`=12 | aucun effet | PASS |
| B-045 | custom_field.changed — PUT /api/custom-values (champ créé par la route des réglages) | `field_id` ET `new_value` | tâche liée au client | PASS |
| B-046 | custom_field.changed | autre `field_id` | aucun effet | PASS |
| B-047 | date.reached — `balayerRappelsDates` (champ date client = aujourd'hui) | `champ_id` ET `jours_avant`=0 | tâche liée au client | PASS |
| B-048 | date.reached | `jours_avant`=3 | aucun effet | PASS |
| B-049 | webhook.received — POST /api/hooks/:clé (clé créée par la route) | champ JSON `source`=site ET `webhook_id` | tâche sans lien (trace d'appel) | PASS |
| B-050 | webhook.received | `source`=facebook | aucun effet | PASS |
| B-051 | deal.stage_entered — deals.stage_id (trigger → pipeline_events) | `stage_id` visé | tâche sans lien (deal non liable), description = client du deal | PASS |
| B-052 | deal.stage_entered | autre étape | aucun effet | PASS |
| B-053 | deal.stage_idle — RPC `pipeline_detecter_stagnation` + file pipeline | `stage_id` ET `idle_days`=7 | tâche sans lien | PASS — la RPC balaie toutes les entreprises (pas de paramètre d'org) : le test refuse de l'appeler si une entreprise hors bac à sable a une règle active |
| B-054 | deal.stage_idle | autre étape | aucun effet | PASS |
| B-400 | lead.created — formulaire public POST /api/public/form/:clé/submit | `source`=request_form | tâche liée au prospect ; aucun appel réseau | PASS |
| B-401 | lead.created (formulaire) | `source`=site_web | aucun effet | PASS |
| B-402 | webhook Stripe — signature invalide | — | 400, aucun événement | PASS |
| B-403 | invoice.paid — `payment_intent.succeeded` SIGNÉ (secret de test) | `provider`=stripe ET `amount_cents__gte` | paiement écrit, facture `paid` solde 0, tâche liée | PASS |
| B-404 | invoice.paid (Stripe) | `provider`=manual | aucun effet | PASS |
| B-405 | invoice.paid — même événement Stripe rejoué | — | `already_processed`, 1 seule exécution | PASS |
| B-406 | invoice.paid — dépôt de soumission (`quote_deposit`) | `payment_type`=deposit | tâche liée au DEVIS, `deposit_status`=paid | PASS |
| B-407 | payment.failed — `payment_intent.payment_failed` (drapeau) | `raison_code`=insufficient_funds ET `montant_cents` | paiement `failed` + `failure_reason`, tâche liée à la facture | PASS |
| B-408 | payment.failed | `raison_code`=expired_card | aucun effet | PASS |
| B-409 | payment.failed — drapeau coupé | — | aucun déclenchement | PASS |
| B-410 | webhook.received sans règle | — | aucun envoi simulé | PASS |
| B-090 | estimate.sent, lead.converted, job.created, pipeline_deal.stage_changed | — | — | NON COUVERT : émis mais absents du catalogue (non créables à l'éditeur, refusés par Zod) — catégorie K (préréglages) |
| B-091 | client.replied par COURRIEL (synchro Gmail) | — | — | NON COUVERT : exige une boîte Gmail connectée (API Google, hors bac à sable) |
| B-092 | appointment.created ré-émis par POST …/appointment-rescheduled | — | — | NON COUVERT ici (pont navigateur) — catégorie C/J |

## 2. Actions × effet exact (`10-b-actions.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-100 | note.added | — | send_email : `envois_simules` courriel, destinataire = courriel du client, objet et HTML rendus, `meta.suivi`, sans List-Unsubscribe (transactionnel), `activity_log email_sent`, aucun fournisseur touché | PASS |
| B-101 | note.added | — | send_sms : destinataire E.164, corps final exact, `from` = numéro du bureau, `messages` sortant `SM_SIMULE_…` | PASS |
| B-102 | note.added | — | send_sms marketing : mention STOP ajoutée | PASS |
| B-103 | note.added | — | create_notification (équipe) : `notifications` type automation, titre/corps rendus, reference_id | PASS |
| B-104 | note.added | — | create_notification destinataire propriétaire : 1 ligne `user_id` = propriétaire | PASS |
| B-105 | note.added | — | send_notification (alias préréglages) | PASS |
| B-106 | note.added | — | envoyer_slack : échec propre « pas encore disponible », rien publié | PASS |
| B-107 | note.added | — | webhook : envoi simulé POST, corps JSON = org, entité, variables résolues | PASS |
| B-110 | note.added | — | create_task : priorité, échéance J+2, responsable, lien client | PASS |
| B-111 | note.added | — | create_task avec membre d'une autre entreprise : échec, aucune tâche | PASS |
| B-112 | note.added | — | ajouter_etiquette : ligne `client_tags` | PASS |
| B-113 | note.added | — | retirer_etiquette : ligne supprimée | PASS |
| B-114 | note.added | — | modifier_client : statut, source rendue, valeur | PASS |
| B-115 | note.added | — | assigner_responsable « seulement si vide » : assigne / respecte l'existant | PASS |
| B-116 | note.added | — | ajouter_note : `notes` rendue, rattachée au client | PASS |
| B-117 | note.added | — | update_custom_field : `value_text` écrit, aucun custom_field.changed relancé | PASS |
| B-118 | job.completed | — | request_review : sondage, courriel + texto simulés (lien /survey/jeton), `review_requests` | PASS |
| B-119 | note.added | — | request_review sur un déclencheur client : rattachée au client, anti-doublon 7 j | FAIL → CORRIGÉ (fa923eb9) |
| B-120 | appointment.created | `title` | modifier_statut_rendezvous : `schedule_events.status` | PASS |
| B-121 | custom_field.changed (job) | `field_id` | update_status : `jobs.status` ; table hors liste blanche refusée | PASS |
| B-122 | note.added | — | log_activity : `activity_log` type + métadonnées | PASS |
| B-123 | deal.stage_entered | `stage_id` | move_deal_stage : deal déplacé, historique `automation` | PASS |
| B-124 | deal.stage_entered | `stage_id` | modifier_deal : `deals.source` rendue | PASS |
| B-125 | deal.stage_entered | `stage_id` | assigner_deal : `assigned_user_id`, `assigned_at` | PASS |
| B-126 | custom_field.changed (facture brouillon) | `field_id` | envoyer_facture : courriel avec lien public, facture `sent` | PASS |
| B-127 | custom_field.changed (devis brouillon) | `field_id` | envoyer_soumission : courriel, `awaiting_response`, quote.sent émis → règle quote.sent suit (combinaison) | PASS |
| B-130 | note.added | — | demarrer_automatisation : la règle cible agit sur la même entité | PASS |
| B-131 | note.added | — | arreter_automatisation (toutes) : tâches prévues de l'entité `cancelled` | PASS |

## 3. Conditions (`10-b-conditions.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-200 | webhook.received (JSON réel) | texte, égalité simple (casse comprise) | vrai → tâche / `laval` → rien | PASS |
| B-201 | idem | `eq` | vrai / faux | PASS |
| B-202 | idem | `neq` | vrai / faux | PASS |
| B-203 | idem | `in` | vrai / faux | PASS |
| B-204 | idem | `not_in` | vrai / faux | PASS |
| B-205 | idem | `gt` nombre | vrai / faux | PASS |
| B-206 | idem | `gte` | vrai / faux | PASS |
| B-207 | idem | `lt` | vrai / faux | PASS |
| B-208 | idem | `lte` | vrai / faux | PASS |
| B-209 | idem | suffixe `montant__gte` | vrai / faux | PASS |
| B-210 | idem | deux opérateurs (entre) | vrai / faux | PASS |
| B-211 | idem | booléen | vrai / faux | PASS |
| B-212 | idem | date ISO `gt` | vrai / faux | PASS |
| B-213 | idem | métadonnée liste (contient) | vrai / faux | PASS |
| B-214 | idem | nombre en texte = nombre | vrai / faux | PASS |
| B-215 | idem | plusieurs clés = ET | vrai / faux | PASS |
| B-216 | idem | clé absente + `gt` | faux | PASS |
| B-220 | note.added (fiche client) | champ case `is` | vrai / faux | PASS |
| B-221 | idem | champ texte `is` normalisé | vrai / faux | PASS |
| B-222 | idem | texte `contains` / `not_contains` | vrai / faux | PASS |
| B-223 | idem | texte `is_not` | vrai / faux | PASS |
| B-224 | idem | courriel `is` (casse) | vrai / faux | PASS |
| B-225 | idem | téléphone `is` (E.164) | vrai / faux | PASS |
| B-226 | idem | nombre `gt` / `lt` | vrai / faux | PASS |
| B-227 | idem | nombre `eq` / `neq` | vrai / faux | PASS |
| B-228 | idem | montant `between` (cents) | vrai / faux | PASS |
| B-229 | idem | liste simple `any_of` / `none_of` | vrai / faux | PASS |
| B-230 | idem | liste multiple `any_of` | vrai / faux | PASS |
| B-231 | idem | date `today` / `yesterday` | vrai / faux | PASS |
| B-232 | idem | date `after` / `before` | vrai / faux | PASS |
| B-233 | idem | date `in_last` / `more_than_ago` | vrai / faux | PASS |
| B-234 | idem | fichier `is_empty` / `is_not_empty` | vrai / faux | PASS |
| B-235 | idem | deux champs = ET | vrai / faux | PASS |
| B-236 | idem | `client_a_etiquette` (insensible à la casse) / `client_sans_etiquette` | vrai / faux | PASS |
| B-237 | idem | métadonnée + champ + étiquette combinés | vrai / faux | PASS |

## 4. Parcours et délais (`10-b-parcours.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-300 | note.added — action → attendre 1 j → action | — | 1re étape en file (execute_at ≈ maintenant), 2e à +1 j, `franchies`=2, exécution quand due | PASS |
| B-301 | note.added — si / alors | `statut`=active (état actuel) | branche « alors » | PASS |
| B-302 | note.added — si / sinon | fiche passée inactive après le déclenchement | branche « sinon » | PASS |
| B-303 | note.added — si sur `champs_perso` | case cochée après le déclenchement | branche « alors » | PASS |
| B-304 | note.added — si → arrêter | — | rien après « arrêter » | PASS |
| B-310 | note.added — attendre réponse (2 j) | — | échéance +2 j ; vrai texto entrant signé → réveil → branche `si_reponse` | PASS |
| B-311 | note.added — attendre réponse, sans réponse | — | relance (`suivant`) | PASS |
| B-312 | appointment.created — attendre 1 j avant | — | échéance = début − 24 h ; rendez-vous avancé → rappel | PASS |
| B-313 | appointment.created — 1 j avant, réservé dans 2 h | — | branche `si_depasse` | PASS |
| B-314 | appointment.created — avant la date, annulé | — | parcours arrêté | PASS |
| B-315 | appointment.created — délai −1 j (règle simple) | — | tâche datée début − 24 h | PASS |
| B-316 | note.added — délai +1 h | — | tâche datée +1 h, exécutée quand due | PASS |
| B-320 | note.added — sans ré-entrée | — | 2e déclenchement = pas de 2e passage | PASS |
| B-321 | note.added — ré-entrée | — | 2 passages distincts | PASS |
| B-322 | note.added — arrêt sur réponse | — | texto de relance annulé « le client a répondu » | PASS |
| B-323 | invoice.sent — sortie de parcours (drapeau) | facture payée pendant l'attente | relance annulée avec motif | PASS |
| B-324 | note.added — règle repassée en brouillon | — | tâche annulée « en brouillon » | PASS |

## 5. Combinaisons à risque (`10-b-combinaisons.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-500 | client.inactive — deux règles même seuil, plafonds 25 et 50 | `mois`, `max_par_heure` | les deux partent | FAIL → CORRIGÉ (7546372e) |
| B-501 | deal.stage_idle — règles 3 j et 7 j sur la même étape, deal endormi 5 j | `stage_id`, `idle_days` | seule la règle 3 j part | FAIL → CORRIGÉ (fe0a7efc) |
| B-502 | client.tagged → ajouter_etiquette | — | la règle ne se relance pas elle-même | PASS |
| B-503 | client.tagged (A pose une étiquette) → règle B | `tag` relais | B suit, A dans la chaîne | PASS |
| B-504 | deal.stage_entered — e2→e3 et e3→e2 (ré-entrée) | `stage_id` | pas de va-et-vient après la fenêtre anti-doublon | FAIL → CORRIGÉ (584e934b) — test de 2 min 30 |
| B-590 | produit cartésien complet 28 × 24 × conditions | — | — | NON COUVERT : ≈ 700 cellules × 2 ; couverture raisonnée ci-dessus (chaque déclencheur × vrai/faux × témoin, chaque action × déclencheur représentatif, combinaisons à risque) |
| B-591 | invoice.paid Stripe/PayPal sans `payment_type` | `payment_type`=full | — | NON COUVERT (écart signalé) : mark-paid porte `payment_type: 'full'`, Stripe n'en porte aucun ; une règle filtrée sur `full` ne part pas pour un paiement en ligne. Aucun champ de l'éditeur ne l'expose : décision produit |

## C — Cas négatifs

Tests : `tests/automations-suite/integration/20-cde-negatifs.test.ts` (vrai moteur, staging, bureau A en bac à sable).
Déclencheur de travail : `note.added` sur un client (aucun préréglage ne l'écoute).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| C-001 | note.added | règle brouillon (`is_active=false`) | aucun journal, aucune tâche, aucune note, aucun envoi | PASS |
| C-002 | note.added | règle à la corbeille (`deleted_at`) restée `is_active=true` | aucun effet | PASS |
| C-003 | note.added | règle purgée (`deleted_at` + `purged_at`) | aucun effet | PASS |
| C-004 | note.added | règle supprimée physiquement | aucun journal, aucune note | PASS |
| C-005 | note.added | condition `canal = web`, événement `telephone` | aucun effet | PASS |
| C-006 | note.added | condition `montant >= 100`, métadonnée absente | aucun effet (comparaison impossible = refus) | PASS |
| C-007 | note.added | témoin positif : condition vraie | 1 note, 1 journal réussi | PASS |
| C-008 | note.added | `client_a_etiquette` absente du client | aucun effet | PASS |
| C-010 | tâche différée en file | règle repassée en brouillon avant l'échéance | tâches `cancelled`, motif « Automatisation en brouillon : envoi annulé. », rien exécuté | PASS |
| C-011 | tâche différée en file | règle mise à la corbeille | `cancelled`, « Automatisation supprimée : envoi annulé. » | PASS |
| C-012 | tâche différée en file | règle purgée | `cancelled`, rien exécuté | PASS |
| C-013 | tâche différée en file | règle supprimée physiquement | tâches supprimées (FK en cascade), rien exécuté | PASS — suppression sans trace dans les Journaux (inv-1 §6) |
| C-014 | tâche due | « Tout arrêter » (pause d'entreprise) | tâche laissée `pending`, `attempts=0` ; exécutée à la reprise | PASS |
| C-015 | note.added | pause d'entreprise | événement ignoré : ni journal ni tâche | PASS — l'événement est PERDU (pas rejoué à la reprise), comportement documenté |
| C-016 | événement + tâche due | `AUTOMATIONS_ENABLED=off` | rien traité, rien réclamé, file conservée | PASS |
| C-020 | note.added | client sans téléphone | texto sauté `sans_telephone` ; note et courriel faits | PASS |
| C-021 | note.added | client sans courriel | courriel sauté `sans_courriel` ; texto et note faits | PASS |
| C-022 | note.added | client sans prénom (nom présent) | `{client_first_name}` retombe sur le nom complet | PASS — règle de `setClientVars` |
| C-023 | note.added | entité inexistante | texto et courriel sautés avec motif, pas de plantage | PASS |
| C-024 | tâche différée | client mis à la corbeille entre événement et échéance | tâches `cancelled` « Annulée : le client a été supprimé. », aucune note, aucun envoi | PASS après correctif `cad85cf8` (avant : la note était ajoutée, tâches `completed`) |
| C-025 | tâche différée | client supprimé physiquement | idem C-024 | PASS après correctif `cad85cf8` |
| C-026 | note.added | 1re action en échec (étiquette vide) | échec journalisé, action suivante faite | PASS |
| C-027 | note.added | client sans aucun nom | « Bonjour, » propre, pas de `undefined` | PASS |
| C-028 | tâche différée texto | client à la corbeille + drapeau `auto_desabonnement_canal` | rien ne part, tâche `cancelled` | PASS après correctif `cad85cf8` (avant : texto transactionnel ENVOYÉ au client supprimé) |
| C-030 | parcours en cours | texte d'une étape DÉJÀ planifiée modifié | l'ANCIEN texte part (copie dans `action_config`) | PASS — règle du code documentée |
| C-031 | parcours en cours | texte d'une étape PAS ENCORE planifiée modifié | le NOUVEAU texte part (relu à la planification) | PASS — règle du code |
| C-032 | parcours en cours | étape planifiée supprimée | `cancelled` « Étape supprimée du parcours : envoi annulé. » | PASS |
| C-033 | parcours en cours | règle dépubliée | étape en attente `cancelled`, parcours arrêté | PASS |
| C-034 | tâche différée | délai de la règle modifié | l'échéance de la tâche déjà planifiée ne bouge pas | PASS — règle du code |
| C-035 | parcours en cours | brouillon puis republiée avant l'échéance | la tâche part (l'annulation se décide à l'échéance) | PASS — règle du code (inv-1 §9.20) |

## D — Idempotence et concurrence

Tests : `tests/automations-suite/integration/20-cde-idempotence.test.ts` (vrai moteur, staging, bureau A en bac à sable).
« Faire passer le temps » : les journaux sont vieillis (horodatage + tranche de la clé anti-doublon) pour simuler un tick de 5 min.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| D-001 | rejeu outbox | même `domain_events.id`, règle déjà cochée | aucun second effet | PASS |
| D-002 | rejeu outbox | traitement coupé (règle non cochée), 5 min plus tard | l'action réussie n'est pas refaite (`rejoueDepuis`) | PASS |
| D-003 | note.added ×2 | double clic | 1 note, 1 courriel | PASS |
| D-004 | note.added ×6 | `Promise.all`, même entité | 1 effet par action | PASS |
| D-005 | note.added ×6 | `Promise.all`, 6 entités | 6 effets, aucun perdu | PASS |
| D-006 | règle différée | même événement ×2 | 1 seule tâche (`idx_scheduled_tasks_dedup`) | PASS |
| D-010 | reprise de tâche courriel | récupérée après envoi (running figée) | saut `deja_envoye`, pas de 2e courriel | PASS |
| D-011 | reprise de tâche texto | idem | saut `deja_envoye`, pas de 2e texto | PASS |
| D-012 | webhook en reprise | panne puis succès | même `Idempotency-Key` (`<tâche>:action`) aux deux essais | PASS |
| D-020 | 3 workers `processScheduledTasks` concurrents | 8 tâches dues | chaque tâche exécutée 1 fois (`attempts=1`), 8 notes | PASS |
| D-021 | 2 workers concurrents | parcours | l'étape suivante planifiée 1 fois | PASS |
| D-030 | ré-entrée | sans / avec `reentree`, tâche en attente | refusé / 2 passages (clés distinctes) | PASS |
| D-031 | ré-entrée immédiate | `reentree`, 2 émissions simultanées | 1 seul effet | PASS |
| D-032 | `delai_entre_passages_jours=1` | 2e passage 5 min après / 2 j après | sauté / repart ; témoin sans réglage repart | PASS |
| D-040 | boucle d'étiquettes | A retire X ↔ B remet X | A 1 fois, B 1 fois, chaîne `[]→[A]→[A,B]`, arrêt | PASS |
| D-041 | boucle `demarrer_automatisation` | A → B → A | 2e démarrage sauté `boucle` | PASS |
| D-042 | boucle de deal | A : S1→S2, B : S2→S1, 6 ticks de 5 min | 2 déplacements puis arrêt, deal en S1 | PASS après correctif `e163a414` (avant : 6 déplacements en 6 ticks, sans fin) |
| D-043 | `pipeline_events` sans réclamation atomique | 2 instances hors verrou | — | NON COUVERT : le tick est sous `withAdvisoryLock` ; deux consommateurs concurrents exigeraient d'appeler la file hors verrou (inv-1 §9.4), non reproduit |
| D-044 | `rappels-dates` rejoué le même jour | — | — | NON COUVERT : relève des déclencheurs temporels (plage B/K), route cron sans verrou (inv-1 §9.6) |

## E — Échecs et reprise

Tests : `tests/automations-suite/integration/20-cde-reprise.test.ts` (vrai moteur, staging, bac à sable en mode `panne` / `delai`)
et `tests/automations-suite/unitaires/cde-classement-erreurs.test.ts` (fonctions pures).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| E-001 | tâche courriel | fournisseur en panne ×4 | reprises 5 / 30 / 120 min, puis `failed` + notification `automation_failed` ; 4 journaux d'échec | PASS |
| E-002 | tâche texto | fournisseur en délai dépassé, puis rétabli | reprise, puis 1 seul texto réussi | PASS |
| E-003 | tâche | erreur définitive (étiquette vide) | `failed` au 1er essai + notification | PASS (grâce au correctif `b73fc65f`) |
| E-004 | règle à 2 actions différées | 1 en panne | l'autre tâche faite | PASS |
| E-010 | parcours note → courriel → note | courriel en panne puis rétabli | reprise au courriel, 1re note non refaite, suite exécutée | PASS |
| E-011 | parcours | étape en échec définitif | parcours arrêté, suite jamais planifiée, notification | PASS |
| E-020 | redémarrage | tâche `running` figée 20 min | récupérée, exécutée 1 fois | PASS |
| E-021 | redémarrage | tâche `running` depuis 2 min | laissée tranquille | PASS |
| E-022 | redémarrage | délai de 3 j en attente | statut et échéance intacts après des ticks | PASS |
| E-023 | redémarrage | courriel envoyé puis processus coupé | récupéré sans 2e envoi | PASS |
| E-030 | action immédiate | courriel en panne | échec journalisé avec motif, action suivante faite | PASS — règle du code : aucune reprise pour l'immédiat |
| E-031 | action immédiate | texto de confirmation en panne passagère | reprise planifiée OU notification | ROUGE ATTENDU (`it.fails`) — décision requise : aujourd'hui ni reprise ni notification |
| E-032 | `sendEmail({ reessayer })` | fournisseur en panne | ligne `email_retry_queue` `pending`, 1re reprise à 5 min | PASS |
| E-033 | courriel d'automatisation | en panne | n'entre PAS dans `email_retry_queue` (reprise par la file des tâches) | PASS — règle du code |
| E-040 | `isTransientFailure` | 37 motifs définitifs réels | jamais repris | PASS après correctif `b73fc65f` (32 étaient repris 4 fois) |
| E-041 | `isTransientFailure` | 15 motifs passagers | repris (dont 408/429, délai 5 s) | PASS |
| E-042 | webhook | DNS `EAI_AGAIN` | erreur passagère, reprise | PASS après correctif `bca09a99` (avant : « Adresse refusée », définitif) |
| E-043 | webhook | DNS `ENOTFOUND` | reste « Adresse refusée », définitif | PASS |
| E-044 | délai dépassé réel (5 s) | action lente qui aboutit après | reprise annulée, étape suivante ouverte | NON COUVERT ici : le mode `delai` du bac à sable échoue tout de suite ; couvert par `tests/automation/vague2-delai-depasse.test.ts` |

## Matrice F — Sécurité / multi-tenant (suffixe `secu`)

Fichiers : `integration/30-fgh-rls.test.ts`, `integration/30-fgh-routes.test.ts`, `integration/30-fgh-moteur.test.ts`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| F-001 | RLS `automation_rules` | proprio B, JWT réel | ne lit/insère/modifie/supprime rien de A ; A voit sa ligne | PASS |
| F-002 | RLS `automation_folders` | idem | idem | PASS |
| F-003 | RLS `automation_scheduled_tasks` | idem | idem | PASS |
| F-004 | RLS `automation_execution_logs` | idem | idem | PASS |
| F-005 | RLS `automation_webhooks` | idem | idem | PASS |
| F-006 | RLS `automation_webhook_receipts` | idem | idem | PASS |
| F-007 | RLS `automations` (table héritée) | idem | idem | PASS — policies « tout membre », mais bornées à l'org |
| F-008 | RLS `email_unsubscribes` | idem | idem | PASS |
| F-009 | RLS `sms_opt_outs` | idem | idem | PASS |
| F-010 | RLS `consents` | idem | idem | PASS |
| F-011 | RLS `org_features` | idem | B ne bascule pas les drapeaux de A | PASS |
| F-012 | RLS `review_requests` | idem | idem | PASS |
| F-013 | RLS `satisfaction_surveys` | idem | idem | PASS |
| F-014 | `pipeline_events`, `domain_events` | proprio B / A | aucune ligne de A pour B ; outbox illisible pour authenticated | PASS |
| F-015 | `automation_evenements_base` | A et B | lecture et écriture refusées (serveur seulement) | PASS |
| F-016 | `clients_inactifs_declenches` | A et B | idem | PASS |
| F-017 | `paiements_echoues_traites` | A et B | idem | PASS |
| F-018 | `envois_simules` | A et B | idem | PASS |
| F-019 | `orgs_envois_simules` | A et B | idem (une org ne s'inscrit ni ne se retire elle-même) | PASS |
| F-020 | `orgs_envois_simules` | B supprime la ligne de A | 0 ligne, A reste en bac à sable | PASS |
| F-021 | RBAC par la RLS, technicien A | lecture règles / dossiers / adresses d'appel / reçus | 0 ligne | PASS |
| F-022 | RBAC par la RLS, technicien A | créer / publier / réécrire les actions / supprimer | refusé, règle intacte | PASS |
| F-023 | RBAC par la RLS, technicien A | file planifiée + journal (contenus, destinataires) | 0 ligne ; le proprio les lit | PASS — DÉCISION : c'était bien une fuite (textes, montants, destinataires) ; fermée par la migration 20261003100100, appliquée sur staging (prouvé ici) |
| F-024 | `automation_webhooks.api_key` | même le proprio | colonne illisible (privilège de colonne) | PASS |
| F-030 | en-tête x-org-id = bureau B | proprio A | 403 `org_forbidden` | PASS |
| F-031 | GET rules / editeur?rule_id=<B> | proprio A | la règle de B n'est jamais renvoyée | PASS |
| F-032 | PATCH / DELETE / duplicate / restaurer / definitivement (règle de B) | proprio A | 404, B intacte, aucune copie | PASS |
| F-033 | publication unitaire et en lot (règle de B) | proprio A | 404 / `ok:false`, B en brouillon | PASS |
| F-034 | POST /rules/:id/apercu (règle de B) | proprio A | 404 | PASS |
| F-035 | copier-bureaux | règle A → org B ; règle B → A | `sans_droit` ; 404 | PASS |
| F-036 | dossiers de B | PATCH / DELETE | 404, intact | PASS |
| F-037 | adresses d'appel de B | PATCH / regenerer / DELETE / liste | 404, clé inchangée, jamais listée | PASS |
| F-038 | POST /automations/pause | proprio A | B non touché | PASS |
| F-040 | events/lead-created | client de B | 404, aucune règle de A ne tourne | PASS après a45918c3 (FAIL avant : règles de A exécutées sur le client de B) |
| F-041 | events/lead-status-changed | client de B | 404 | PASS après a45918c3 (FAIL avant : tâche créée dans A, liée au client de B) |
| F-042 | events/quote-sent | devis de B | 404 | PASS après a45918c3 |
| F-043 | events/appointment-rescheduled | rendez-vous de B | 404, le rappel de B reste `pending` | PASS après a45918c3 |
| F-044 | events/client-tagged, job-completed, task-completed | objets de B | 404 | PASS |
| F-050 | GET /automations/rules | technicien A | 403 | PASS |
| F-051 | créer / modifier / publier (unitaire, lot) / dupliquer / supprimer / modèle / pause / webhook | technicien A | 403, rien d'écrit | PASS |
| F-052 | events lead-created / quote-sent | technicien A | 403 | PASS |
| F-053 | témoin | proprio B dans son bureau | lit sa règle | PASS |
| F-060 | événement de B | règle active de A | la règle de A ne tourne pas (témoin A : elle tourne) | PASS |
| F-061 | variables d'un deal de B | événement de A | aucune donnée du client de B | PASS après d0f32844 (FAIL avant : courriel du client de B résolu depuis A) |
| F-062 | demarrer_automatisation vers une règle de B | règle de A | échec, B ne tourne pas | PASS |
| F-063 | arreter_automatisation (toutes) | même entity_id qu'une tâche de B | tâche de B intacte | PASS |
| F-070 | injection prénom / nom `<script>`, `<img onerror>` | courriel | échappés dans envois_simules.corps ; expéditeur sans balise | PASS |
| F-071 | injection par champ perso à clé `…_html` | courriel | échappé | PASS après 66fbe647 (FAIL avant : `<img onerror>` actif) |
| F-080 | plafond par client, texto commercial | 4 envois / 24 h | 3 partent, le 4e échoue « Frequency cap (max 3) » | PASS |
| F-081 | plafond par client, courriel commercial | 4 envois / 24 h | idem | PASS |
| F-082 | étalement par bureau | 30 textos dans la minute | le suivant est reporté (+60 s, `report_rafale`) | PASS |
| F-083 | mesure du plafond global | règle ayant déjà 500 textos aujourd'hui | le 501e part | PASS (mesure) |
| F-084 | plafond global par automatisation | idem | ROUGE ATTENDU — décision requise : aucun plafond global (décision F11 du 2026-09-23), seulement 30/min/bureau et 3 commerciaux/client/24 h ; un envoi transactionnel n'est jamais plafonné → 5 000 clients étiquetés = 5 000 textos en ≈ 2 h 47 | it.fails |
| F-085 | fournisseurs réels | tout le fichier moteur | 0 appel Twilio, 0 appel HTTP | PASS |
| F-090 | events/deal-stage-changed (ancien pipeline porte-à-porte) | `dealId` d'un autre bureau | — | NON COUVERT : émet `pipeline_deal.stage_changed` (table `pipeline_deals`, ancien pipeline) ; le lead est filtré par org, aucune variable de B ne sort, mais `dealId` reste non vérifié — à traiter avec le retrait de l'ancien pipeline |

## Matrice G — Conformité LCAP / Loi 25 et marque (suffixe `secu`)

Fichier : `integration/30-fgh-conformite.test.ts`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| G-001 | courriel marketing différé | drapeau `auto_desabonnement_canal` éteint | lien `/api/unsubscribe/<jeton>` + `List-Unsubscribe` + One-Click | PASS |
| G-002 | courriel marketing immédiat | drapeau éteint | idem | PASS après dd6000e1 (FAIL avant : aucun lien, aucun en-tête) |
| G-003 | courriel transactionnel immédiat | — | aucun lien de désabonnement (voulu) | PASS |
| G-004 | courriel marketing immédiat | drapeau allumé | lien + en-têtes | PASS |
| G-010 | désabonné courriel + STOP | drapeau éteint | aucun courriel ni texto, commercial ET transactionnel (étapes « sautées ») | PASS |
| G-011 | désabonné courriel + STOP | drapeau allumé | commercial sauté, transactionnel part | PASS |
| G-012 | texto marketing immédiat | drapeau éteint | « <Entreprise> - Répondez STOP pour ne plus recevoir. » ajouté | PASS |
| G-013 | request_review | client désabonné + STOP | rien ne part | PASS |
| G-014 | courriel marketing immédiat, client sans consentement ni relation | drapeau éteint | mesure : il part | PASS (mesure) |
| G-015 | idem | idem | ne devrait pas partir | ROUGE ATTENDU — décision requise : consentement et plafond de fréquence ne sont vérifiés que si `ctx.commercial` (envoi différé ou drapeau allumé). Proposition : `commercial = marketing` aussi en immédiat drapeau éteint (ou activer le drapeau pour toutes les entreprises) |
| G-020 | marque | logo + `brand_color` + nom | `<img alt=nom>`, couleur, nom ; nom d'expéditeur = entreprise | PASS |
| G-021 | traces de Lume | contenu VISIBLE (HTML sans `<style>` ni classes, texte, objet, Reply-To) | aucun « Lume », « Powered by », « Envoyé avec » | PASS — restent, invisibles au lecteur : classes CSS `lume-fond` / `lume-texte` du gabarit (source HTML) |
| G-022 | petit mascot Lume en bas du courriel | — | présent | ROUGE ATTENDU — décision requise : exigence de Rafba vs norme « marque blanche côté client » du 2026-09-30 (mascot retiré le 2026-09-29, `server/lib/courriels/gabarit.ts`) |
| G-023 | adresse d'expédition | entreprise sans domaine vérifié | pas `@lumecrm.net` | ROUGE ATTENDU — décision requise : contrainte technique (SPF/DKIM de la plateforme) ; seul un domaine vérifié par l'entreprise (`senderForOrg`, PR #524) l'évite. Les liens publics (désabonnement, /quote, /invoice, /survey) sont aussi sur le domaine de Lume (PUBLIC_URL) |

## Matrice H — Langue et contenu (suffixe `secu`)

Fichiers : `integration/30-fgh-langue.test.ts`, `tests/automations-fgh-segments-sms.test.ts` (unitaire, sans réseau).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| H-001 | courriel + texto marketing | entreprise EN | objet/corps `_en`, `<html lang="en">`, « Unsubscribe from these emails », « Reply STOP to opt out. » | PASS |
| H-002 | idem | entreprise FR (témoin) | tout en français | PASS |
| H-003 | request_review | entreprise EN | courriel « How did we do? » ET texto en anglais | PASS après f7dbc906 (FAIL avant : texto toujours en français) |
| H-004 | [appointment_time] / [appointment_date] | entreprise EN | « 02:00 p.m. », pas « 14 h 00 » ; FR garde « 14 h 00 » | PASS après e09f0482 |
| H-005 | create_notification par courriel | membre `language = en` | titre `title_en` | PASS |
| H-006 | `default_language = 'en-CA'` | — | refusé (CHECK fr/en, 23514) : l'écart `langueOrg` (=== 'en') / `langueDe` (startsWith) est sans effet | PASS |
| H-010 | segmentsSms, accents GSM-7 | é è à ù | GSM-7, 160 puis 153 | PASS |
| H-011 | segmentsSms, hors GSM-7 | ê ç ’ « » ô î û ë | UCS-2, 70 puis 67 ; caractère d'extension = 2 unités | PASS |
| H-012 | mention STOP | FR / EN | reste en GSM-7 | PASS |
| H-013 | confirmations STOP / REPRENDRE | FR | STOP : GSM-7, 2 segments ; REPRENDRE : UCS-2 (« êtes »), 2 segments | PASS (mesure) |
| H-014 | éditeur de texto (MessageEditor) | texte avec accents | compteur = vrai nombre de segments + alerte UCS-2 | PASS après ab9d7ebe (FAIL avant : longueur / 160) |
| H-020 | `invoice_due_date`, `quote_valid_until` | — | date lisible | NON COUVERT : ISO brut (AAAA-MM-JJ) dans les deux langues — pas un défaut de langue, choix de format à décider |
| H-021 | éditeur plein écran (PanneauEtape) | texto | compteur de segments | NON COUVERT : l'éditeur plein écran n'a aucun compteur ; seul MessageEditor (Réglages › Messagerie) en a un |
| H-022 | request_review, client sans prénom | FR | pas « Bonjour Bonjour, » | NON COUVERT ici (inv-2 §9-4, contenu) ; le repli anglais est « there » |

## Matrice I — Lumi et les automatisations

Vrai chemin : `POST /api/lumi/chat` (orchestrateur, routeur actif, vrai modèle) → carte → `POST /api/lumi/execute`, JWT du propriétaire du bureau A. Fichiers : `40-iklm-lumi-demandes`, `40-iklm-lumi-reglages`, `40-iklm-lumi-outils`, `unitaires/iklm-lumi-aiguillage`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| I-001 | FR « relance de soumission à J+3 » | — | quote.sent → attente 3 j → texto ; règle en pause | vrai modèle |
| I-002 | FR « rappel par texto la veille de chaque RDV » | — | appointment.created → attente avant_date 86400 → texto | corrigé : la FAQ « SMS » interceptait la demande (a78e61f7) |
| I-003 | FR « avis Google après job terminé » | — | job.completed → demande d'avis | |
| I-004 | FR « étiquette VIP si facture > 5 000 $ payée » | montant > 5000 | invoice.paid → si montant > 5000 → ajouter_etiquette VIP | corrigé : aucune condition de montant (d2319854) |
| I-005 | FR parcours 3 étapes prospect, attente de réponse | sans réponse 2 j | texto → attente réponse 2 j → courriel → 5 j → tâche | corrigé (9d0abe1c, d2319854) ; 1 rejet de validation non reproduit en 3 passes (motif désormais journalisé, 7b720931) |
| I-006 | EN « thank-you email when quote approved » | — | quote.approved → courriel immédiat EN | corrigé : messages forcés en français (46a9fc92) |
| I-007 | EN « text 2 h before appointment » | — | avant_date 7200 → texto EN | idem |
| I-008 | EN « 7 days after invoice sent, if unpaid, email with link » | impayée | attente 7 j → si unpaid → courriel [invoice_link] EN | idem |
| I-009 | FR « quand j'ajoute l'étiquette VIP, notifie l'équipe » | tag = VIP | client.tagged → si tag VIP → notification | corrigé : aucun filtre, partait pour toute étiquette (d2319854) |
| I-010 | FR « 1 jour après job terminé, courriel satisfaction » | — | attente 1 j → courriel | |
| I-011 | FR « nouveau prospect → tâche » | — | lead.created → create_task, aucun message client | |
| I-012 | EN « text new lead, again if no reply after 1 day » | sans réponse | texto → attente (réponse) 1 j → texto EN | corrigé (langue + attente réponse) |
| I-013 | FR « 2 j après refus, courriel » | — | quote.declined → 2 j → courriel | |
| I-014 | FR « texto de remerciement au paiement » | — | invoice.paid → texto | |
| I-015 | EN 2 relances de devis à 5 et 10 j si non accepté | toujours envoyé | 5 j → si sent → courriel → 5 j → si sent → courriel | |
| I-016 | FR « RDV annulé → texto pour reprendre » | — | appointment.cancelled → texto | |
| I-017 | FR « courriel de bienvenue à la signature » | — | agreement.signed → courriel | |
| I-018 | FR parcours facture : 3 j si impayée texto + lien, 4 j si impayée tâche | impayée | … | corrigé : routé vers « facturation » sans l'outil (2c3b4f01) |
| I-019 | EN « Google review when job completed » | — | job.completed → avis | |
| I-020 | FR « nouveau prospect : notifie-moi, 1 j après courriel » | — | notification → 1 j → courriel | |
| I-021 | Ambigu « Fais-moi une automatisation pour mes clients » | — | une question, aucune carte, aucune règle | |
| I-022 | Ambigu « Automatise mes rappels » | — | idem | |
| I-023 | Coût de la passe « demandes » | — | < 60 ¢ | mesuré 25,5 / 36,8 / 29,7 ¢ |
| I-024 | « Active l'automatisation X » | — | toggle → is_active true, et le moteur l'inscrit (tâche planifiée) | |
| I-025 | « Mets en pause X » | — | is_active false | |
| I-026 | « Change le texto de X pour … » | — | steps : corps exact | |
| I-027 | « Change objet et texte du courriel de X » | — | steps : objet + corps | |
| I-028 | « Messages automatiques en anglais » | — | company_settings.default_language = en | |
| I-029 | Coût de la passe « réglages » | — | < 20 ¢ | 4,1 ¢ |
| I-030 | Outil : déclencheur inventé par le modèle | — | refusé, rien en base | corrigé (54dabf74) |
| I-031 | Outil : « démarrer » une règle inexistante | — | refusé | corrigé (54dabf74) |
| I-032 | Outil : 2e automatisation (client.replied) | 1×/7 j par client | créée en pause, delai_entre_passages_jours 7 | corrigé (54dabf74) |
| I-033 | Outil : langue de l'entreprise = en | — | consignes anglaises au générateur | corrigé (46a9fc92) |
| I-034 | list_automations | corbeille / purgée | non listées | corrigé (d6b41e5b) |
| I-035 | Redemander la même automatisation < 24 h après l'avoir supprimée | — | doit créer | ROUGE ATTENDU — décision : empreinte d'idempotence 24 h (agent_actions) → « c'est fait » sans rien créer ; touche toutes les écritures de Lumi |
| I-040 | « Crée … » / « Create … » | — | jamais de réponse FAQ | corrigé (a78e61f7) |
| I-041 | Vraie question produit | — | garde sa FAQ | |
| I-042 | « crée un parcours / automatise / workflow » | — | indice → create_automation_from_text | corrigé (9d0abe1c) |

## Matrice J — Interface (page Automatisations, Playwright)

Projet vitest `ui` (`tests/automations-suite/ui/`) : vrai Chromium, API locale sans tâche de fond ni fournisseur (port 3071), Vite (5191), bureau A de test. Chaque geste est vérifié à l'écran ET dans `automation_rules` (service_role).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| J-001 | Liste | règle du bureau en base | la ligne affiche nom + « Brouillon » | 70-ui-liste |
| J-002 | Liste — chargement | requête des règles retenue | indicateur de chargement, jamais « Aucune automatisation » | 70-ui-liste |
| J-003 | Liste — vide | aucune règle | « Aucune automatisation » | 70-ui-liste |
| J-004 | Liste — erreur | lecture des règles en 503 | message « Impossible de charger… » + « Réessayer » qui recharge ; jamais l'état vide | BUG corrigé (l'échec affichait « Aucune automatisation ») |
| J-010 | Créer › Partir de zéro | avant tout geste | 0 ligne créée ; renommer crée UNE règle, brouillon, trigger quote.sent, steps vides | 71-ui-editeur |
| J-011 | Éditeur — déclencheur | tiroir « Facture envoyée » | trigger_event = invoice.sent, affiché sur le bouton | 71-ui-editeur |
| J-012 | Éditeur — action | « Notifier l'équipe », nom + titre | step action create_notification {nom, title} = la carte | 71-ui-editeur |
| J-013 | Éditeur — délai + texto | attente 2 jours puis texto | chaîne action→attendre(172800)→send_sms, cartes identiques | 71-ui-editeur |
| J-014 | Éditeur — texte | modifier le corps du texto | seul config.body change en base | 71-ui-editeur |
| J-015 | Éditeur — condition | « + » entre deux cartes, `total_cents > 5000` / `statut = sent` | step si {total_cents:{gt:5000}, statut:'sent'}, suite sous « alors » | BUG corrigé (a11y : les « + » étaient `aria-hidden`, invisibles des lecteurs d'écran) |
| J-016 | Éditeur — rechargement | recharger | cartes identiques, base inchangée (updated_at) | 71-ui-editeur |
| J-017 | Éditeur — Réglages | ré-entrée, fenêtre 9–17, jours ouvrables, 7 j | settings exact, relu après rechargement ; remis par défaut = clé retirée | 71-ui-editeur |
| J-018 | Éditeur — publier | interrupteur + confirmation | is_active=true, « Publiée » | 71-ui-editeur |
| J-019 | Éditeur — dépublier | interrupteur | is_active=false, « Brouillon », relu après rechargement | testé dans le même test que J-018 |
| J-020 | Liste — dupliquer | menu « Dupliquer » | copie brouillon, non préréglage, mêmes steps ; source intacte | 70-ui-liste |
| J-021 | Liste — supprimer | menu « Supprimer » + confirmation | deleted_at posé, is_active=false, visible dans Corbeille « Supprimée » | 70-ui-liste |
| J-022 | Corbeille — restaurer | menu « Restaurer » | deleted_at null, brouillon, de retour dans « Toutes » | testé dans le même test que J-021 |
| J-023 | Créer › Partir d'un modèle | 1er modèle, « Utiliser ce modèle » | copie brouillon ; nb de cartes = nb d'étapes en base ; nom affiché = nom en base | 72-ui-modeles-langue-mobile |
| J-024 | Liste — interrupteur de ligne | publier puis dépublier | is_active suit, statut « Publiée »/« Brouillon » | 72 |
| J-025 | Interface EN | éditeur en anglais, ajout « Notify the team » | même règle affichée ; texte par défaut anglais écrit en base | 72 |
| J-026 | Langue des messages | bouton EN puis FR | company_settings.default_language = en puis fr, relu après rechargement | 72 |
| J-027 | Téléphone (UA iPhone, 390×844) | /automations | porte « application » (mobileGate : /automations n'est pas dans CHEMINS_PUBLICS) — la page n'est pas servie sur téléphone, c'est voulu | 72 |
| J-028 | Fenêtre étroite 390 px (ordinateur) | liste | pas de défilement horizontal de la page ; « Créer » et l'ouverture d'une règle fonctionnent | 72 |
| J-030 | Réglages du déclencheur | « Devis ouvert » : première ouverture + min 500 | conditions {ouverture:'premiere', montant__gte:500}, détail sous la carte, relu | 71 |
| J-040 | Validation — étape incomplète | texto vidé | « Enregistrer » grisé + « « Texte du message » est vide. » ; rien écrit | 71 |
| J-041 | Validation — publication bloquée | « Date atteinte » sans champ | refus avant confirmation, message, is_active reste false | 71 |
| J-050 | Éditeur — chargement | requête retenue | indicateur, jamais « introuvable » | 71 |
| J-051 | Éditeur — erreur | /api/automations/editeur en 503 | « Impossible de charger… » + « Réessayer » qui recharge | 71 |
| J-060 | Écart UI↔moteur §2.4 n°7 (Réglages › Messagerie) | règle à étapes, texto modifié | l'écran montre le texte des étapes (celui qui part) ; l'enregistrement écrit steps ET actions | BUG corrigé (`updateRuleMessage` n'écrivait que `actions`) |
| J-061 | Écart §2.4 n°1 (« si » + étiquettes) | — | — | NON COUVERT ici : écart du MOTEUR (conditionsEtiquettesOk absent des étapes « si »), sans effet visible à l'écran ; relève de la matrice B |
| J-062 | Écart §2.4 n°2 (« si » sur RDV / deal) | — | — | NON COUVERT ici : moteur (metadonneesFraiches), invisible à l'écran ; matrice B |
| J-063 | Écart §2.4 n°3 (plafond client.inactive, jours_avant) | — | — | NON COUVERT ici : balayages serveur, pas de geste d'interface qui le révèle |
| J-064 | Écart §2.4 n°4 (opérateurs in/not_in) | — | — | NON COUVERT : absence d'UI voulue (6 opérateurs offerts), pas un défaut constaté |
| J-065 | Écart §2.4 n°11 (PATCH publie une règle en corbeille) | — | — | NON COUVERT : non atteignable depuis l'interface (l'éditeur publie par la route de publication, qui refuse la corbeille) ; relève des tests d'API |

## Matrice K — Préréglages et systèmes adjacents

Fichiers : `40-iklm-prereglages.test.ts`, `40-iklm-adjacents.test.ts`. Bureau A semé par `seedOrgComplete` (industrie residential_cleaning), B (roofing). Chaque moteur tourne avec `{ orgId }`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| K-001 | Socle par métier | Nettoyage vs Toiture | même ensemble de préréglages et d'états | l'UI propose 10 métiers, aucun « construction » (seulement marketing/pipeline) |
| K-002 | Publiés d'office | création | = PACK_ACTIF ; sollicitations, avis, estimate_followup en brouillon | le trigger SQL sème 35 préréglages TOUS ACTIFS (sollicitations comprises) avant le filet serveur — observé sur nos bureaux ; non testé automatiquement (il faudrait créer une entreprise jetable) |
| K-003 | estimate_followup | — | mort : seul émetteur /emails/send-quote, jamais appelé par l'UI | brouillon |
| K-010 | lead.created | — | pack_suivi_prospect complet, aucun échec, envois simulés | |
| K-011 | quote.sent | — | pack_relance_devis + quote_sent_move_deal | temps compressé : plafond 3 messages/24 h ignoré (artefact) |
| K-012 | quote.approved (transition en base) | drapeau auto_sortie_parcours éteint | pack_depot doit demander le dépôt | ROUGE ATTENDU — décision : la tâche s'annule elle-même (condition d'arrêt « devis approuvé ») ; test existant fige « drapeau OFF → annulée » ; correctif prêt (exception comme lead perdu) |
| K-012a | quote.approved | — | quote_approved_move_deal | |
| K-013 | invoice.sent (transition en base) | — | pack_relance_facture | |
| K-014 | visite insérée (base) / job terminé / contrat signé | — | confirmation immédiate + rappel J-7 replanifié au bon moment ; thank_you_after_job ; agreement_signed | forcer l'échéance ne fait pas partir un rappel en avance (correct) |
| K-015 | quote.viewed | — | quote_opened_notify + move_deal | |
| K-016 | invoice.paid complet | payment_type full | payment_confirmation seulement | corrigé (a088fc77) — migration NON appliquée 20261006411000 |
| K-017 | invoice.paid dépôt | payment_type deposit | deposit_received seulement | idem |
| K-020 | Relances de factures | 3 j de retard | 1 courriel, reminder_log palier 1 | |
| K-021 | Relances | 40 j de retard, 4 paliers | 1 courriel (palier 30) | corrigé : 4 courriels le même soir (e0adcf93) |
| K-022 | Relances — idempotence | 2e passage | rien | |
| K-023 | Relances — négatif | payée / pas échue | rien | |
| K-024 | Relances — panne | fournisseur en panne | log « failed » + erreur, passage non interrompu | un « failed » n'est jamais retenté par le cron (la file de reprise du mailer s'en charge) |
| K-025 | Relances — isolation | facture de B | rien | |
| — | Relances — réponse HTTP | lecture des réglages en échec | une seule réponse | corrigé dans 97048c37 (non testé : panne de lecture non provoquable proprement) |
| K-030 | Factures récurrentes | échéance du jour | 1 brouillon, échéance +1 mois | |
| K-031 | Factures récurrentes — double exécution | 2 passages simultanés | 1 facture | PASS (n'a pas reproduit le doublon soupçonné) |
| K-032 | auto_send | — | courriel simulé + statut sent | |
| K-033 | « exécuter maintenant » (Lumi) | récurrence arrêtée | refus | corrigé (973bad9d) |
| K-034 | Isolation | B | rien | |
| K-040 | Jobs récurrents | occurrence due | 1 job + 1 visite ; règle avancée ; 2e passage rien | corrigé : la visite n'était JAMAIS créée (created_by), donc ni calendrier ni confirmation/rappels (0c668851) |
| K-041 | Jobs récurrents — fuseau | série sans fuseau, entreprise à Vancouver | 9 h reste 9 h locale | corrigé (638ffcff) |
| K-042 | Récurrence créée par Lumi | — | visite à une heure de jour | ROUGE ATTENDU — décision : next_run_at = date 05:00Z (~1 h du matin) ; quelle heure prendre (celle du job d'origine ?) |
| K-043 | Isolation | B | rien | |
| K-050 | Rapport planifié quotidien | dû | 1 courriel ; 2e passage rien | |
| K-051 | Rapport — rattachement | entreprise en bac à sable | consigné au nom de l'entreprise | corrigé : sans `suivi`, échappait au bac à sable et à email_deliveries (36bb050f) |
| K-052 | Rapport — isolation | B | rien | |
| K-053 | Rapport — panne | fournisseur en panne | non perdu (non marqué, ou en file de reprise) | |
| — | Rapports — UTC | hebdo/mensuel calculés en UTC | — | NON COUVERT : dépend du fuseau du processus (prod = UTC) ; signalé (inv-3 §5.4) |
| K-060 | Dunning | impayé 8 j | suspendu + 1 courriel ; 2e passage rien | |
| K-061 | Dunning | J+3..J+6 | une relance annoncée | ROUGE ATTENDU — décision : 4 courriels (un par jour) ; le code dit « une relance quotidienne », l'en-tête « J+3 — une relance » |
| K-062 | Dunning — isolation | A seulement | B intact | |
| — | Dunning — courriel de suspension sans suspension | course avec un paiement | — | NON COUVERT : course non provoquable de façon déterministe ; lu dans le code (l'UPDATE n'est pas vérifié par .select()) |

## Matrice L — Observabilité

Fichier : `40-iklm-observabilite.test.ts` (vrai moteur, bureau A ; outil Lumi par la vraie garde).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| L-001 | lead.created → create_notification | — | journal : org, règle, événement, entité, action, config, succès, durée, clé d'exécution | ce que `automation_execution_logs` contient |
| L-002 | lead.created → send_sms | fournisseur en PANNE | ligne result_success=false, result_error = erreur du fournisseur | la ligne passe d'abord par « en cours » (réservation) |
| L-003 | lead.created → send_sms | client sans téléphone | succès technique, result_data.saute_code = sans_telephone | |
| L-004 | règle écartée par ses CONDITIONS | source ≠ attendue | une trace devrait dire pourquoi | ROUGE ATTENDU — décision : aucune ligne n'est écrite (les conditions évaluées ne sont journalisées nulle part, seulement l'action) ; volume à arbitrer |
| L-005 | get_automation_health | après la panne | échec compté avec sa cause | |
| L-006 | get_automation_health | envoi sauté | « sautes » + motif, pas compté « parti » | corrigé (« partis » mentait) ; « en cours » exclu des échecs |
| L-007 | get_automation_health / RLS | identité du bureau B | ne voit rien du journal de A | |
| — | Manques relevés | — | — | non journalisés : conditions évaluées (L-004), étapes « si » (branche prise), attentes replanifiées (seulement logger.info), refus du plafond 3 messages/24 h classé ÉCHEC (result_success=false) alors que c'est une protection voulue |

## Matrice M — Charge

Fichier : `40-iklm-charge.test.ts`. Règle note.added → log_activity (aucun envoi), bureau A.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| M-001 | rafale 1 000 × note.added (50 en vol) | — | 1 000 effets, 0 perte, 0 doublon, 0 échec | mesuré 2026-09-30 : 1 000 / 1 000 en 264 s |
| M-002 | latence émission → effet | — | mesurée et rapportée | p50 139 s, p95 232 s, max 245 s (file d'écouteurs non bornée : les 1 000 handlers concourent) |
| M-003 | requêtes PostgREST par événement | — | constant (pas de N+1) | ≈ 19/événement, identique à 3 ou 1 000 ; CORRIGÉ : une règle sans variable ne lit plus les variables (≈ 10 requêtes de moins) — garde perf-actions-sans-variables.test.ts |
| M-004 | file planifiée : 120 tâches dues | — | tâches par passage | mesure par APPEL (50 = un lot) ; CORRIGÉ au niveau du tick : viderFile dépile par lots, voir M-005 |
| M-005 | file planifiée : 120 tâches dues, un tick | — | toutes traitées en un passage (3 lots) | 50-m-file-planifiee.test.ts — avant : 50 par tick de 5 min = 600/h plateforme |
| M-006 | entreprise en pause avec 55 tâches dues + une autre avec 1 | — | la tâche de l'autre passe, la file en pause est conservée | 50-m-file-planifiee.test.ts — avant : la pause bloquait toute la file |
