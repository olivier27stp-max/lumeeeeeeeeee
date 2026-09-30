# Audit de la page Calendrier — vue Agenda et trajets

Date : 2026-09-30. Code audité : `origin/main` @ `710760d6`.
Environnement de test : Supabase local (`lumeagenda`, ports 583xx) = baseline du 2026-09-26 + les 51 migrations postérieures.

Le schéma local a été comparé au catalogue de la prod (lecture seule, API de gestion) :

| Objet | Écart |
|---|---|
| Policies | aucun (880 / 880) |
| Fonctions d'horaire (`rpc_reschedule_event`, `rpc_schedule_job`, `recompute_job_schedule`…) | aucun, empreintes identiques |
| Autres objets | 2 colonnes et 4 fonctions hors de ce périmètre, voir « Constats hors périmètre » |

La prod n'a reçu aucune écriture.

> **Écarts avec la mission.**
> - **Staging** existe et son schéma est tenu identique à la prod.
> - **`supabase db pull`** n'a pas été utilisé : il écrit l'historique des migrations dans le projet distant. Le mot de passe de base de `.env.local` est aussi périmé depuis la réinitialisation du 2026-09-25, pour la prod comme pour staging. Le schéma vient donc de la baseline, vérifiée contre la prod.
> - **Nommage** : le projet est en Vite + React (pas Next.js) et l'entreprise s'appelle `org_id` (pas `tenant_id`).

## 1. Inventaire

### Page et vues

- **`/calendar`** rend `Schedule.tsx`, protégé par `calendar.read`. L'URL porte tout l'état : `?date=`, `?view=`, `?teams=`.
- **4 vues** : Mois, Semaine, Jour et Agenda. Il n'existe ni vue liste ni vue carte séparée dans le Calendrier.
- **La carte des équipes** est une autre page, `/dispatch` (`DispatchMap.tsx`, Leaflet).

