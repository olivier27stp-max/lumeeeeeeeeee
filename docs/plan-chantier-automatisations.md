# Chantier automatisations — plan de correction

**Date** : 2026-08-12
**Portée** : moteur d'automatisation, presets livrés, interface de gestion
**Méthode** : chaque constat ci-dessous a été vérifié **dans le code ET dans la base de production**. Les affirmations non confirmées ont été écartées — elles sont listées en §6 pour mémoire.

---

## 1. Ce qui va bien (à ne pas casser)

Avant la liste des problèmes, ce qui est solide et qu'aucune correction ne doit dégrader :

- **Cloisonnement par organisation** : `handleEvent` filtre `org_id` sur `automation_rules` et `workflows`. L'`orgId` vient toujours d'une source serveur (session authentifiée ou `job.org_id`), jamais du corps de la requête. Aucune fuite inter-tenant possible par ce chemin.
- **Arrêt des relances de devis** : `checkStopConditions` couvre `approved`, `declined`, `changes_requested`, `expired`, `converted`, `archived`, `void`. Un client qui accepte sa soumission au jour 2 ne reçoit pas la relance du jour 7. *(Un rapport d'audit affirmait le contraire — vérification faite, c'est faux.)*
- **Reprise sur échec** : `nextStateAfterFailure` / `isTransientFailure`, ajoutés aujourd'hui, distinguent correctement les pannes passagères des échecs définitifs.
- **Vérification des écritures** : les insertions de journaux et les changements de statut testent bien leur erreur. C'est le travail fait aujourd'hui, il tient.
- **`executeUpdateStatus`** : liste blanche de tables, filtre `org_id`, vérification du nombre de lignes touchées. C'est le modèle à suivre pour les autres actions.

---

## 2. Les problèmes confirmés, mesurés en production

Chaque ligne : ce qui se passe **pour un client final**, puis le chiffre réel.

### P1 — Double SMS après chaque job terminé · **60 règles**

Deux presets se déclenchent 1 h après `job.completed`, tous deux par SMS :

> « Merci de faire affaire avec [company]… Si tout n'est pas parfait, répondez à ce message. »
> « Bonjour [prénom], comment s'est passé notre service ? Répondez de 1 à 5… »

Le client reçoit les deux dans la même seconde, avec deux consignes contradictoires. L'org paie deux SMS et n'obtient aucune réponse exploitable.

`automationPresets.data.ts` — `thank_you_after_job` et `post_appointment_survey`, tous deux `delay_seconds: 3600`.

### P2 — Confirmation de dépôt : jamais envoyée · **30 règles**

Le preset `deposit_received` porte `conditions: { payment_type: "deposit" }`. Aucun émetteur de `invoice.paid` ne fournit ce champ — ni `payments.ts`, ni `automation-events.ts`. La condition est donc toujours fausse.

La règle s'affiche **« Active »** avec un badge vert et n'a **jamais rien envoyé**. Un client qui verse son dépôt ne reçoit aucune confirmation que sa place est réservée.

### P3 — Rappels périmés envoyés quand même, avec un contenu faux · **138 règles à délai négatif**

`resolveExecuteAt` : si l'heure calculée est déjà passée, la tâche est exécutée **dans 5 secondes** au lieu d'être abandonnée.

Créer aujourd'hui un rendez-vous pour **demain** déclenche donc immédiatement le rappel « J-7 », qui dit au client :

> « Votre rendez-vous est **dans une semaine** »

…alors qu'il est demain. Message factuellement faux, envoyé au client final. Cas fréquent : toute prise de rendez-vous à court terme.

### P4 — Déplacer une visite ne replanifie rien

`POST /automations/events/appointment-rescheduled` émet `appointment.updated`. Or :
- aucun preset n'écoute `appointment.updated` (vérifié : 0) ;
- l'événement n'est pas dans `EVENT_TO_TRIGGER`, donc les workflows ne le voient pas non plus ;
- **aucune ligne de cette route n'annule les tâches en attente**.

Déplacer une visite laisse donc les rappels calés sur l'ancienne date.

> **Note d'honnêteté** : le commit `bec0935` d'aujourd'hui affirme que « le serveur sait déjà annuler les tâches périmées puis les replanifier ». C'est faux. J'ai rebranché un appel côté client vers une route qui ne fait pas ce que je croyais. Le bug est intact.

### P5 — Aucun verrou sur les deux planificateurs

`startScheduler` et `startRecurringJobScheduler` sont lancés directement, alors que **tous les autres crons du fichier** passent par `withAdvisoryLock`. L'écart est visible à l'œil nu dans `server/index.ts`.

