# Référence GHL — ce qu'on en garde pour Lume

Document de travail. La source est le prompt de référence fourni par Oli le
2026-09-24 (catalogue GHL avec niveaux de fiabilité), croisé avec le
dépouillement de leur documentation déjà fait.

**La règle de lecture** : `[VÉRIFIÉ API]` et `[DOC OFFICIELLE]` sont des
faits. `[SOURCE SECONDAIRE]` demande une vérification avant d'en faire une
décision produit. `[À VÉRIFIER]` ne sert à rien tant que personne ne l'a
regardé dans une vraie UI.

---

## 1. Ce que ce document change pour Lume

Trois apports que le simple catalogue n'avait pas.

### 1.1 Les pièges valent plus que la liste

Un déclencheur mal posé ne plante pas : il envoie deux fois, ou jamais. Les
pièges recensés chez eux sont exactement ceux qu'on doit rendre IMPOSSIBLES,
pas documenter :

| Piège chez GHL | Ce que Lume doit faire |
|---|---|
| `Contact Created` enrôle 2 000 contacts sur un import | Ne pas offrir ce déclencheur sans filtre de source |
| `Customer Booked Appointment` ignore les RDV créés par le staff | Un seul déclencheur « rendez-vous planifié », quelle que soit l'origine |
| Ré-enrôlement OFF par défaut, cause n°1 des doubles envois | Déjà réglé : `reentree` est un réglage explicite par règle |
| Boucle `Contact Changed` → `Update Contact Field` → `Contact Changed` | Le moteur doit refuser qu'une action re-déclenche sa propre règle |
| Workflow en Draft = rien ne part, sans le dire | Déjà réglé : l'interrupteur Brouillon/Publiée est visible en tête |
| Scheduler « contactless » : les actions client sont ignorées EN SILENCE | Ne pas offrir de déclencheur sans entité tant que le moteur ne sait pas le dire |

### 1.2 La validation AVANT publication

L'audit du 23 septembre sur leur propre compte a trouvé **5 erreurs
bloquantes** dans un workflow publiable : action sans pipeline, segment non
résolu, token placeholder, condition indéfinie.

C'est le vrai enseignement : **leur builder laisse publier un workflow cassé.**
Lume doit refuser, ou au minimum signaler, avant publication :

- expéditeur configuré (nom + adresse) — leur workflow avait
  `bookings@youragency.com` et des champs From vides ;
- opt-out SMS présent ;
- ré-enrôlement décidé explicitement ;
- fenêtre d'envoi définie ;
- aucune référence non résolue (pipeline, étape, membre supprimé).

**État dans Lume** : les champs obligatoires sont déjà vérifiés à
l'enregistrement (`validation.ts`), la fenêtre d'envoi a un défaut sain
(8 h – 20 h) et le consentement est vérifié à l'exécution (F7). Reste à
écrire une vérification de PUBLICATION qui relit tout le parcours.

### 1.3 Le coût à l'usage

GHL facture SMS, appels, courriels et IA au-delà de l'abonnement
(Agency Wallet). Ordres de grandeur cités, tous `[À VÉRIFIER]` :
SMS ~0,008 $ US/segment, appel sortant ~0,014 $/min, courriel ~0,675 $/1 000.

Pour Lume : un SMS long part en plusieurs segments (160 caractères, moins en
Unicode). Le catalogue borne déjà les textos à 1 600 caractères — soit jusqu'à
10 segments. **À décider** : afficher le nombre de segments dans le panneau,
comme un compteur de coût.

---

## 2. Les déclencheurs, triés pour une entreprise de services

La table de correspondance métier du document est la plus utile. Croisée avec
ce que Lume émet vraiment :

