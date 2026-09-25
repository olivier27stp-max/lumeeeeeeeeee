# Le catalogue complet des automatisations — GoHighLevel transposé dans Lume

**2026-09-24.** Sources : les 22 captures du panneau « Actions » de GoHighLevel
fournies par Rafba, plus le dépouillement de leur documentation (~92
déclencheurs et ~95 actions relevés avec leurs champs exacts).

Ce document répond à « je veux vraiment savoir tout tout tout les choix
d'automatisations possible ». Il liste **chaque action de GHL** et dit, pour
chacune : est-ce que ça existe dans Lume, est-ce que ça peut exister, ou
est-ce que ça n'a aucun sens ici.

---

## 1. La règle de tri

GoHighLevel est une plateforme de marketing d'agence. Lume est un CRM de
services. Une bonne moitié de leur catalogue se transpose ; le reste décrit
des objets que Lume n'a pas.

Trois verdicts :

- **LIVRÉ** — implémenté dans ce chantier.
- **PLUS TARD** — a du sens, mais demande une brique absente (appels sortants,
  WhatsApp, cours en ligne).
- **HORS SUJET** — décrit un objet propre à GHL (affiliés, memberships,
  audiences Facebook, IVR). L'implémenter donnerait un menu rempli d'options
  mortes : exactement le défaut qu'on reproche à GHL, où 95 actions noient
  les 15 qui servent.

---

## 2. Correspondance des objets

| GoHighLevel | Lume | Note vérifiée |
|---|---|---|
| Contact | `clients` | Un prospect EST un client (`status='lead'`). Il n'existe pas de table `leads`. |
| Opportunity | `deals` | `pipeline_id` + `stage_id`. |
| Appointment | `schedule_events` | Une visite, rattachée à un job. Pas de `client_id` direct. |
| Task | `tasks` | `status` limité à {open, done} par contrainte CHECK. |
| Note | `notes` | `entity_type` limité à {client, job, lead, invoice, payment, team_member}. |
| Tag | `client_tags` | Table de liaison (`client_id`, `tag`). La colonne `clients.tags` existe mais n'est utilisée nulle part. |
| User | `memberships` | Membre de l'organisation. |
| Invoice / Estimate | `invoices` / `quotes` | Déjà branchés au moteur. |

---

## 3. Le catalogue, section par section

### 3.1 Contact — 16 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| Create Contact | HORS SUJET | Aucune source de données : l'entité du déclencheur existe déjà. |
| Find Contact | HORS SUJET | Action à deux sorties (Found / Not Found). Le graphe de Lume est à sortie unique. |
| **Update Contact Field** | **LIVRÉ** | `modifier_client` — statut, source, valeur estimée. |
| **Add Contact Tag** | **LIVRÉ** | `ajouter_etiquette` |
| **Remove Contact Tag** | **LIVRÉ** | `retirer_etiquette`, avec l'option « toutes » de GHL. |
| **Assign To User** | **LIVRÉ** | `assigner_responsable` |
| **Remove Assigned User** | **LIVRÉ** | `assigner_responsable` avec « personne ». |
| DND Contact | PLUS TARD | Lume a `email_opt_out_at` et le consentement F7 ; un interrupteur par canal viendra avec. |
| **Add to Notes** | **LIVRÉ** | `ajouter_note` |
| **Add Task** | **LIVRÉ** (enrichi) | `create_task` + priorité, échéance relative, responsable. |
| Copy Contact To Sub-Account | HORS SUJET | Multi-comptes d'agence. |
| Delete Contact | HORS SUJET | Destructif depuis une automatisation. Refusé volontairement. |
| Modify Engagement Score | PLUS TARD | Lume n'a pas de score d'engagement. |
| Add / Remove Contact Follower | HORS SUJET | Notion propre à GHL. |
| Edit Conversation | PLUS TARD | Demande le statut lu/archivé exposé au moteur. |
| Email Verification | PLUS TARD | Service tiers. |

### 3.2 Communication — 19 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Send Email** | **LIVRÉ** (enrichi) | `send_email` + nom d'expéditeur, répondre-à, pré-en-tête. |
| **Send SMS** | **LIVRÉ** (existait) | `send_sms` |
| **Internal Notification** | **LIVRÉ** (enrichi) | `create_notification` + destinataire (moi / le responsable / un membre). |
| **Review Request** | **LIVRÉ** (existait) | `request_review` |
| **Slack Message** | **LIVRÉ** | `envoyer_slack` — la brique existe déjà (`server/lib/slack.ts`). |
| Call / Voicemail | PLUS TARD | Twilio Voice n'est pas branché (SMS seulement). |
| Manual SMS / Manual Call | PLUS TARD | Demande une file d'actions manuelles. |
| Messenger, Instagram DM, WhatsApp, GMB, TikTok, RCS, Live Chat | HORS SUJET | Aucun de ces canaux n'est connecté à Lume. |
| Conversation AI | PLUS TARD | Lumi existe, mais l'exposer en action demande son propre garde-fou de budget. |
| Facebook / Instagram Interactive Messenger, Reply in Comments | HORS SUJET | Réseaux sociaux non connectés. |