Deux conséquences :
- **Multi-instance** : chaque tâche est traitée deux fois. La prise `status='running'` ne protège pas — le `UPDATE` n'a pas de `.eq('status','pending')` dans sa clause, donc deux instances réussissent toutes les deux et exécutent l'action. Le client reçoit le message en double.
- **Chevauchement de ticks** : `setInterval` ne tient pas compte de la durée du tick. `handleRecurringInvoices` charge toutes les factures récurrentes de toutes les orgs sans limite, avec une requête `clients` par ligne. Un tick qui dépasse 5 minutes en croise un second.

### P6 — Tâche interrompue = bloquée pour toujours

La tâche passe en `running` avant l'exécution. Si le processus meurt entre les deux (déploiement, crash, timeout Twilio), la ligne reste `running` :
- le fetch ne sélectionne que `pending` → jamais reprise ;
- aucun mécanisme de récupération des tâches figées ;
- l'index d'unicité couvre `running` → **la clé est bloquée à vie**, cette action ne peut plus jamais être replanifiée pour cette entité.

Chaque déploiement pendant un tick perd donc quelques relances **et** rend l'entité sourde pour cette règle.

### P7 — Lectures Supabase non vérifiées → annulations à tort

`supabase-js` ne lève pas d'exception : il retourne `{ data, error }`. Dans `checkStopConditions`, **six requêtes** ne lisent que `data`.

Si la base répond une erreur (délai dépassé, RLS, incident réseau), `data` vaut `null` — que le code interprète comme « entité supprimée » → `return true` → la tâche passe en **`cancelled` définitivement**.

Un hoquet de deux secondes annule irrémédiablement des relances en attente. Sans log, sans reprise.

Même famille dans `resolveEntityVariables` : une lecture échouée produit un message **à trous** (« Bonjour , votre facture de ») sans aucune trace.

### P8 — L'utilisateur ne voit pas ce qui part en son nom

35 automatisations écrivent à ses clients. La page Automatisations affiche le *type* d'action (« Envoyer un courriel ») mais **jamais le texte**.

- **SMS** : visibles et modifiables — mais dans Réglages → Messagerie, sans aucun lien depuis la page Automatisations. Découvrabilité nulle.
- **Courriels** : ni visibles ni modifiables, nulle part. Aucune fonction n'écrit `send_email.config.body`.

### P9 — Création de tâche impossible sur un rendez-vous

`executeCreateTask` écrit `linked_entity_type: ctx.entityType`. La contrainte de la table n'admet que `client|lead|quote|invoice|job`.

Les entités réellement émises incluent `schedule_event`. Une règle « quand un rendez-vous est créé → créer une tâche de préparation » échoue à l'insertion, est réessayée 3 fois pour rien, puis abandonnée. L'utilisateur ne voit rien.

Les 4 presets livrés utilisent des entités conformes — **le bug ne frappe que les règles créées par l'utilisateur**, c'est-à-dire la fonctionnalité annoncée.

### P10 — Conditions : comparaison stricte et opérateurs ignorés

- `evaluateConditions` compare avec `!==`. Une condition saisie dans l'interface arrive en **chaîne** ; une valeur de métadonnée peut être un **nombre**. `3 !== "3"` → la règle ne se déclenche jamais.
- Le convertisseur du builder ne traduit que `equals` et `not_equals`. Tout autre opérateur (`contains`, `gt`, `lt`) est **absent de l'objet produit**, donc traité comme « toujours vrai ». Une règle « si montant > 5000 » s'exécute sur tous les montants — un faux positif, plus dangereux qu'un blocage.

### P11 — Workflows différés : jamais planifiés

Un workflow converti en pseudo-règle porte l'`id` de la table `workflows`, inséré dans `automation_scheduled_tasks.automation_rule_id` — colonne avec clé étrangère vers `automation_rules`. Violation à chaque insertion.

Le code ne traite spécifiquement que le code d'erreur `23505` (doublon) ; celui-ci tombe dans le cas général et ne produit qu'un `console.error`. L'utilisateur voit son workflow « actif », le journal indique même qu'il a matché — et rien ne part jamais.

### P12 — Opt-out SMS absent de la majorité des messages commerciaux

Seuls 4 SMS sur ~19 portent « Répondez STOP pour vous désabonner ». Les relances de devis, de prospects et de factures n'en ont pas — alors que l'écran Réglages → Messagerie affiche à l'utilisateur « Incluez **toujours** l'option de désabonnement ».

Le produit ne respecte pas la consigne qu'il donne. Exposition CASL réelle.

