# Plan d'attaque — Automatisations (mission V2, 2026-09-29)

Tiré de `AUDIT_AUTOMATISATIONS_V2.md` (même dossier). Chaque ligne est un défaut **prouvé** et revérifié avant d'entrer ici ; les faux positifs sont écartés en fin de document. Les vagues sont dans l'ordre du risque pour la prod : argent et sécurité, puis ce qui fait partir un faux message, puis ce qui en perd un, puis l'interface, puis le confort.

Légende effort : XS < 1 h · S ½ journée · M 1 jour · L plusieurs jours. Risque prod = risque que le **correctif** abîme quelque chose.

---

## Vague 0 — mettre en prod ce qui est prêt — ✅ FAIT le 2026-09-30

#753, #755 (+ D-01), #756, #757 (incluait #752) mergées ; migrations 20261003100000, 20261003100010 et 20261003100100 (après déploiement) appliquées en prod et vérifiées.

Rien de neuf à coder : les 5 PR du launch sont vertes. **Tant qu'elles ne sont pas mergées, tous les défauts du 28 sont encore en prod** (réconciliation : 120 tests des PR échouent sur `main`).

| Ordre | Action | Détail |
|---|---|---|
| 1 | `db:apply:prod` **20261003100000** (événements par la base) | déjà sur staging |
| 2 | **Nouveau** : montrer puis appliquer **20261003100010** (« Retirer de l'horaire » émet l'annulation, D-01) — staging puis prod | ajouté ce soir à #755 ; sans lui, les No-Show Follow-Up de Coquin lavage et Vision Lavage **meurent au merge** |
| 3 | Merger #753 → #755 → #756, et #752 → #757 | #756 contient #753 + #755 (avec D-01) |
| 4 | **Après déploiement** : `db:apply:prod` **20261003100100** (sécurité) | l'ancienne interface lit `api_key` : pas avant |
| 5 | `check:broken-objects`, `check:db-coherence`, `check:schema-refs -- --prod` | |

## Vague 1 — ✅ FAIT le 2026-09-30 (#760, #764, #771 mergées ; secret `app_base_url` posé en prod, 20261003100200 appliquée staging + prod)

| PR | Contenu | Preuve | Migration |
|---|---|---|---|
| **#760** | Harnais : golden set des 38 préréglages **en CI** (1/77 → 77/77), mocks communs, quarantaine qui ne ment plus (65/195 → 91/118 verts) | mutation : un texte changé = 1 rouge | non |
| **#764** | **Stripe compté deux fois** (Critique, latent) ; `invoice.paid` sur acompte ; `execute-action` retirée (écriture inter-bureaux) ; cron de staging qui appelait la prod ; « Envoyer dans Slack » qui publiait dans NOTRE canal de support | banc staging avant/après ; 4 tests rouges sur main | **20261003100200** — ⚠️ poser `app_base_url` en prod AVANT |
| **#771** | Construire avec Lumi : L-1 à L-10 (tâches, « la veille », variables, refus expliqués, garde-fous, budget, double clic, brouillon vide) | 14/17 tests rouges sur la base ; 30 demandes rejouées sur le vrai modèle | non — **après #756/#757** |

## Vague 2 — moteur : ce qui envoie faux, en double, ou perd un message — ✅ FAIT le 2026-09-30

**#792** mergée ; migrations **20261004200000** (D-03), **20261004200100** (D-09) et **20261004200200** (C29/C30 : 3 jobs pg_cron) appliquées staging puis prod et vérifiées. Arriéré mesuré avant d'allumer les crons : 0 webhook dû, 0 facture récurrente due, 0 règle « date atteinte ». 1er passage de `lume_webhook_retries` en prod à 16:50 UTC : HTTP 200, 0 erreur. Test de fumée en prod (bureau « Grok Audit (TEST) », ménage vérifié) : 2 appels simultanés au même webhook entrant → 2 reçus, 2 exécutions, 2 tâches (D-02 vivant sur lumecrm.net).

- **C20** : déjà corrigé par une autre session (20261002900000, `payments.refunded_cents` — présent en prod ET staging, vérifié).
- **D-14 / « Demander un avis »** : #780 (autre session) a retiré le champ texte que le moteur ignorait ; on garde SA solution, le test la verrouille.
- Trouvé avant le merge par `check:schema-refs --prod` : le paiement manuel de Lumi écrivait `payments.notes`, colonne absente → toute l'insertion aurait échoué. Retiré.