### 3.3 Outils internes — 13 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Wait** | **LIVRÉ** (existait) | Étape `attendre`. GHL en a 8 variantes ; Lume garde la durée fixe, qui couvre le besoin réel. |
| **If / Else** | **LIVRÉ** (existait) | Étape `si`. |
| **Add to Workflow** | **LIVRÉ** | `demarrer_automatisation` |
| **Remove from Workflow** | **LIVRÉ** | `arreter_automatisation` (courant / un autre / tous). |
| Goal Event | PLUS TARD | Demande d'écouter un second événement pendant qu'un parcours court. |
| Split | PLUS TARD | Test A/B — sans valeur tant qu'il n'y a pas de statistiques par branche. |
| Go To | HORS SUJET | Un saut arbitraire crée des boucles ; `problemesDuGraphe` les refuse par conception. |
| Drip | PLUS TARD | Étalement d'envois en masse. |
| Text / Date / Number / Array Formatter, Math | HORS SUJET | Outils de bricolage nés de l'absence de vraies variables. Lume a `resolveTemplate`. |
| Update Custom Values | PARTIEL | Couvert par `modifier_client` pour les champs qui comptent. |
| Custom Code | HORS SUJET | Exécuter du JavaScript arbitraire côté serveur. Jamais. |
| Set Event Start Date | PLUS TARD | Déplacer un rendez-vous par automatisation. |

### 3.4 Rendez-vous — 2 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Update Appointment Status** | **LIVRÉ** | `modifier_statut_rendezvous` |
| Generate One Time Booking Link | PLUS TARD | Lume a les pages publiques par jeton ; à brancher. |

### 3.5 Opportunités — 9 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Create/Update Opportunity** | **LIVRÉ** | `modifier_deal` (source, valeur estimée). |
| **Add Owner to Opportunity** | **LIVRÉ** | `assigner_deal` |
| **Remove Owner** | **LIVRÉ** | `assigner_deal` avec « personne ». |
| (déjà présent) | **LIVRÉ** (existait) | `move_deal_stage` |
| Find Opportunity | HORS SUJET | Deux sorties. |
| Remove Opportunity | HORS SUJET | Destructif. |
| Add / Remove Followers | HORS SUJET | Notion propre à GHL. |

### 3.6 Paiements — 4 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Send Invoice** | **LIVRÉ** | `envoyer_facture` |
| **Send Estimate** | **LIVRÉ** | `envoyer_soumission` |
| Stripe One-Time Charge | PLUS TARD | Débiter une carte sans clic humain demande un mandat écrit. |
| Send Recurring Invoice | PLUS TARD | La facturation récurrente a déjà son propre planificateur. |

### 3.7 Envoi de données — 3 actions chez GHL

| GHL | Verdict | Action Lume |
|---|---|---|
| **Webhook (Outbound)** | **LIVRÉ** | `webhook` — POST JSON vers une URL externe (https obligatoire, anti-SSRF). |
| Custom Webhook | HORS SUJET | Variante payante de la même chose. |
| Google Sheets | PLUS TARD | Demande OAuth Google. |

### 3.8 Marketing, Affiliés, Membership, Certificats, IVR, Communities, Ecommerce, AI

**HORS SUJET en bloc** — environ 45 actions. Google Analytics, Google Ads,
audiences Facebook, Meta CAPI, gestionnaire d'affiliés, campagnes
d'affiliation, cours, badges, certificats, IVR (5 actions), groupes
communautaires, Shopify, et les 12 actions AI de GHL.

Ce sont les objets d'une plateforme d'agence marketing. Un paysagiste de
Drummondville n'en utilisera aucun, et les afficher grisés est précisément ce
qui rend leur menu illisible.

### 3.9 Eliza

**Écarté**, comme demandé.

---

## 4. Ce que ça donne

**18 actions offertes** (5 avant) :

| Famille | Actions |
|---|---|
| Communication | Envoyer un courriel · Envoyer un texto · Me notifier · Demander un avis · Envoyer dans Slack |
| Client | Ajouter une étiquette · Retirer une étiquette · Modifier le client · Assigner un responsable · Ajouter une note |
| Travail | Créer une tâche · Modifier le statut d'un rendez-vous |
| Ventes | Modifier l'opportunité · Assigner l'opportunité · Déplacer d'étape |
| Argent | Envoyer la facture · Envoyer la soumission |
| Technique | Webhook · Démarrer une automatisation · Arrêter une automatisation |

Plus les trois étapes de logique déjà présentes : attendre, si/sinon, arrêter.

---

## 5. Le panneau d'édition

C'est l'autre moitié du chantier, et la vraie plainte : cliquer une carte
n'ouvrait rien. Le panneau reproduit celui de la capture GHL :

- deux onglets **Modifier l'action** | **Statistiques** ;
- **Nom de l'action** (obligatoire) — ce qui s'affiche sur la carte ;
- les champs propres à l'action, tirés du catalogue ;
- le pied **Supprimer · Annuler · Enregistrer**.

Un champ n'existe dans le panneau que si le serveur sait l'exécuter. Pas de
champ décoratif : c'est la règle qui empêche un menu de promettre ce que le
moteur ne fait pas.

---

## 6. Les différences assumées avec GHL

Elles sont délibérées, pas des manques :

1. **Pas d'action à deux sorties** (`Find Contact`, `Find Opportunity`). Le
   graphe est à sortie unique ; `si` couvre le besoin de bifurquer.
2. **Pas de `Go To`.** Il crée des boucles, que le moteur refuse par
   conception — c'est la protection qui empêche un parcours d'envoyer des
   messages sans fin.
3. **Pas de formateurs de texte, de date ni de nombre.** Ce sont des
   pansements sur l'absence de variables ; Lume a `resolveTemplate`.
4. **Pas de destinataire libre.** Aucune action n'accepte une adresse ou un
   numéro écrit dans la règle (`DESTINATAIRE_IMPOSE`) : c'était un chemin
   d'exfiltration des données client.
5. **Pas de suppression ni de débit.** Supprimer un contact ou charger une
   carte sans clic humain n'a pas sa place dans une automatisation.