*(La liste STOP est bien respectée à l'envoi depuis ce matin — c'est la mention dans le texte qui manque.)*

### P13 — Textes internes en anglais

Toutes les notifications et tâches créées par les automatisations sont en anglais dans un produit francophone : « Client X has not paid after 7 days », « Urgent: Quote follow-up », « Escalate to management ».

Les `name` et `description` des 35 presets sont également en anglais en base ; l'interface traduit les noms via une table de correspondance, mais **jamais les descriptions**.

### P14 — Incohérences de nommage

- `stale_lead_7d` : nommé « Alerte prospect inactif », catégorisé comme une alerte, mais **envoie un SMS commercial au prospect**. Combiné aux autres relances : 5 sollicitations en 14 jours.
- `no_show_followup` : déclenché sur `appointment.cancelled`, le SMS dit « on a **manqué** notre rendez-vous » — envoyé 1 h après une annulation faite **par l'org elle-même**. Le message accuse le client à tort.
- `client_anniversary` : compté depuis la fin d'un job, pas depuis la création du client. Un client avec 3 jobs reçoit 3 « anniversaires ».
- `review_reminder_7d` : insère le lien d'avis Google sans vérifier qu'il est configuré. Si l'org ne l'a pas rempli, le client reçoit « un avis nous aiderait énormément :   Merci ! » avec une URL vide. Le preset voisin `google_review`, lui, valide avant d'envoyer.

### P15 — Trois tables de traduction indépendantes

`AUTOMATION_NAME_FR` (par nom), `PRESET_META` (par clé), `RULE_LABELS_FR` (par clé, dans un autre écran). Trois sources de vérité pour nommer la même chose, chacune avec ses trous. `PRESET_META` contient en plus 5 clés fantômes d'une génération disparue.

---

## 3. Plan d'exécution

Sept lots. Chacun est livrable seul, testable, et réversible.

### Lot 0 — Filet (aucun changement de comportement)

Écrire les tests **avant** de toucher au moteur, comme pour le chantier des envois.

- Tests d'exécution réelle de `evaluateConditions`, `resolveExecuteAt`, `checkStopConditions`, `buildExecutionKey` — contre un faux client de base, pas de la lecture de source.
- Figer le comportement actuel, **bugs compris**. Les tests de P3, P10 et P11 documenteront le défaut ; les lots suivants les inverseront explicitement.

**Vérification** : suite verte, zéro fichier de production modifié.

---

### Lot 1 — Ce que le client reçoit *(impact immédiat, aucune migration)*

Le lot le plus rentable : il touche des messages qui partent réellement.

**P1 — la double confirmation.** Désactiver `post_appointment_survey` chez les orgs concernées, ou décaler son délai. Décision produit : je recommande de garder `thank_you_after_job` (remerciement) et de supprimer le sondage SMS, redondant avec la demande d'avis 1 h plus tard.

**P2 — la confirmation de dépôt.** Deux options : retirer la condition impossible, ou faire émettre `payment_type` par le webhook de paiement. La seconde est meilleure — la distinction dépôt/solde a une vraie valeur métier — mais elle demande de toucher au webhook Stripe. À trancher.

**P3 — les rappels périmés.** Abandonner la tâche au lieu de la précipiter, avec une trace. Un rappel « J-7 » pour un rendez-vous de demain n'a aucun sens ; le rappel « J-1 », lui, reste pertinent.

**P14 — les incohérences de contenu.** Reformuler `no_show_followup` (ne plus accuser le client), vérifier l'URL d'avis avant d'envoyer, aligner `stale_lead_7d` sur son nom (alerte interne seule, sans SMS au prospect).

**Vérification** : compter en base les règles touchées avant/après ; envoyer une soumission et un job de test à soi-même.

---

### Lot 2 — Fiabilité du moteur *(aucune migration)*

**P7 — vérifier les lectures.** Les six de `checkStopConditions` et celles de `resolveEntityVariables`. Règle : une erreur de lecture ne doit **jamais** être interprétée comme « entité supprimée ». En cas d'erreur → ne pas annuler, réessayer au tick suivant.

**P6 — récupérer les tâches figées.** Au début de chaque tick, remettre en `pending` les tâches `running` depuis plus de 15 minutes. Débloque aussi la clé d'unicité.

**P5 — verrouiller les planificateurs.** Aligner sur les autres crons via `withAdvisoryLock`. Ajouter `.eq('status','pending')` à la prise, pour que deux instances ne puissent pas revendiquer la même tâche.

**P9 — la création de tâche.** Retomber sur une entité conforme à la contrainte (`job` via `schedule_events.job_id`), ou élargir la contrainte. La première est moins risquée.