| id | Problème | Preuve | Correction | Fichiers | Test d'acceptation | Effort | Risque | Migration |
|---|---|---|---|---|---|---|---|---|
| D-07 **Critique** | « Attendre la réponse (au plus N jours) » **n'attend pas** : relance 1 à 5 min après (aussi sur main) | B-etapes : `execute_at` = maintenant pour 86 400 s | ajouter `delai_secondes` à l'échéance de l'attente `reponse` | automationSequences.ts (`planifierEtape`) | parcours « attendre la réponse 1 j » : tâche à +24 h ; réponse reçue → branche `si_reponse` | S | moyen | non |
| D-15 Élevée | Rejeu d'outbox après un arrêt : tâches et webhooks **recréés en double** | B-rejeu3 : 2 tâches, 2 POST | garde « déjà exécuté depuis `rejoueDepuis` » pour toutes les actions | eventBus.ts, automationEngine.ts | rejeu → 0 action en double (banc `qa:outbox`) | M | moyen | non |
| C24 / D-08 Élevée | Webhook sortant lent **envoyé 2 fois** ; action lente réussie mais journalisée « échec » (66/150 sous charge) | webhook.site 2 POST ; B-rejeu3 | borner l'appel sous le délai du moteur + `Idempotency-Key` ; journaliser le résultat réel même après le délai | url-sortante.ts, automationEngine.ts (`avecDelaiMax`) | webhook à 8 s → 1 POST, journal « réussi » | M | moyen | non |
| D-02 Élevée | 2 appels d'un **webhook entrant** en < 2 min : le 2e prospect est perdu | B-webhook-deux-prospects | clé anti-doublon avec l'id de réception | automationEngine.ts, webhooks-entrants.ts | 2 prospects → 2 exécutions | S | faible | non |
| D-05 Élevée | Facture **brouillon** échue → relance « en retard » (4 brouillons en prod) | B-decl2d | exclure `draft` | scheduler.ts (`detectOverdueInvoices`) | brouillon échu → 0 événement | XS | faible | non |
| D-06 Élevée | « Envoyer la facture / le devis » laisse le document en **brouillon** : relances jamais lancées | B-actions | même mise à jour que `/emails/send-invoice` | actions/index.ts | après l'action : statut `sent`, `invoice.sent` émis | S | moyen | non |
| C20 Élevée (= bug 12) | Remboursement partiel refusé en silence par la contrainte | stripe.json | `refunded_cents` + statut `partially_refunded` (décision du 28 : pas de simple ajout au CHECK) | migration + payments.ts | remboursement de 20 $ sur 100 $ : paiement conservé, 20 $ remboursés visibles | M | **élevé** (totaux) | **oui** |
| D-03 Élevée | `deal.stage_idle` ne part **jamais** pour une règle faite dans l'éditeur | B-decl2d | lire `conditions.stage_id`, vide = toutes les étapes | fonction SQL `pipeline_detecter_stagnation` | règle éditeur détectée | S | faible | **oui** |
| D-14 Élevée | 36/38 préréglages refusés par la route d'enregistrement | presets installer | aligner données ↔ Zod (`log_activity`, `description`, `metadata`…) | automationPresets.data.ts, validation.ts | chaque préréglage passe `sequenceEtapes`/actions (test) | M | moyen | non |
| C12 Élevée | Répondre **par courriel** n'arrête aucune relance (seul le texto émet `client.replied`) | code | émettre depuis la synchro Gmail pour un expéditeur connu | sync Gmail, automationSequences.ts | réponse courriel → relance annulée | M | moyen | non |
| C29/C30 Élevée | `rappels-dates`, `recurring-invoices`, `webhook-retries` : **aucun appelant trouvé** (latent : 0 donnée en prod) | dépôt + pg_cron | **toi d'abord : vérifier Railway** ; sinon jobs pg_cron | migration pg_cron | appel quotidien visible dans `cron.job_run_details` | S | faible | oui |
| D-16 Moyenne | Facture en retard : relance « en retard » ET relance J+1 | B-relance-unique | compter les préréglages `invoice_sent_reminder_*` dans la coordination | reminders-cron.ts | 1 seule relance | S | faible | non |
| D-09 Moyenne | `create_task` en collision sous charge (`max()+1`) | B-decl2d | verrou par org ou séquence | migration | 20 tâches simultanées → 20 | S | faible | oui |
| D-12 / D-13 / D-11 / D-10 Moyenne-Faible | Réentrée ignorée pour un parcours ; fenêtre d'envoi ignorée par les courriels immédiats ; exemples de Si sur des clés absentes ; `smsSent: true` pour un texto sauté | 12-moteur | voir 12-moteur | automationSequences.ts, automationEngine.ts, actions | un test par point | S chacun | faible | non |
| Lumi-bis | Liaison Lumi : les outils Lumi enregistrent un paiement **sans ligne `payments`** : un paiement Stripe ultérieur recalcule et l'efface | lecture (tools-argent.ts:1232, tools-etendus.ts:2877) | insérer un paiement manuel (le trigger recalcule) | tools-argent.ts, tools-etendus.ts | Lumi enregistre 40 $, Stripe 60 $ → payée 100 $ | S | moyen | non |

