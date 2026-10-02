# M — corrections du moteur d'automatisations

Agent M · branche `mission/auto-finale-b` · arbre `D:/lume-final/wt-b` · bureau de test « (b) » de la pile locale.
Rien n'est poussé. Rien n'a touché la prod ni staging. Aucune migration dans `supabase/migrations/`.

**Tête de la branche : `@@TETE@@`** (@@NB@@ commits depuis `905a7c5e`, l'enquête B).

Règle suivie pour la colonne « vérifié » : *oui* = j'ai VU le test passer sur la pile locale, vrai moteur,
après le correctif. Un constat dont je n'ai pas vu le test passer n'est pas dit « corrigé ».

---

## 1. Constat → commit → tests → vérifié sur la pile locale

### Priorité 1

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-13** — une confirmation coupée par un redémarrage n'était jamais envoyée | `7138167b` | unit. `B-13-reservation-orpheline` ; pile locale `b-02-redemarrage` | oui |
| **B-18** — « Date atteinte » : un balayage manqué n'était jamais rattrapé | `33e1cfc0` | unit. `B-18-rattrapage-dates` ; `b-18-rattrapage` (B18-10…), `b-10-activation` B10-05 | oui |
| **B-14** — « Note ajoutée » / « Tâche terminée » ne partaient que d'un seul écran | `0dd26911` + preuve `6144888d` | unit. `B-14-note-et-tache-par-la-base` ; `b-02-producteurs` B2-01, B2-02, **B2-02b** (un seul départ) | oui — avec la migration proposée **M-02** |
| **B-19** — le tick pouvait se figer sans que rien le dise | `e48d8451` | unit. `B-19-tick-surveille` ; `b-19-tick` | oui |
| **Parcours vidé** (coordinateur, P1) — `steps = []` : l'ancien message d'`actions` partait encore | `a937f81f` | unit. `M-parcours-vide-ancienne-copie` ; `m-01-parcours-vide` (les deux sens) | oui |

### Point 9 — revalidation avant tout envoi différé (un seul mécanisme)

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-05** — arrêt sans raison lisible | `31230cb9` | unit. `B-05-arret-motif-et-journal` ; `b-09-revalidation` B9-01, 02, 06, 09 | oui |
| **B-03** — facture, job, opportunité à la corbeille : le message partait | `85581e1e` | unit. `B-03-entite-supprimee` ; B9-05, B9-19… | oui |
| **B-01** — rappel de rendez-vous d'un job annulé | `7052b4df` | unit. `B-01-job-annule-rappel` ; B9-10 | oui |
| **B-15** — rappel à un client mis à la corbeille | `5e84a326` | unit. `B-15-client-supprime-toute-entite` ; `b-15-modification` B13-01 | oui |
| **B-04** — conditions jugées seulement à l'événement | `0d5a0baa` | unit. `B-04-conditions-rejugees` ; B9-16, B9-17 | oui |
| **B-02** — rendez-vous déplacé : rappels à l'ancienne date | `795acd4d` | unit. `B-02-rendez-vous-deplace` ; `b-02-producteurs` B2-03, B2-04 | oui — avec **M-04** |
| **B-16** — fusion de fiches : « client supprimé », la fiche gardée ne recevait plus rien | `f25c9a92` + `ff0d7bb7` | `b-09-revalidation` B9-15, B9-15b, **B9-15c** | oui — avec **M-03** (le correctif est tout entier en base) |
| mesure des requêtes | `12575447` | unit. `perf-revalidation-requetes` | — |
| suite alignée | `baa1a3d5` | B-322, C-010, M-004 | oui |

### Point 10 — activation sans effet rétroactif

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-06** — « Opportunité qui dort » écrivait à toutes les dormantes | `a37d2484` | unit. `B-06-opportunite-qui-dort-activation` ; `b-10-activation` B10-03, B10-03b | oui — avec **M-01** |
| **B-07** — « Client inactif » relançait les déjà-inactifs | `9914d9a9` | unit. `B-07-client-inactif-activation` ; B10-04, B10-04b | oui — avec **M-01** |

### Point 11 — fenêtre d'envoi

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-08** — courriel « facture en retard » à minuit ; relances de paiement à heure UTC fixe | `f8277ec9` (+ `ab33f62d`) | unit. `B-08-fenetre-envoi-tout-message` ; `b-11-heures-envoi` B11-01, B11-04 | oui |
| **B-09** — report hors heures sans trace | `f8277ec9` | unit. `B-09-report-hors-heures-journal` ; B11-03 | oui |

### Point 14 — rafales

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-10** — « 30 par minute » annoncé, 37 puis 30 par cinq minutes | `93d6bc33` | unit. `B-10-debit-textos` ; `b-14-masse` B14-01, 02, 02b, 03 | oui — mesuré : 30 / min, pointe 30 sur 60 s glissantes, 300 sur 300 en 11,4 min |
| **B-11** — courriels non régulés | — | `b-14-masse` B14-11 (reste ROUGE) | **NON CORRIGÉ**, voir § 6 |

### Point 15 — modifier une automatisation active

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-12** — mélange des deux versions | `9869b812` | unit. `B-12-modifier-automatisation-active` ; `b-15-modification` B15-01, 02, 03 | oui |

### Le reste de la liste B

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **B-20** — l'ancien système tournait à chaque tick | `0a2d4c3b` | unit. `B-20-ancien-systeme-retire` ; statiques `tests/emails/delivery-reliability` | sans base (retrait de code) — typecheck et suites verts |
| **B-21** — filet aveugle au-delà de 1 000 envois simulés | `2f44b422` | `b-00-harnais` B0-01 | oui |
| **B-22** — au-delà de 500 factures en retard, les suivantes jamais relancées | `e6f60086` | unit. `B-22-relances-toutes-les-pages` ; `m-22-relances-volume` M22-01, 02 (rouge avant, vert après) | oui |
| **B-24** — opportunité qui se rendort : plus jamais signalée | `e4127f66` (preuve) | `m-24-opportunite-qui-se-rendort` M24-01, 02, 03 | oui — avec **M-05** ; sans elle, M24-01 est rouge |
| **B-23** — « Nouveau prospect » pour un prospect du porte-à-porte | — | — | **NON TRAITÉ**, voir § 6 |
| **B-17** — plusieurs déclencheurs | — | — | **NE PAS FAIRE** (consigne) |

### Trouvé en route (pas dans la liste B)

| Constat | Commit | Tests | Vérifié |
|---|---|---|---|
| **M-25** — rappel de paiement pour une facture à la corbeille | `b4da8c0e` | unit. `M-25-relance-facture-corbeille` ; `m-25-relance-facture-corbeille` M25-01 (rouge avant) | oui |
| Mesures de charge qui salissaient le bureau de test | `12cd6b84` | — | oui (10-b-actions 25 / 25 après ménage) |
| Huit tests statiques hors zone cassés par mes points 9, 11 et B-20 | `55f81591` | `tests/emails/**`, `tests/jobs-et-factures-coherents` | oui (suite racine) |

### Compléments du coordinateur

| Demande | Commit | Tests | Vérifié |
|---|---|---|---|
| Codes de journal, point 1-2 (arrêts, reports, `une_fois_par_client`) | au fil des constats + `ade353e5` | unit. `M-une-fois-par-client-journal` | sans base |
| Point 3 = **E-66** = **D-03** — plafond de fréquence : un saut, pas un échec | `27097dd0` | unit. `M-plafond-frequence-saute` ; F-080, F-081 ; `consentement-commercial` | oui |
| Point 4 — demande d'avis et « rien à modifier » : des sauts | `6ec261b4` | unit. `M-sauts-avis-et-sans-cible` ; B-115, B-119 | oui |
| Point 6 — le moteur n'écrit que des codes connus | `2aaa7b04` | unit. `M-codes-de-saut-connus` | sans base |
| **A-21** — courriel en texte brut envoyé en un seul bloc | `f942a4d0` | unit. `A-21-courriel-texte-brut-paragraphes` (23 cas) ; le test rouge de la branche A, rejoué ici : vert | oui |
| **E-11** — STOP : aucun texto, drapeau ou non | `a368882d` | unit. `E-11-stop-aucun-texto` ; G-011, G-011b | oui |
| Revue des migrations (M-01 `REVOKE`, M-03 conflit de clé, preuve M-02) | `ff0d7bb7`, `6144888d` | B9-15c, B2-02b | oui |

---

## 2. Nouveaux codes et motifs écrits au journal

Convention : `automation_execution_logs.result_success = true`, `result_data = { saute: '<phrase FR>', saute_code: '<code>', …détail }`.
Une tâche arrêtée ou reportée garde aussi le motif sur elle (`last_error`) et le code dans `action_config.motif_code`.
Je n'ai touché ni `OngletJournaux` ni les écrans de liste.

**Déjà dans `src/lib/automationMotifs.ts`, maintenant écrits par le moteur :**

| Code | Quand | Phrase (`saute`) |
|---|---|---|
| `condition_plus_valide` | revalidation : la situation a changé | « Condition plus valide : la facture a été payée » (le changement suit les deux-points) |
| `entite_supprimee` | fiche à la corbeille | « Fiche supprimée : la facture a été supprimée » |
| `fiche_fusionnee` | écrit par `fusionner_clients` (M-03) | « Fiche fusionnée avec une autre : la relance continue sur la fiche gardée » |
| `client_a_repondu` | arrêt sur réponse | « Le client a répondu » |
| `etape_retiree` | étape supprimée ou remplacée ; tâche à plat d'une règle devenue parcours | « Étape retirée du parcours » |
| `regle_inactive` | règle repassée en brouillon ou supprimée | « L'automatisation a été repassée en brouillon » / « … a été supprimée » |
| `rappel_perime` | le moment du rappel est passé | « Rappel périmé : … » |
| `hors_heures` | UNE ligne au premier report, créneau dans le détail (`prochain_creneau`) | « Reporté : hors heures d'envoi — partira au prochain créneau (lundi 8 h) » |
| `rafale` | UNE ligne au premier report | « Envoi étalé : plus de 30 textos en une minute, celui-ci part au prochain créneau » |
| `une_fois_par_client` | déjà passé récemment | « Déjà passé par cette automatisation il y a moins de 7 jours » |
| `plafond_frequence` | 3 messages commerciaux / 24 h | « Limite d'envois atteinte : ce client a déjà reçu 3 messages commerciaux en 24 h » — destinataire dans `to`, jamais dans la phrase |
| `avis_desactives`, `sans_lien_avis`, `deja_envoye` | demande d'avis | phrases françaises, plus d'anglais |
| `sans_cible` | l'action n'avait rien à modifier | « L'opportunité est déjà dans cette étape », « Un responsable était déjà assigné : il n'a pas été remplacé »… |
| `desabonne` | numéro STOP (E-11 : aussi le transactionnel sous le drapeau) | « Client désabonné (texto) » |

**À AJOUTER à `MOTIFS` (le moteur les écrit déjà ; le test `M-codes-de-saut-connus` les tolère tant qu'ils sont dans sa liste « à ajouter ») :**

| Code | Catégorie | Groupe | FR | EN |
|---|---|---|---|---|
| `parcours_vide` | ignorée | autre | Le parcours ne contient aucune étape | The workflow has no steps |
| `anterieur_activation` | ignorée | hors_ciblage | Situation déjà en cours avant l'activation de l'automatisation | Already the case before the automation was turned on |
| `rendez_vous_deplace` | reportée | condition_plus_valide | Rendez-vous déplacé : le rappel suit la nouvelle date | Appointment moved: the reminder follows the new date |

**Pas fait : `pause_bureau`.** L'événement d'un bureau en pause est ignoré avant la lecture des règles ; une ligne par règle et par
événement pour un bureau qui a demandé que tout s'arrête n'était pas « simple ».

**Un nouvel ÉCHEC (pas un saut), passager :** « Lecture de la liste STOP impossible (erreur technique) — envoi suspendu » (E-11).
À faire traduire par l'écran si on veut une phrase plus douce.

---

## 3. Migrations proposées — `D:/lume-final/notes/M-migrations-proposees/`

Toutes appliquées à la pile LOCALE seulement. Les deux fichiers `*_LOCAL_bureaux_b_seulement.sql` ne doivent JAMAIS aller ailleurs
(ils restreignent les triggers à mes deux bureaux de test).

| Fichier | Pourquoi | Sans elle |
|---|---|---|
| **M-01** `automation_rules.activee_le` | date du dernier passage à « actif » (trigger + reprise par `updated_at`) : c'est elle qui dit ce qui est « antérieur à l'activation » (B-06, B-07) | le moteur se replie sur `updated_at` : le comportement tient, moins précis (une modification du nom repousse la date). `REVOKE` ajouté sur la fonction de trigger (revue). |
| **M-02** note ajoutée / tâche terminée par la base | deux triggers vers `automation_evenements_base` (B-14) | « Note ajoutée » depuis l'onglet Notes et « Tâche terminée » par Lumi ne partent pas. **Preuve du départ unique** écran + base : `b-02-producteurs` **[B2-02b]** (vraie route, vrai trigger, vrai moteur) et unit. `B-14…` « terminée à l'écran ». |
| **M-03** `fusionner_clients` + relances en attente | la relance suit la fiche gardée, sinon s'arrête « fiche fusionnée » (B-16). Revue : repointage tâche par tâche sous `exception when unique_violation` ; droits redits (`anon` avait EXECUTE sur la pile locale ; la baseline dit que la prod ne l'a pas — à vérifier, la fonction saute le contrôle de permission quand `auth.uid()` est nul) | la relance est annulée « client supprimé » (motif juste depuis B-15, mais la fiche gardée ne reçoit rien) |
| **M-04** rendez-vous déplacé par la base | trigger sur `schedule_events` (B-02) | un rendez-vous déplacé hors de l'écran garde ses rappels ; la revalidation à l'échéance les rattrape quand même (report ou « rappel périmé »), mais sans recalage immédiat |
| **M-05** opportunité qui se rendort | clé d'unicité + jour de la dernière activité, garde sur l'ancienne clé (B-24) | M24-01 rouge : une opportunité revenue dans la même étape n'est plus jamais signalée |

---

## 4. Comportement décidé (trois lignes chacun)

**Point 9 — revalidation.** Une fonction par type d'entité (`REVALIDATEURS`, `server/lib/sortie-parcours.ts`), appelée à UN endroit
pour toute tâche différée, juste après sa prise. Arrêt = tâche `cancelled` + motif lisible + une ligne au journal (« Condition plus valide :
la facture a été payée », code `condition_plus_valide`). Une lecture en échec ne conclut jamais ; ce que la règle modifie elle-même n'est pas rejugé ; une fusion suit la
fiche gardée (M-03), sinon « fiche fusionnée ».

**Point 10 — activation.** Aucun effet rétroactif : « Opportunité qui dort » et « Client inactif » ignorent ce qui était déjà dans
l'état visé avant l'activation (journal : `anterieur_activation`). « Inclure les cas existants » n'est PAS bâti ; son seul point de
branchement est `ignoreLesCasExistants()` dans `server/lib/automations-activation.ts` (rend toujours vrai) — y lire un réglage de la
règle suffira, et le balayage « Client inactif » lit déjà la date par seuil (`depuis`).

**Point 11 — heures d'envoi.** 8 h – 20 h, heure de l'entreprise (America/Toronto par défaut), pour TOUT message au client — texto,
courriel, demande d'avis, envoi de facture ou de soumission — avec ou sans délai, règle à plat ou parcours, et les relances de
paiement du cron. Hors fenêtre : reporté au prochain créneau, sans consommer de tentative, journalisé une fois (`hors_heures`).
Notifications internes et tâches : jamais retardées. Le réglage par automatisation (`settings.fenetre`, `jours_ouvrables`) est gardé.

**Point 14 — rafales.** 30 textos par minute et par entreprise, jamais plus : chaque texto réserve sa place avant de partir
(mémoire + base), le surplus est reporté à l'instant où une place se libère et une cadence du planificateur écoule la file sans
attendre le tick. Aucune perte (300 sur 300), une ligne `rafale` au premier report. Courriels : mesurés, pas régulés (§ 6).

**Point 15 — modification d'une automatisation active.** L'exécution en cours suit la version COURANTE à sa prochaine étape ; une
étape qui attend garde l'échéance déjà fixée ; une étape supprimée ou remplacée arrête proprement l'exécution (« étape retirée du
parcours », pas d'erreur, pas de saut vers une autre étape). Écrit en tête de `automationSequences.ts` et sur
`actionCouranteDeLaTache` (moteur).

---

## 5. Lecteurs de `actions` face à `steps` (complément P1)

Règle unique, `estParcours` (`automationSequences.ts`) : dès que `steps` est un tableau, même vide, la règle est un parcours et
`actions` n'est jamais lu.

- Alignés : `lancerRegle` (moteur, donc aussi « Démarrer une automatisation ») ; la file planifiée (tâche à plat d'une règle devenue
  parcours → `etape_retiree`) ; l'action « Démarrer une automatisation » (`regleSansRienAFaire`) ; `couvertureAutomatisations`
  (relances de paiement).
- Vérifiés sans changement (ne lisent pas `actions`) : `estRegleDeRelanceFacture`, `relanceFactureDejaPartie`, `dejaPasseRecemment`,
  `sortie-parcours.ts`, les balayages (dates, client inactif, opportunité qui dort).
- Hors zone, non regardés par moi : `server/lib/lumi/execution.ts` (`ecrituresSensiblesPour`, constat A-11), l'éditeur, les routes.

---

## 6. Non corrigé, et pourquoi

- **B-11 — courriels d'une rafale non régulés.** Mesuré : 300 courriels, pointe de 24 par seconde en local, 0 échec, lecture de
  l'app p95 26 ms pendant la rafale. Je n'ai pas régulé : un limiteur en mémoire entre en conflit avec le délai de 5 s par action et
  le rejeu de l'outbox à 3 minutes, et le quota réel du fournisseur en prod m'est inconnu. À décider avec le chiffre de SES.
  `b-14-masse` B14-11 reste rouge exprès.
- **B-17** — consigne : ne pas faire.
- **B-23 — « Nouveau prospect » pour un prospect du porte-à-porte.** Non prouvé par exécution. Le correctif est hors zone
  (`field-sales.ts`, `fieldPinSync.ts`, `leadClientSync.ts`) ou en base (trigger sur `clients`) ; un trigger devrait être dédoublonné
  contre les trois routes qui émettent déjà `lead.created`, et porter la `source` (le pack l'utilise en condition). Risque de doublon
  sur le déclencheur le plus utilisé : je ne l'ai pas tenté en fin de mission.
- **B-20, partie « factures récurrentes ».** Retiré : la table `automations` et tout son chemin. NON retiré : le clonage
  `invoices.is_recurring` — l'interrupteur « Facture récurrente » de la fiche d'une facture (`src/pages/InvoiceDetails.tsx`) écrit
  toujours ces colonnes et le planificateur est leur seul lecteur. La liste de l'enquête le disait mort : il ne l'est pas. À décider.
- **`pause_bureau`** au journal : pas fait (§ 2).
- **Constats du registre non assignés à moi et non faits** : E-06 (« Démarrer une automatisation » ignore les conditions de la règle
  démarrée), E-07, E-32, E-37, D-04. E-05 (ciblage jugé au déclenchement) est couvert pour les CONDITIONS de la règle par B-04 ; le
  ciblage que bâtit l'agent P devra se brancher au même endroit (`revaliderTache`).

---

## 7. Pour le coordinateur — hors de ma zone

**Fichier neuf hors de la liste de ma zone :** `server/lib/automations-activation.ts` (point 10).

**Tests hors zone modifiés, par nécessité (chaque commit dit pourquoi) :**
- `tests/emails/delivery-reliability.test.ts`, `tests/emails/automation-moteur.test.ts`, `tests/jobs-et-factures-coherents.test.ts`
  — tests statiques qui épinglaient le texte du code déplacé ou retiré (`0a2d4c3b`, `55f81591`) ;
- `tests/automation/**` — instantanés du filet de régression, `consentement-commercial`, `desabonnement-canal`,
  `vague2-etalement-textos`, `vague2-fenetre-envoi`, `vague2-une-relance-par-jour`, `launch-relance-unique`, `launch-erreurs-avalees`.
Aucun test désactivé. Les attentes changées suivent une décision de la mission (plafond, avis, STOP, fenêtre d'envoi).

**À faire par toi :**
1. Appliquer M-01 à M-05 (staging puis prod) ; ne jamais appliquer les variantes `_LOCAL_`.
2. Ajouter `parcours_vide`, `anterieur_activation`, `rendez_vous_deplace` à `src/lib/automationMotifs.ts`, puis vider la liste
   « à ajouter » du test `M-codes-de-saut-connus`.
3. `/api/health` peut exposer l'état du tick : `etatDuTick(getServiceClient())` (`server/index.ts`, hors zone). La route
   `GET /api/cron/etat-tick` existe déjà.
4. Après M-02 : retirer l'appel du navigateur `emitTaskCompleted`. Tant qu'il reste, un appel qui arrive plus de 10 s après
   l'écriture produit un second événement (seul l'anti-doublon de 2 min du moteur reste alors).
5. `tests/automations-finale/**` est pris par le `include` de `vitest.config.ts` : ces fichiers échouent dans la suite racine hors
   de la pile locale. À exclure avant toute fusion (déjà signalé par B et E).
6. `server/lib/scheduler-utils.ts` (hors zone) : `addDelay` et `subtractDelay` n'ont plus d'appelant depuis B-20.
7. Deux fiches client au même numéro : le consentement texto de l'une vaut pour l'autre (la recherche prend la première fiche qui
   porte ce numéro). Vu par hasard (G-018, collision de numéros de test). Domaine de l'agent E.

**Ménage fait à la main dans la pile locale (bureaux « (b) » seulement) :** 1 800 factures des mesures B14 annulées et mises à la
corbeille ; 2 539 événements `automation_evenements_base` en arriéré marqués traités. Les mesures nettoient maintenant derrière
elles (`12cd6b84`).

**Arbre de travail en plus :** `D:/lume-final/wt-m-suite` (tête détachée, pour rejouer la suite sur un instantané) — à retirer par
`git worktree remove D:/lume-final/wt-m-suite`. Aucun serveur lancé par moi ne tourne.

---

## 8. Résultats exacts

@@RESULTATS@@