**Vérification** : simuler une erreur de lecture et vérifier qu'aucune tâche n'est annulée ; tuer le processus en plein tick et vérifier la reprise.

---

### Lot 3 — Le déplacement de visite *(P4)*

Faire ce que mon commit d'aujourd'hui prétendait faire :
1. annuler les tâches en attente de l'événement déplacé ;
2. ré-émettre pour replanifier sur la nouvelle date.

Attention à l'ordre : annuler **avant** de ré-émettre, sinon la clé d'unicité rejette la nouvelle tâche (`23505`) et on se retrouve avec les anciennes seules — pire qu'avant.

**Vérification** : déplacer une visite et constater que les tâches en attente portent la nouvelle date.

---

### Lot 4 — Conditions et workflows *(P10, P11)*

**P10** — comparaison tolérante aux types (normaliser en chaîne avant comparaison), et **rejeter** un opérateur non supporté au lieu de l'ignorer. Une condition qu'on ne sait pas évaluer doit bloquer la règle, pas la laisser passer.

**P11** — les workflows différés ne peuvent pas réutiliser `automation_scheduled_tasks` tel quel. Deux voies : rendre la colonne nullable avec un `workflow_id` séparé (migration), ou matérialiser le workflow en `automation_rules`. **À trancher avec toi** — c'est un choix d'architecture, pas un correctif.

---

### Lot 5 — Visibilité et contenu *(P8, P12, P13)*

**P8** — afficher le texte des messages dans le panneau déroulant de la page Automatisations, et rendre les courriels modifiables comme les SMS le sont déjà.

**P12** — ajouter la mention STOP aux SMS commerciaux (pas aux transactionnels).

**P13** — traduire les notifications et tâches internes.

---

### Lot 6 — Dette *(P15)*

Unifier les trois tables de traduction, retirer les clés fantômes, traduire les descriptions. Aucun impact fonctionnel — à faire quand le reste est stable.

---

## 4. Ordre recommandé

```
Lot 0  →  Lot 1  →  Lot 2  →  Lot 3  →  Lot 4  →  Lot 5  →  Lot 6
filet    clients   moteur    visite   moteur    interface  dette
```

Le raisonnement : le filet d'abord ; puis ce que les clients reçoivent (visible, sans migration) ; puis la fiabilité (invisible mais structurel) ; l'interface en dernier, quand le comportement est stable.

**Lots 0 à 3 : aucune migration.** Seul le lot 4 peut en demander une, selon l'option retenue pour P11.

---

## 5. Décisions qui t'appartiennent

1. **P1** — supprimer le sondage SMS, ou le décaler ? *(je recommande : supprimer, redondant avec la demande d'avis)*
2. **P2** — retirer la condition, ou faire émettre `payment_type` par le webhook ? *(je recommande : émettre, la distinction a une valeur métier)*
3. **P11** — migration pour un `workflow_id` séparé, ou matérialiser les workflows en règles ?
4. **P8** — rendre les courriels modifiables est une vraie fonctionnalité (éditeur, prévisualisation, variables). Chantier séparé, ou dans la foulée ?

---

## 6. Écarté après vérification

Trois alertes des rapports d'audit **ne se confirment pas** en base. Elles figurent ici pour qu'on ne les réintroduise pas :

- **« Les relances de devis ne s'arrêtent pas à l'acceptation »** — faux. `checkStopConditions` couvre `approved`, `declined`, `changes_requested`, `expired`, `converted`, `archived`, `void`.
- **« Délai négatif inversé par `Math.abs` hors rendez-vous »** — le code est bien tel que décrit, mais **0 règle en production** est dans ce cas (138 délais négatifs, tous sur `appointment.created`). Défaut latent, pas un incident. À corriger dans le lot 2 par précaution, sans urgence.
- **« Deux générations de presets coexistent en base »** — faux. Vérifié sur `client_anniversary` et `stale_lead_7d` : les 30 orgs actives portent toutes la même version. La divergence existe entre le fichier TypeScript et la migration SQL, mais elle ne s'est jamais matérialisée.

---

## 7. Ce que ce plan ne couvre pas

- Les jobs récurrents ré-arment 8 automatisations à chaque occurrence. Sur un contrat d'entretien mensuel, le client reçoit vente croisée + réengagement + rappel saisonnier **en boucle**. Ce n'est pas un bug de code : c'est un choix de conception des presets. À traiter comme une question produit.
- Le module de modèles de courriels reste inaccessible depuis l'interface (décision prise ce matin de le laisser en l'état).