## Vague 3 — conformité texto et courriel — ✅ FAIT le 2026-09-30

**#784** mergée ; migrations **20261004100000** (journaux) puis **20261004100100** (clé de webhook non choisie) appliquées staging puis prod, vérifiées (`api_key` ni insérable ni modifiable par `authenticated`). F11 est livré dans la vague 2 (étalement 30 textos/min par bureau, jamais de plafond).

⚠️ **Effet de L8 à connaître** : 7 bureaux sur 9 n'ont pas d'adresse dans Réglages → leurs courriels **commerciaux** sont sautés (avec motif dans les journaux) tant qu'elle manque. Les courriels transactionnels (facture, devis, rendez-vous) partent normalement.


| id | Problème | Correction | Effort | Migration |
|---|---|---|---|---|
| L3 Élevée | Un texto « Oui » **lève un STOP** | seul START (ou consentement saisi) réabonne, et seulement le bureau du numéro `To` | S | non |
| L2 Moyenne | Un STOP coupe **toutes** les entreprises | limiter au bureau du `To` ; activer `auto_desabonnement_canal` (Vision Lavage d'abord) | S | non |
| L7 Moyenne | Texto commercial sans « Répondez STOP » ni nom | ajout automatique aux textos commerciaux | S | non |
| L8 Moyenne | Courriel commercial sans nom ni adresse de l'entreprise | sauter avec motif tant que l'identité manque | S | non |
| L4 / L5 Moyenne | Demande d'avis hors heures calmes (20 h 01) ; fenêtre 0-24 h acceptée | `request_review` dans `horsFenetre` ; bornes 8 h-21 h | XS | non |
| C13 / C4 Moyenne | Statut Twilio qui recule, code d'erreur perdu ; rebond SES sans notification | voir 13-15 | S | non |
| Journaux Moyenne | Un membre sans droit sur les automatisations lit 94 journaux (31 destinataires) via `leads.read` | limiter aux entités prospect ou masquer `to` | S | **oui** |
| F11 (décision) | Rafale : 200 textos partent d'un coup ; plafond **écarté** le 23 sept. — le webhook entrant (#644) crée le chemin de rafale | **étaler** (tout part, lentement), pas plafonner | M | non |

## Vague 4 — interface (éditeur et liste) — ✅ FAIT le 2026-09-30 (#782) ; ligne « Tests » faite le 2026-10-01


| id | Problème | Correction | Effort |
|---|---|---|---|
| A-01 Élevée | Supprimer la 1re étape rend la suite **orpheline**, enregistré en silence | la suite de la tête devient la tête | S |
| A-02 Élevée | « Ajouter » actif sur une règle d'ancien format (250/251 en prod) : le moteur abandonne le texte et la tâche d'origine | masquer, ou passer par la conversion | S |
| A-03 Élevée | Une règle **publiée** peut être rendue incompatible et reste publiée | la route PATCH rejoue les contrôles de publication sur l'état final | S |
| A-04 → A-09 Moyenne | Retour du navigateur perd le travail ; « Ajouter » au milieu ; texto vidé accepté ; « FR/EN » ment ; « Aucune erreur » quand les journaux sont illisibles ; erreurs serveur en français pour l'anglais | voir 11-interface | S chacun |
| A-10 → A-17 Faible | textes, libellés, tri des colonnes | voir 11-interface | XS-S |
| PERF-1/2 | La liste télécharge toutes les règles 2 fois ; l'éditeur charge 400 règles pour en montrer une | 1 seule lecture ; lecture par id | S |
| Tests ✅ | 13 tests `front-automations` écrits pour l'ancienne page (dont F22 : variable inconnue, nom brut) | réécrits sur l'écran actuel : `tests/automation/front-automations-ecran.test.tsx`, **57 tests, en CI**. Preuve par mutation : retirer l'avertissement de variable inconnue et le compteur d'échecs fait tomber 4 tests. Deux défauts du produit trouvés au passage, gardés en quarantaine (voir « Constats hors backlog ») | M |

## Vague 5 — performance et charge — T6.2 fait (#792 : 30 → 22 requêtes par `lead.created`, 3 règles = lectures d'une seule) ; outbox prod saine (0 bloqué, 0 erreur au 2026-10-01) ; **D-17 : conclu par lecture du code, correctif à décider**


| id | Problème | Correction | Effort |
|---|---|---|---|
| T6.2 | 21 à 40 requêtes par événement ; réglages de l'entreprise relus 6 fois | mémoïser par événement, regrouper les lectures | M |
| D-17 | Sous saturation : 8/144 écritures sans événement | **Conclu le 2026-10-01 sans refaire la charge** (aucun environnement isolé, disque du poste à 99 %) : `server/lib/champs/service.ts` écrit la valeur (`cf_ecrire_valeur`) puis émet `custom_field.changed` dans une 2e étape non attendue — la perte est réelle par construction, la charge n'en mesurait que la fréquence. Correctif proposé, **non fait** (migration) : déposer l'événement dans la même transaction, comme les visites, jobs, devis et factures (`20261003100000`) | M |
| Outbox prod | Aucun événement dans `domain_events` depuis le 28 à 22:14 (≈ 26 h) | vérifier si c'est normal (types consignés) ou une panne | XS |

## Livré après les vagues (2026-09-30, soir)

| PR | Quoi | Preuve |
|---|---|---|
| **#802** | Corbeille : « Supprimer définitivement » (ligne et lot, avec confirmation). La règle sort de la corbeille pour de bon, et l'**historique d'envois est gardé** (`purged_at`, migration 20261004400000) | 7 tests rouges sans la fonctionnalité ; bout en bout sur staging avec RLS réelle |
| **#799** | Construire avec Lumi **montre le nouveau texte** sous sa phrase et dit franchement quand rien n'a changé. Sonnet 5 au lieu de Haiku. `update_automation_message` réécrit l'étape réellement exécutée | conversation réelle de Rafba rejouée sur le vrai modèle |
| **#805** | Réponses coupées (`max_tokens`), régression anglaise, questions sans réponse, textos > 160 caractères ; second essai sur un JSON illisible. Batterie `npm run qa:construire-lumi` : 12 conversations, 107 contrôles | 1re passe 90 % → **107/107** |
| **#806** | Surveillance des vraies conversations : `npm run qa:surveiller-construire-lumi -- --prod`, en lecture seule | a repéré la conversation qui a déclenché #799 |

**Leçon** : changer de modèle oblige à remesurer `max_tokens`. Tout changement de `generer-parcours.ts` passe par la batterie avant le merge.

## Ce qui t'attend (décisions, pas du code)

1. ~~Merges vague 0 et 1~~ — fait.
2. ~~Migrations~~ — faites (staging puis prod).
3. **Railway** : `CRON_SECRET` de prod à changer (le secret de staging est déjà différent) — il faut changer Railway ET le vault de prod en même temps (`railway login` requis). Les 3 crons manquants : faits en pg_cron (vague 2).
4. ~~**F11**~~ — étalement livré (vague 2).
5. **Cache Haiku** de Lumi (< 4 096 tokens, rien n'est mis en cache) : accepter (0,49 ¢/génération) ou allonger le prompt ?
6. ~~Messages Slack de test~~ — 6 supprimés, 0 restant ; le support (Slack + courriel) n'a pas été touché.
7. **Adresse des bureaux** (effet L8) : 7/9 bureaux sans adresse = courriels commerciaux sautés.
8. **Textos en prod** : sur 8 jours, 1 parti, 13 en échec, 5 sautés — aucun numéro Twilio (Trust Hub). Rien à corriger dans le moteur ; tant que le numéro n'est pas approuvé, aucune automatisation ne livre de texto.
9. **D-17** : faire ou non le correctif (événement de champ déposé dans la transaction d'écriture) — une migration et un changement du moteur.
10. **Sept règles publiées sur `estimate.sent`**, événement plus émis : les rebrancher sur `quote.sent` ou les retirer.

## Phase 5 — rapport de prod (2026-10-01) — ✅ fait

`docs/audits/RAPPORT_PROD_AUTOMATISATIONS_2026-10-01.md`, lecture seule, 24 h après les dernières mises en ligne : **0 exécution en échec en 48 h** (14 sur les 5 jours d'avant), 0 tâche en retard, 0 événement bloqué, crons de la vague 2 tous passés, 0 lettre morte. Limite dite dans le rapport : 43 exécutions en 8 jours, surtout des bureaux de test — la prod ne prouve pas le moteur, staging l'a fait (24/24 déclencheurs).

## Constats hors backlog (notés, **pas** corrigés ici)

| Constat | Preuve | À qui |
|---|---|---|
| ~~Sauvegardes prod en échec depuis le 2026-09-26~~ — **réparé le 2026-10-01** (mot de passe réinitialisé, sauvegarde complète `prod-20261001-0010.dump`, 268 tables). Reste : la tâche planifiée ne tourne que si la session Windows est ouverte ; PITR toujours désactivée | `../lume-backups/` | Rafba |
| ~~D1 — éditeur plein écran : une variable inconnue n'est pas signalée~~ — **corrigé le 2026-10-01**. Le panneau d'étape nomme la variable fautive (texto, courriel, objet, tâche). Le détecteur connaît maintenant les variables pointées du serveur (`{{soumission.total}}`…) : sans ça, 9 règles de base en prod auraient reçu une fausse alerte (mesuré sur les 371 règles, lecture seule) | `tests/automation/front-automations-panneau-etape.test.tsx` (10 tests rouges sur l'ancien code) | fait |
| ~~D2 — éditeur plein écran : le nombre de textos facturés n'est pas affiché~~ — **corrigé le 2026-10-01**. « 200 / 1600 · 2 SMS ». Au passage, le calcul est devenu juste : la liste divisait par 160, alors qu'un « ê », un « ç » ou un émoji fait passer le texto en tranches de 67 (100 caractères accentués = 2 SMS, pas 1). Même calcul que le serveur, tenu par un test de parité | même fichier | fait |
| Migration fantôme **20260928120000** : `payments.reference` / `payments.notes` absentes en prod ET staging | `information_schema` des deux bases ; « Marquer payée » s'en sort par un repli | chantier paiements |
| `check:db-coherence` : 3 fonctions QuickBooks non exécutables par `authenticated` | sortie du script | chantier QuickBooks |
| Préréglage `estimate_followup` sur `estimate.sent` : événement jamais émis | audit V2 | à trancher |
| Cron des **relances de paiement** : l'appel dépasse les 5 s de `pg_net`, sa réponse est perdue ; et `reminder_log` est vide depuis 10 jours alors que 22 factures sont en retard et 3 bureaux ont des relances réglées. Peut être normal (relances coupées, données de test, relance prise par une automatisation) : **pas vérifié** | `net._http_response` (2026-10-01 13:00 UTC), `reminder_log` | chantier paiements |
| `pg_net` ne garde ses réponses qu'environ 6 h : un cron qui échoue la nuit ne laisse aucune trace le matin | plus vieille réponse à 07:50 UTC le 2026-10-01 | surveillance à prévoir |

## Parité GHL (phase 2)

En attente de `docs/audits/AUDIT_GHL_WORKFLOWS.md` (absent au 2026-09-29). Rien de lancé : les vagues de parité attendent ton OK.

## Faux positifs et constats écartés

| Constat | Verdict |
|---|---|
| F3 — anti-doublon cassé (quarantaine) | **faux** : corrigé par #698 ; le banc ne simulait pas l'index unique |
| F18 — `config.to` honoré | **faux** : déjà ignoré |
| `modele_id` d'un autre bureau | **faux** : écrit par le serveur seulement |
| Routes `/events/*`, DELETE… sans RBAC | **faux** : `rbacMiddleware` exige `automations.update` |
| F11 — plafond de textos obligatoire | **écarté par décision** (2026-09-23) — revu en étalement (vague 3) |
| Relances de paiement envoyées 2 fois par le cron de staging | **faux** : idempotentes (`reminder_log` UNIQUE + verrou) ; le vrai défaut est le cron qui appelle la prod (#764) |
| L-7 réparable dans l'éditeur | la règle §6.3 interdit toute suppression dans l'éditeur : corrigé côté serveur (#771) |
| C20 à corriger dans la vague 2 | **déjà fait** ailleurs (20261002900000), vérifié en prod et staging |
| « Demander un avis » doit lire le texte de l'action | **remplacé** par la décision de #780 (champ retiré, 0 étape réelle n'en portait un) |
