# Plan d'attaque — Automatisations (mission V2, 2026-09-29)

Tiré de `AUDIT_AUTOMATISATIONS_V2.md` (même dossier). Chaque ligne est un défaut **prouvé** et revérifié avant d'entrer ici ; les faux positifs sont écartés en fin de document. Les vagues sont dans l'ordre du risque pour la prod : argent et sécurité, puis ce qui fait partir un faux message, puis ce qui en perd un, puis l'interface, puis le confort.

Légende effort : XS < 1 h · S ½ journée · M 1 jour · L plusieurs jours. Risque prod = risque que le **correctif** abîme quelque chose.

---

## Vague 0 — mettre en prod ce qui est prêt (toi : merges + migrations)

Rien de neuf à coder : les 5 PR du launch sont vertes. **Tant qu'elles ne sont pas mergées, tous les défauts du 28 sont encore en prod** (réconciliation : 120 tests des PR échouent sur `main`).

| Ordre | Action | Détail |
|---|---|---|
| 1 | `db:apply:prod` **20261003100000** (événements par la base) | déjà sur staging |
| 2 | **Nouveau** : montrer puis appliquer **20261003100010** (« Retirer de l'horaire » émet l'annulation, D-01) — staging puis prod | ajouté ce soir à #755 ; sans lui, les No-Show Follow-Up de Coquin lavage et Vision Lavage **meurent au merge** |
| 3 | Merger #753 → #755 → #756, et #752 → #757 | #756 contient #753 + #755 (avec D-01) |
| 4 | **Après déploiement** : `db:apply:prod` **20261003100100** (sécurité) | l'ancienne interface lit `api_key` : pas avant |
| 5 | `check:broken-objects`, `check:db-coherence`, `check:schema-refs -- --prod` | |

## Vague 1 — livrée ce soir (PR prêtes, à merger)

| PR | Contenu | Preuve | Migration |
|---|---|---|---|
| **#760** | Harnais : golden set des 38 préréglages **en CI** (1/77 → 77/77), mocks communs, quarantaine qui ne ment plus (65/195 → 91/118 verts) | mutation : un texte changé = 1 rouge | non |
| **#764** | **Stripe compté deux fois** (Critique, latent) ; `invoice.paid` sur acompte ; `execute-action` retirée (écriture inter-bureaux) ; cron de staging qui appelait la prod ; « Envoyer dans Slack » qui publiait dans NOTRE canal de support | banc staging avant/après ; 4 tests rouges sur main | **20261003100200** — ⚠️ poser `app_base_url` en prod AVANT |
| **#771** | Construire avec Lumi : L-1 à L-10 (tâches, « la veille », variables, refus expliqués, garde-fous, budget, double clic, brouillon vide) | 14/17 tests rouges sur la base ; 30 demandes rejouées sur le vrai modèle | non — **après #756/#757** |

## Vague 2 — moteur : ce qui envoie faux, en double, ou perd un message

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

## Vague 3 — conformité texto et courriel (**bloquante avant d'ouvrir Twilio**)

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

## Vague 4 — interface (éditeur et liste)

| id | Problème | Correction | Effort |
|---|---|---|---|
| A-01 Élevée | Supprimer la 1re étape rend la suite **orpheline**, enregistré en silence | la suite de la tête devient la tête | S |
| A-02 Élevée | « Ajouter » actif sur une règle d'ancien format (250/251 en prod) : le moteur abandonne le texte et la tâche d'origine | masquer, ou passer par la conversion | S |
| A-03 Élevée | Une règle **publiée** peut être rendue incompatible et reste publiée | la route PATCH rejoue les contrôles de publication sur l'état final | S |
| A-04 → A-09 Moyenne | Retour du navigateur perd le travail ; « Ajouter » au milieu ; texto vidé accepté ; « FR/EN » ment ; « Aucune erreur » quand les journaux sont illisibles ; erreurs serveur en français pour l'anglais | voir 11-interface | S chacun |
| A-10 → A-17 Faible | textes, libellés, tri des colonnes | voir 11-interface | XS-S |
| PERF-1/2 | La liste télécharge toutes les règles 2 fois ; l'éditeur charge 400 règles pour en montrer une | 1 seule lecture ; lecture par id | S |
| Tests | 13 tests `front-automations` écrits pour l'ancienne page (dont F22 : variable inconnue, nom brut) | les réécrire sur l'écran actuel | M |

## Vague 5 — performance et charge

| id | Problème | Correction | Effort |
|---|---|---|---|
| T6.2 | 21 à 40 requêtes par événement ; réglages de l'entreprise relus 6 fois | mémoïser par événement, regrouper les lectures | M |
| D-17 | Sous saturation : 8/144 écritures sans événement | **refaire la charge sur un environnement isolé** avant de conclure (staging était partagé) | M |
| Outbox prod | Aucun événement dans `domain_events` depuis le 28 à 22:14 (≈ 26 h) | vérifier si c'est normal (types consignés) ou une panne | XS |

## Ce qui t'attend (décisions, pas du code)

1. **Merges** vague 0 puis vague 1 (#760, #764, #771).
2. **Migrations à approuver** : 20261003100010 (D-01), 20261003100200 (cron) — et le secret `app_base_url` en prod avant la seconde.
3. **Railway** : `CRON_SECRET` de prod à changer (staging le partage) ; y a-t-il des crons pour `rappels-dates`, `recurring-invoices`, `webhook-retries` ?
4. **F11** : étalement des rafales, oui ou non ?
5. **Cache Haiku** de Lumi (< 4 096 tokens, rien n'est mis en cache) : accepter (0,49 ¢/génération) ou allonger le prompt ?
6. Le message Slack de test « [QA-V2-B] slack » publié dans notre canal de support : à supprimer.

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
