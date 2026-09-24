# Spec GHL complète — tout ce que Rafba a demandé

Relevé des captures + textes fournis le 2026-09-24. C'est le cahier des charges
de la refonte. Rien ne doit se perdre entre deux sessions.

---

## 1. Menu « Créer » — 5 options

Au clic sur **+ Créer**, un menu déroulant, chacune menant à un parcours différent :

| GHL | Lume | Ce que ça fait |
|---|---|---|
| Start from Scratch | **Partir de zéro** | Crée un brouillon vide → ouvre le builder |
| Build Using AI | **Construire avec Lumi** | Ouvre le builder avec le champ de description au centre, focus dedans |
| Select from Template | **Partir d'un modèle** | Galerie des 35 préréglages, filtrable par catégorie → duplique et ouvre |
| Import from a campaign | **Importer d'une campagne** | (v2 — pas de campagnes dans Lume) |
| Company based workflow | **Automatisation d'entreprise** | Déclenchée par l'entreprise, pas par un client (ex. brief du matin) |

---

## 2. Panneau « Ajouter un déclencheur » (capture 3)

**S'ouvre en tiroir latéral DROIT**, pas en modale centrée. Largeur ~520 px,
pleine hauteur, avec :

- En-tête : titre `Add trigger` + ⤢ (agrandir) + ✕ (fermer)
- **Champ de recherche** en haut, avec une icône « grille » à gauche
- **Deux onglets** : `⚒ Triggers` | `📦 Apps`
- Sections repliables :
  - **Recent triggers** (les derniers utilisés)
  - **Contact** : Birthday reminder, Contact changed, Contact created, Contact DND, Contact tag, Custom date reminder, Note added, Note changed, Task added…
- Chaque ligne : icône + libellé + chevron `›` (ouvre la configuration)

**Pour Lume** : mêmes mécaniques, mais avec NOS 16 déclencheurs groupés par
famille (Soumissions, Factures, Rendez-vous, Jobs, Clients, Pipeline).
L'onglet « Apps » n'a pas lieu d'être en v1 (pas de marketplace).

---

## 3. Réglages globaux (`/automations/reglages`)

- **Forfaits Workflow Pro** — upsell, visible aux admins d'agence. → **On saute** (pas d'agences dans Lume)
- **Constructeur par défaut** : Standard / Avancé + qui peut basculer → **On saute** (un seul builder, décision assumée)
- **Notifications** : courriel d'erreur aux admins + adresses supplémentaires
- **Enregistrement auto** : interrupteur (sauvegarde en temps réel du brouillon)
- **Mettre en pause** : plages de dates (max 15 jours, pas de chevauchement, 15 plages max) + choix des automatisations
- **IA** : interrupteur du constructeur IA

---

## 4. Vue d'ensemble (`/automations/apercu`)

- 3 tuiles : **Total**, **Publiées**, **Total déclenché**
- **Courbe des déclenchements — 7 dernières semaines** (avec période, total, croissance)
- **Résumé des erreurs** : « Aucune erreur — tout roule »
- **Analyse des déclencheurs** : filtre (type + valeur + plage de dates) →
  - **Tentatives** (contacts évalués)
  - **Correspondances** (contacts qui ont matché)
  - **Sans correspondance** (contacts rejetés)

---

## 5. Onglet « Réglages » d'une automatisation

### Contact
- **Réinscription** : un contact peut-il repasser dans le parcours ? (toujours vrai pour les déclencheurs RDV/facture)
- **Plusieurs opportunités** : chaque opportunité fait son propre parcours
- **Arrêt sur réponse** : le contact sort dès qu'il répond

### Communication
- **Fuseau** : compte ou contact
- **Fenêtre d'envoi** : heures permises (déjà en dur 8h–20h côté moteur → à rendre configurable)
- **Expéditeur** : nom, courriel, numéro par défaut

### Conversations
- **Marquer comme lu** : les messages auto ne remontent pas en non-lus

---

## 6. Onglet « Historique » (inscriptions)

Colonnes : **Contact · Raison d'inscription · Date · Étape en cours · Statut · Prochaine exécution · Actions**
Filtres : plage de dates, type d'événement, contact.
Vide : « Aucune inscription ». Mention : disponible sur 60 jours.

---

## 7. Onglet « Journaux » (exécutions)

Colonnes : **Contact · Action · Statut · Exécuté le · Actions**
Filtres : plage de dates, toutes les actions, tous les statuts, contact.
Vide : « Aucun journal ». Mention : disponible sur 60 jours.

**Bonne nouvelle** : `automation_execution_logs` contient déjà tout
(action_type, result_success, result_error, duration_ms, created_at) et
`automation_scheduled_tasks` porte l'état des parcours en cours. Les données
existent, il manque l'écran.

---

## Ce qu'on NE fait PAS (et pourquoi)

| GHL | Raison |
|---|---|
| Workflow Pro upsell | Pas d'agences dans Lume |
| Standard / Advanced builder | Deux builders = complexité pour rien (relevé comme friction n°1) |
| Onglet « Apps » | Pas de marketplace en v1 |
| Import from campaign | Pas de campagnes dans Lume |

---

## Ordre de livraison

1. ✅ Page builder plein écran (barres, onglets, canevas, zoom, Brouillon/Publier)
2. Menu « Créer » à 5 options + galerie de modèles
3. Tiroir « Ajouter un déclencheur » (recherche + familles)
4. Onglets Historique et Journaux (données déjà là)
5. Onglet Réglages de l'automatisation
6. Vue d'ensemble + Réglages globaux

---

## 8. Menu « … » sur une carte (capture 4)

Au clic sur les `...` d'une carte d'action :
- **Copier l'action** / **Copier toutes les actions à partir d'ici**
- **Déplacer l'action** / **Déplacer toutes les actions à partir d'ici**
- **Supprimer l'action** / **Supprimer toutes les actions à partir d'ici**
- **Notes**

Sur une carte de DÉCLENCHEUR, le pied de carte porte directement :
⧉ (dupliquer) · 🗑 (supprimer) · **📊 Stats** (à droite)

Et la carte de déclencheur affiche ses filtres en clair, en dessous du titre :
« Event type is "Normal" », « Appointment status is "confirmed" ».

## 9. Bannière « Expliquer ce parcours »

Bandeau flottant au-dessus du canevas : ✨ **Explain this workflow** + bouton
**Explain** + ✕ pour fermer. → Lumi résume le parcours en français clair.

## 10. Rail d'outils gauche — les 8 icônes (identifiées)

De haut en bas, d'après les captures :
1. 💬 raccourcis clavier
2. ⚠️ **erreurs trouvées — cliquer pour résoudre** (pastille orange quand il y en a)
3. 📊 **vue statistiques** (perf par étape)
4. 📝 **notes collantes**
5. ↗ **changer de parcours** (workflow switcher)
6. 🔍 **chercher et remplacer**
7. 🕐 **historique des versions**
8. ✨ **Lumi** (IA)

## 11. Multi-déclencheurs

À côté du déclencheur existant : carte en pointillés **+ Add new trigger**.
Plusieurs déclencheurs convergent vers la MÊME séquence.

---

## ⚠️ Consigne DB (Rafba, 2026-09-24)

**Lire le code et le schéma réel AVANT toute écriture en base.** Ne jamais
inventer une table ou une clé étrangère sans en avoir vérifié l'existence
(`supabase/SCHEMA_SNAPSHOT.md`, `npm run check:schema-refs`).

Rappel du piège maison : avec PostgREST, **une seule colonne inexistante fait
échouer TOUTE la requête**, et supabase-js ne lève jamais — la fonctionnalité
meurt en silence.
