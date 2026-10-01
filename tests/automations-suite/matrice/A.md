# Matrice — catégorie A (tests unitaires : aucun réseau, aucune base)

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
| A-074 | étape « si » | filtre d’étiquettes dans un si | « alors » si le client a l’étiquette, « sinon » autrement (et l’inverse pour « n’a PAS ») | CORRIGÉ — le « si » appelle `conditionsEtiquettesOk` (avant : toujours vrai) ; couvert en intégration, `10-b-parcours.test.ts` ([A-074][J-061], 2 tests) |
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