| Besoin métier | Chez GHL | Dans Lume aujourd'hui |
|---|---|---|
| Répondre à un nouveau lead | `Form Submitted` | ✅ `lead.created` |
| Rappel de rendez-vous | `Appointment Status` + Wait | ✅ `appointment.created` (délai négatif) |
| Relance no-show | `Appointment Status = noshow` | ❌ le statut n'est pas émis |
| Missed-call text-back | `Call Details` | ❌ pas de téléphonie entrante |
| Suivi de devis | `Estimates (sent)` | ✅ `quote.sent` |
| Deal gagné / perdu | `Opportunity Status Changed` | ⚠️ déclaré, jamais émis |
| Le client a payé | `Payment Received` | ✅ `invoice.paid` |
| Anniversaire client | `Birthday Reminder` | ❌ |
| Échéance custom | `Custom Date Reminder` | ❌ |
| Réponse à un message | `Customer Replied` | ❌ — **le plus demandé** |
| Nouvel avis | `New Review Received` | ❌ |
| Étiquette posée (handoff) | `Contact Tag` | ❌ |
| Tâche terminée | `Task Completed` | ❌ |
| Opportunité qui dort | `Stale Opportunities` | ⚠️ déclaré, jamais émis |

**Les six qui manquent vraiment** et qui ont un sens ici :
`Customer Replied`, `Contact Tag`, `Task Completed`, `Note Added`,
`Custom Date Reminder`, `New Review Received`.

Chacun demande que le SERVEUR émette un nouvel événement — c'est là qu'est le
travail, pas dans le catalogue.

---

## 3. Les actions : ce que le document confirme

### 3.1 Les 7 types de `Wait`

Lume n'en a qu'un : le délai fixe. Leurs sept :

1. **Time delay** — ✅ livré
2. **Event/Appointment Time** — attendre jusqu'à l'heure du rendez-vous
3. **Overdue** — relancer si en retard
4. **Condition** — jusqu'à ce qu'une condition soit vraie
5. **Contact Reply** — jusqu'à ce que le client réponde
6. **Trigger Link Clicked** — jusqu'au clic
7. **Email Events** — jusqu'à ouverture ou clic

Le n° 5 (« attendre la réponse ») est le plus utile pour une relance : il rend
inutile la moitié des conditions. Il dépend du même événement que
`Customer Replied` — donc **un seul chantier serveur donne les deux**.

### 3.2 Ce qu'on ne fera pas, et pourquoi

- **`Go To`** : leur propre documentation se contredit sur son effet, et le
  risque de boucle infinie est cité dans le document. Le moteur de Lume refuse
  les cycles par conception.
- **`Split` (A/B)** : sans statistiques par branche, un test A/B ne dit rien.
- **`Custom Code`** : exécuter du JavaScript arbitraire côté serveur.
- **IVR, affiliés, cours, Shopify, memberships** : objets absents de Lume.

---

## 4. Conformité — le point qui prime sur le reste

Le document rappelle la Loi C-28 (LCAP) et les règles du CRTC. C'est déjà
traité dans Lume et ça doit le rester :

- **F7** : base légale vérifiée avant tout envoi commercial (consentement
  exprès ou relation d'affaires tacite), journal probant ;
- **désabonnement** fonctionnel et respecté (`isEmailUnsubscribed`) ;
- **plafond de fréquence** par destinataire sur 24 h ;
- **fenêtre 8 h – 20 h** appliquée aux trois points du moteur.

Aucun déclencheur ni action ajouté ne doit contourner ces quatre gardes.

---

## 5. Ordre de travail proposé

1. **Un événement, un déclencheur** — commencer par `Customer Replied`
   (message entrant), qui débloque aussi le `Wait` n° 5.
2. `Contact Tag` — le handoff manuel, le plus simple à émettre.
3. `Task Completed` et `Note Added`.
4. `Custom Date Reminder` — demande un planificateur quotidien.
5. Les types de `Wait` 2, 3 et 5.
6. La validation AVANT publication (§ 1.2).

Chaque étape : émettre l'événement, l'offrir au catalogue, le prouver par un
test qui échoue sans le code, le vérifier dans un vrai navigateur.