| Vue | Composant | Glisser-déposer | Clic sur une visite | Carte / trajets |
|---|---|---|---|---|
| Mois | `dispatch-monthly/MonthlyDispatchView.tsx` | non | `VisitDetailModal` | non |
| Semaine | `dispatch-weekly/WeeklyDispatchView.tsx` | oui (jour / équipe, garde l'heure) | `VisitDetailModal` | non |
| Jour | `dispatch-daily/DailyDispatchView.tsx` | oui (heure, équipe, redimensionnement 15 min) | fiche de job | non |
| Agenda | `AgendaView` dans `Schedule.tsx` + `schedule/AgendaRoutePanel.tsx` | non | fiche de job | oui, une carte Mapbox par équipe et par jour |

### Barre d'outils (toutes les vues)

- **Navigation** : précédent / suivant, « Aujourd'hui », mini-calendrier.
- **Filtre Équipes** : Effacer, Toutes, Non assigné, une case par équipe.
- **Tiroir** des jobs non planifiées (glisser vers la grille).
- **« Optimiser la tournée »**.
- **« + Créer »** : Une job, Une tâche.
- **Échap** ferme les menus.

### Agenda

- Les visites de la semaine sont groupées par jour.
- Avec au moins une équipe choisie, chaque jour affiche un **panneau « Trajet du jour »**. Il contient :
  - le choix du départ : 1er arrêt, ou Ma position (GPS du navigateur) ;
  - les totaux ;
  - par équipe : une carte Mapbox, la liste des arrêts avec distance, durée et heure estimée, et un lien « Ouvrir dans Maps ».
- Un clic sur un arrêt centre la carte. Un clic sur l'icône ou sur l'épingle ouvre la fiche de job.

### Source des trajets

- **Agenda** : le navigateur appelle directement Mapbox, à chaque rendu et sans cache.
  - Directions dans l'ordre chronologique, plus Optimization (TSP) pour réordonner.
  - Plafond de 12 arrêts.
  - Repli local au plus proche voisin, avec des durées de trajet à **0** si Mapbox échoue.
- **Bouton « Optimiser la tournée »** : serveur, `POST /api/route-optimization/optimize`.
  - Matrice OSRM publique (`router.project-osrm.org`), repli à vol d'oiseau à 50 km/h.
  - Ordre glouton du plus proche voisin, 30 arrêts au plus.
- **Il y a donc deux moteurs, qui peuvent donner deux ordres différents.**

### Point de départ de la journée

- **Agenda** : le 1er arrêt, ou la position GPS de la personne qui regarde.
- **Serveur** : `start_location` s'il est fourni, sinon **la première ligne renvoyée par la base**, sans tri.
- Aucun domicile de technicien ni dépôt n'est utilisé. L'adresse de l'entreprise (`company_settings`) non plus.

### Géocodage

- **Adresse utilisée** : `jobs.property_address` ou `jobs.address`, via `POST /api/geocode-job`. Les fournisseurs sont essayés dans l'ordre Google → Mapbox → Nominatim.
- **Stockage** : dans `jobs.latitude` / `longitude` / `geocode_status`. Enregistrer une job remet ces valeurs à `null` / `pending`.
- **Ce qu'utilise le marqueur** : les coordonnées de la **job**. Ni la propriété (`properties.latitude`) ni l'adresse de facturation du client.
- **Adresse introuvable** : la visite est exclue de la carte et comptée (« N job(s) exclus »). Elle n'est **jamais listée**, donc impossible de savoir laquelle corriger.

### Temps réel

- **Canal** `cal-rt-<org_id>` sur `schedule_events`, `jobs` et `teams`, filtré par `org_id`, avec un anti-rebond de 400 ms.
- **Autres données** : les tâches et les factures n'ont pas d'abonnement.

## 2. Bogues, du plus grave au moins grave

Ce qui est marqué **mesuré** a été observé sur le jeu de données local (Playwright), pas seulement lu dans le code.

### Critique

| # | Bogue | Preuve | Effet |
|---|---|---|---|
| C1 | « Optimiser la tournée » applique sans proposition et réécrit **toutes les visites de la job, peu importe la date** (`routeOptimizationApi.ts:75-79` : `update schedule_events … eq('job_id')`) | code | Une job multi-visites voit toutes ses dates écrasées par l'heure d'un seul jour |
| C2 | Heures affichées au fuseau **du navigateur**, jamais à celui de l'entreprise. Toutes les vues utilisent `getHours()`, `format()` ou `toLocaleTimeString` sans `timeZone`, et le glisser-déposer calcule aussi en heure du navigateur | **mesuré** : une visite à 8 h s'affiche 8:00 (Toronto) et **5:00** (navigateur à Vancouver) | Mauvaise heure pour quiconque n'est pas dans le fuseau de l'entreprise ; un déplacement enregistre une heure décalée |
| C3 | `rpc_reschedule_event` remet **toute visite déplacée au statut `scheduled`**, même une visite terminée | code SQL | Une visite faite et facturée redevient « à faire » si on la déplace |

### Élevé

| # | Bogue | Preuve | Effet |
|---|---|---|---|
| E1 | La ligne de trajet suit l'ordre **optimisé par Mapbox**, pas l'ordre chronologique des visites | code + capture | La carte ne montre pas le vrai parcours du technicien |
| E2 | **Visite annulée incluse dans le trajet** | **mesuré** : 199 marqueurs = 200 visites − 1 sans adresse, l'annulée comprise | Arrêt fantôme sur la carte et dans les totaux |
| E3 | **25 cartes Mapbox** sur la semaine (une par équipe et par jour) : le navigateur perd les plus anciennes (« Too many active WebGL contexts ») | **mesuré** | Cartes blanches dans la vue semaine |
| E4 | **100 appels Mapbox par chargement** de la semaine (50 Directions + 50 Optimization), refaits à chaque rechargement, sans cache | **mesuré** | Coût d'API proportionnel aux visites de page |
| E5 | Aucun badge « trajet impossible » ni « chevauchement » | code + capture | Sherbrooke → Trois-Rivières en 15 min passe inaperçu. Si Mapbox est en panne, les durées tombent à 0 et rien ne peut être détecté |
| E6 | Adresse introuvable : seulement un compte « N exclus », sans liste à corriger | code | Impossible de savoir quelle adresse corriger |
| E7 | Le marqueur utilise les coordonnées de la job, pas celles de la **propriété** du travail | code | Une propriété géocodée n'est pas utilisée ; la job garde des coordonnées périmées tant qu'elle n'est pas regéocodée |
| E8 | `rpc_reschedule_event` compte les chevauchements des visites **non assignées de toutes les entreprises** (aucun filtre `org_id`, `SECURITY DEFINER`) | code SQL | Nombre faux, et fuite d'une information entre entreprises (un compte) |
| E9 | `rpc_reschedule_event` vérifie l'appartenance à l'entreprise, **pas la permission `calendar.update`** de la page Rôles | code SQL | Un rôle sans droit de replanifier peut quand même déplacer |
| E10 | `POST /api/route-optimization/optimize` n'a pas d'entrée dans `ROUTE_PERMISSIONS` | code | Aucune permission vérifiée côté serveur |

### Moyen

| # | Bogue | Preuve |
|---|---|---|
| M1 | Badge « Optimisé » toujours affiché, même quand rien n'a été optimisé | capture |
| M2 | Heure d'arrivée estimée calculée avec 30 min fixes sur place, pas la durée réelle (8 h 31 affiché pour une visite prévue à 9 h 00) | capture |
| M4 | Serveur d'optimisation : départ = première ligne rendue par la base (ordre arbitraire) ; algorithme glouton non déterministe vis-à-vis de l'ordre d'entrée | code |
| M5 | Agenda : quand une équipe est choisie, la liste détaillée disparaît. Un jour avec une seule visite géocodée par équipe n'affiche que sa date | code |
| M6 | Le repli Mapbox met les durées à 0 : totaux et heures estimées faux sans avertissement | code |
| M7 | Bouton « Aujourd'hui » masqué en vue Agenda seulement si le jour choisi est aujourd'hui, alors que la vue montre une semaine | code |

> M3 retiré après vérification : `formatCurrency` place le « $ » devant **par choix documenté** (« Always English placement »), ce n'est pas un bogue.

### Trouvés en cours de correction

| # | Gravité | Bogue | Effet |
|---|---|---|---|
| N1 | Élevé | `POST /api/geocode-job` est appelé à **chaque** enregistrement de job et payait un géocodage (Google en premier), même si l'adresse n'avait pas changé | Coût d'API à chaque sauvegarde |
| N2 | Élevé | Un résultat de géocodage **approximatif** (la ville, pas l'adresse) était accepté | Job placée au centre de la ville, en silence |
| N3 | Élevé (Loi 25) | La position en direct était transmise pour **tout utilisateur connecté**, bureau compris, pas seulement pendant les heures pointées | Suivi de personnes hors de leurs heures de travail |
| N4 | Moyen | Sections d'équipes triées par identifiant | Ordre qui change d'un chargement à l'autre |
| N5 | Moyen | Carte démontée dès qu'elle quittait l'écran | Choisir un arrêt dans la liste (iPad) détruisait la carte |
| N6 | Moyen | Adresse modifiée : coordonnées effacées, puis re-géocodées seulement par l'appel qui suit l'enregistrement | Corrigé par N1 : même appel, mais qui ne coûte plus rien quand rien n'a changé |

## 3. Correctifs appliqués

| # | Correctif | Où | Preuve |
|---|---|---|---|
| C1 | Le bouton n'écrit plus rien directement. Il devient « Optimiser la journée » et ouvre Lumi (étape 2) ; l'application ne touche que les visites du jour, en une transaction | `Schedule.tsx`, `routeOptimizationApi.ts` (fonction dangereuse retirée) | Playwright (accepter / refuser) |
| C2 | Heures au fuseau de l'entreprise partout, changements d'heure compris. Elles sont converties à la lecture et à l'écriture (« heure murale ») | `src/lib/fuseauEntreprise.ts`, `Schedule.tsx`, `DailyDispatchView.tsx`, `AddVisitModal.tsx`, `JobDetails.tsx` | Navigateur réglé sur Vancouver : 8:00 (avant : 5:00) ; test du 2 novembre |
| C3, E8, E9 | Visite terminée : son statut est conservé. Filtre `org_id` sur les chevauchements. Permission `calendar.update` ou `jobs.update` (page Rôles) | migration `20261004300000` (**en attente d'approbation**) | Tests SQL locaux |
| E1 | Trajets dans l'ordre **chronologique**, calculés par le serveur | `server/lib/trajets/journee.ts`, `GET /api/agenda/trajets` | Unitaire + Playwright |
| E2 | Visites annulées (ou de jobs annulées) hors trajet | idem | Playwright |
| E3 | Une carte par jour, montée à la première apparition (≤ 7 par semaine) | `AgendaRoutePanel.tsx` | Plus d'avertissement WebGL |
| E4 | Plus aucun appel Mapbox de routage. Matrice OSRM en cache côté serveur, partagée avec le solveur | `server/lib/trajets/matrice.ts` | Compteurs mesurés (section 6) |
| E5 | Badges « Trajet impossible » et « Chevauchement ». Temps estimés marqués comme tels si le service de routes tombe | `journee.ts`, panneau | Playwright |
| E6 | Liste « Adresses à corriger » avec lien vers la job | panneau | Playwright |
| E7 | Coordonnées de la **propriété** d'abord, jamais l'adresse de facturation ni 0,0 | `agenda-trajets.ts`, `matrice.ts#pointValide` | Unitaire |
| E10 | `calendar.update` sur `/route-optimization/optimize`, `calendar.read` sur `/agenda/trajets` | `route-permissions.ts` | Playwright (401 sans session) |
| M1, M2 | Badge « Optimisé » et heures d'arrivée inventées retirés : on affiche l'heure planifiée | panneau | Capture |
| M4 | Remplacé par le solveur de l'étape 2 | `optimisation.ts` | Unitaire |
| M5 | Chaque équipe a toujours sa liste, même avec un seul arrêt | panneau | Playwright |
| M6 | Voir E5 | | |
| M7 | « Aujourd'hui » en vue Agenda suit la semaine, au fuseau de l'entreprise | `Schedule.tsx` | |
| N1, N2 | Coordonnées déjà bonnes : aucun appel. Propriété géocodée : copiée. Résultat approximatif : refusé, la visite passe dans « à corriger » | `server/routes/geocode.ts`, `route-optimization.ts` | |
| N3 | Transmission seulement avec une session de suivi **ouverte par le pointage**. `get_team_locations` filtre aussi côté serveur. Textes de consentement FR et EN alignés | `useLiveLocationTracking.ts`, `tools-etendus.ts`, `LocationConsentModal.tsx`, `MyLocationConsentCard.tsx` | |
| N4, N5 | Ordre des équipes des réglages. Carte gardée une fois montée, sélection réappliquée | panneau | Playwright iPad |

**Non corrigé, signalé :**
- La date d'en-tête de la fiche de job (`formatDate`, date seule) reste au fuseau du navigateur. Seules les heures des visites ont été converties.
- Carte `/dispatch` et vente porte-à-porte : hors de ce périmètre.
- `get_day_route` et `query_schedule` : bornes de jour déjà corrigées par une autre session (branche `feat/audit-outils-lumi`).
- Rappels de rendez-vous : `appointment_date` / `appointment_time` sont formatés en `fr-CA` même pour une entreprise anglophone (hors périmètre).

## 4. Spécification de `propose_day_optimization`

Un seul outil : il remplace `optimize_route`, renommé et étendu (Lumi, MCP, bouton, texte).

**Entrées**
- `date` : `AAAA-MM-JJ` au fuseau de l'entreprise (par défaut, aujourd'hui).
- `team_id` : facultatif, une seule équipe.

**Données lues** (client de l'utilisateur, RLS, `org_id` de la session)
- Visites du jour, sauf les annulées.
- Jobs et propriétés (coordonnées).
- `team_availability` du jour de la semaine.
- `automation_execution_logs`, pour savoir ce qui est déjà confirmé au client.
- Positions en direct des membres pointés, si la journée est aujourd'hui.
- Adresse de l'entreprise, si elle est géolocalisée.

**Contraintes** (`server/lib/trajets/optimisation.ts`, sans LLM)
- **Visites fixes, jamais déplacées** :
  - terminées ;
  - en cours ;
  - confirmées au client, c.-à-d. qu'un texto ou courriel d'automatisation est déjà parti pour cette visite ;
  - déjà commencées.
- **Jamais de réassignation** : une équipe = un problème.
- **Heures de travail** : les disponibilités de l'équipe. Sans disponibilité, la journée déjà planifiée (on ne la rallonge jamais à l'aveugle).
- **Durée** de chaque visite conservée.
- **Temps de route** : la matrice OSRM en cache (celle de l'Agenda).
- **Départ** : la position du technicien pointé en cours de journée, sinon l'adresse de l'entreprise, sinon le premier arrêt. Aucun point de fin n'est configurable aujourd'hui.
- **Plusieurs visites d'une même job** : leur ordre est conservé.
- **Pas dans le passé** : en cours de journée, seulement les visites restantes, à partir de maintenant.
- **Heures proposées** : arrondies aux 5 minutes.

**Solveur**
- Déterministe : les égalités sont départagées par identifiant.
- **Exact** jusqu'à 8 visites déplaçables par équipe : recherche complète élaguée.
- Au-delà : plus proche voisin + 2-opt, validé contre l'exact dans les tests.

**Sortie**
- Par équipe : avant/après (ordre, km, minutes de route), gain, visites fixes avec leur raison, contraintes impossibles.
- La liste des visites déplacées (ancienne heure → nouvelle).
- Les visites sans adresse.
- Ce que les clients recevront : rappels replanifiés, automatisations « rendez-vous déplacé ».
- Les hypothèses.
- Une **empreinte** (état exact du jour + changements).
- Gain < 10 min → « Ta journée est déjà optimisée », sans carte.

**Application** : `apply_day_optimization`
1. **Carte toujours exigée**, quel que soit le mode ou « toujours confirmer ».
2. **Empreinte recalculée** : un écart veut dire que la proposition est périmée ; elle est refusée.
3. **Une transaction** : `rpc_appliquer_optimisation` (migration `20261005320000`, en attente), qui appelle `rpc_reschedule_event`, le même service que `reschedule_job`.
4. **Idempotence** : `agent_actions`, plus la carte qui n'est plus « en attente » (un double clic donne un 409).
5. **Événement « rendez-vous déplacé »**, pour que les rappels suivent la nouvelle heure.
6. **Trace d'audit** : qui, quand, avant → après, dans `agent_actions.resultat`.

## 5. Résultats des tests

**Tests unitaires (Vitest)**
- Nouveaux : 36 sur 36.
  - `trajets-journee` : ordre chronologique, annulées, adresses à corriger, trajet impossible, chevauchement, même adresse, jour au fuseau et changement d'heure, 0,0 rejeté, cache de matrice.
  - `optimisation-journee` : ordre optimal connu, fixes intactes, heures de travail, rien dans le passé, multi-visites, cas impossible, milieu de journée, 10 exécutions identiques, heuristique au-delà de l'exact.
  - `lumi-optimisation` : reconnaissance du texte, « demain », gabarit, empreinte, carte toujours exigée.
- Suite complète : 5970 réussis.
  - Seul échec : `lumi-rapports` (7 délais dépassés sous charge) passe seul (59/59). Il dépassait déjà ses délais sous charge avant ces changements.
- `tsc` et `eslint` propres.

**SQL** (base locale, transactions annulées)
- Une visite terminée déplacée reste terminée.
- Un rôle sans droit de replanifier est refusé.
- L'échange de deux créneaux est atomique.
- Une proposition périmée est refusée, sans rien appliquer.

**API réelle** (serveur local, clé Anthropic invalide exprès)
- Proposition par le bouton : 0 LLM.
- Accepter : **38 visites déplacées en base, exactement les 38 proposées, aux heures proposées**.
- Double clic : 409, une seule application.
- Refuser : horaire inchangé.
- Proposition périmée : refusée, rien d'appliqué.

**Playwright** (Chromium ; bureau 1440×900, iPad Pro 11, iPhone 13)
- Tout est vert (48 exécutions, toutes réussies) :
  - 46 réussis au passage complet ;
  - le test « navigation » sur iPad, échoué une fois au premier chargement après le rechargement des données, puis réussi ;
  - « aucun bouton mort » (bureau, lancé à part, 5 min) réussi.
- 34 sautés, par conception :
  - sur téléphone, la porte mobile a son propre test (réussi) ;
  - le glisser-déposer, le temps réel et les parcours Lumi sont joués sur bureau.
- Couvert :
  - navigation (semaine / jour) ;
  - 8 h affiché 8 h (navigateur à Toronto ET à Vancouver) ;
  - 2 novembre (après le changement d'heure) ;
  - ordre chronologique ;
  - marqueurs = visites, et chacun ouvre sa job ;
  - annulée exclue, adresse à corriger, trajet impossible, chevauchement, même adresse, multi-jours, complétée ;
  - filtre par équipe ;
  - glisser-déposer : heure et trajet à jour ;
  - temps réel : un autre utilisateur voit le déplacement sans recharger ;
  - autre entreprise invisible (écran et API) ;
  - technicien restreint à son équipe ;
  - 401 sans session ;
  - chargement, semaine vide, erreur du calcul avec « Réessayer », API de cartes en panne ;
  - aucun bouton mort ;
  - coûts : 0 appel Mapbox de routage, 0 appel de routes au rechargement ;
  - semaine < 8 s ;
  - régression visuelle ;
  - « Optimiser la journée » : bouton → Lumi → carte → accepter (l'agenda reflète la proposition) ; refuser (rien ne change) ; technicien sans droit (proposition sans carte).

## 6. Coûts avant / après

Mesures sur le jeu de données local : 5 équipes × 8 visites × 5 jours. API de cartes simulée, avec compteurs.

| Poste | Avant | Après |
|---|---|---|
| **Charger la semaine dans l'Agenda** | **100 appels Mapbox** (50 Directions + 50 Optimization), refaits à chaque chargement | **0 appel Mapbox de routage.** 5 appels de matrice OSRM au premier chargement, **0** ensuite (cache) |
| Cartes graphiques ouvertes (WebGL) | 25 à la fois (le navigateur en perd) | ≤ 7 par semaine, montées à l'affichage |
| Bouton « Optimiser » | 1 appel OSRM par clic, sans cache ; application directe, sans proposition | 0 appel si l'Agenda a déjà calculé la journée (cache partagé) ; 1 par équipe sinon |
| **LLM — chemin bouton** | 0 (pas de Lumi) | **0** : prouvé avec une clé Anthropic volontairement invalide, le parcours complet passe |
| **LLM — chemin texte** (« optimise ma journée de demain ») | 2 tours de modèle (choix de l'outil, puis rédaction) | **0** pour les formulations reconnues (FR/EN) ; sinon 1 appel d'outil, réponse par gabarit |
| **Géocodage à l'enregistrement d'une job** | 1 appel payant (Google d'abord) à **chaque** enregistrement | 0 si l'adresse n'a pas changé ou si la propriété est géocodée ; 1 seulement si l'adresse change |
| Semaine avec 100 000 visites en base (RLS comprise) | — | 11,6 ms, index `idx_schedule_active_range` |

## 7. Fichiers modifiés

**Nouveaux**
- Serveur :
  - `server/lib/trajets/matrice.ts`, `journee.ts`, `optimisation.ts`, `propositionJournee.ts`
  - `server/lib/lumi/optimiserJournee.ts`
  - `server/routes/agenda-trajets.ts`
- Navigateur : `src/lib/fuseauEntreprise.ts`, `src/lib/agendaTrajetsApi.ts`
- Migrations : `supabase/migrations/20261005310000_agenda_replanification.sql`, `20261005320000_appliquer_optimisation_journee.sql`
- Tests :
  - `tests/agenda/trajets-journee.test.ts`, `optimisation-journee.test.ts`, `lumi-optimisation.test.ts`
  - `tests/e2e/agenda/` (Playwright : config, préparation, session, carte simulée, outils, `agenda.spec.ts`, captures de référence)
- Outils de test : `scripts/qa/agenda/fixture.ts`, `seed-local.mts`, `osrm-simule.mts`

**Modifiés**
- Serveur :
  - routes : `server/index.ts`, `routes/lumi.ts`, `routes/geocode.ts`, `routes/route-optimization.ts`
  - Lumi et outils : `lib/agent/tools-etendus.ts`, `lib/agent/garde.ts`, `lib/agent/registre.ts`, `lib/lumi/execution.ts`, `lib/lumi/topics.ts`
  - autres : `lib/route-permissions.ts`, `lib/support/carte-app.ts`
- Navigateur :
  - pages : `pages/Schedule.tsx`, `pages/JobDetails.tsx`, `pages/Lumi.tsx`
  - composants : `components/schedule/AgendaRoutePanel.tsx` (réécrit : nouveau modèle de données), `components/dispatch-daily/DailyDispatchView.tsx`, `components/dispatch-daily/DailyVisitCard.tsx`, `components/AddVisitModal.tsx`, `components/lumi/CarteAutorisation.tsx`
  - consentement et suivi : `components/LocationConsentModal.tsx`, `components/settings/MyLocationConsentCard.tsx`, `hooks/useLiveLocationTracking.ts`
  - bibliothèques : `lib/lumiApi.ts`, `lib/routeOptimizationApi.ts`
- Tests et outils : `tests/lumi-etage0.test.ts`, `tests/support/carte-app-empreinte.json`, `scripts/qa/executer-outils-staging.mts`
- `package.json` : ajout de `@playwright/test` (développement)

## 8. Décisions et migrations en attente d'approbation

### Migrations écrites, appliquées **en local seulement**, testées

1. `20261005310000_agenda_replanification.sql`
   - **Contenu** : C3 (statut conservé), E8 (filtre `org_id`), E9 (permission).
   - **Fonctions touchées** : `rpc_reschedule_event`, `rpc_schedule_job`, `rpc_add_visit`.
   - **Méthode** : corps repris de la prod, seules les lignes visées changent.
2. `20261005320000_appliquer_optimisation_journee.sql`
   - **Contenu** : `rpc_appliquer_optimisation`, l'application transactionnelle de l'étape 2.
   - **Dépendance** : le code de l'étape 2 en a besoin. **Ne pas déployer le code avant cette migration**, sinon « Confirmer » échoue.

### Prérequis bloquant : dump complet de la prod avant migration (PITR absent)

- Le mot de passe de base de `.env.local` est **refusé** (prod et staging, depuis la réinitialisation du 25 septembre). Le dump est donc impossible pour l'instant.
- La **sauvegarde quotidienne de la prod échoue depuis le 26 septembre** pour la même raison.
- Il faut coller le mot de passe actuel dans `SUPABASE_DB_PASSWORD`.

### Décisions prises (à valider)

- **Environnement de test** : Supabase local = baseline + migrations, vérifié contre le catalogue de la prod, et non `supabase db pull`, qui écrit dans le projet distant.
- **Jeu de données** : données de test, pas de données réelles.
- **« Confirmée au client »** : un texto ou courriel d'automatisation est déjà parti pour la visite.
- **Départ** : `company_settings.weather_lat/lng`, les coordonnées de l'entreprise. Il n'existe pas de notion de domicile de technicien ni de dépôt.
- **Point de fin** : aucun.
- **Heures de travail** : `team_availability`, sinon la journée planifiée.
- **Rappels après application** : l'événement « rendez-vous déplacé » est émis, pour que les rappels suivent. La carte le dit avant l'acceptation, ainsi que toute automatisation qui préviendrait les clients. L'optimisation elle-même n'envoie rien.
- **Loi 25 (N3)** : les gens du bureau ne sont plus suivis sur la carte en direct. Seuls les membres pointés le sont.
- **Téléphone** : l'app web montre la porte mobile, par conception. L'Agenda est testé sur ordinateur et iPad, et le téléphone vérifie la porte.
- **Lignes de trajet** : droites entre les arrêts. Les distances et temps viennent de vraies routes, et le fond de carte reste Mapbox.
- **Renommage** : `optimize_route` devient `propose_day_optimization`. Les clients MCP verront le nouveau nom.

### Rejouer les tests

1. Pile Supabase locale : `lume-agenda-local`, ports 583xx (baseline + migrations).
2. Serveurs : API (:3112) et Vite (:5283), avec `lume-agenda-local/agenda.env`.
3. Commande :

```
npx playwright test -c tests/e2e/agenda/playwright.config.ts
```

La préparation recharge le jeu de données et lance le faux OSRM.
