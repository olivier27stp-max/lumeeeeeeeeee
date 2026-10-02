# Registre des constats — mission « correction finale Automatisations »

Un constat = une ligne. Détail et preuve dans `notes/<X>-constats.md` (agents) ou dans les triages de fd
(`D:/lume-uiaudit/sorties/triage/*.md`). Statut : OUVERT · EN COURS (agent) · CORRIGÉ (commit) · VÉRIFIÉ (par qui) ·
DÉCISION (attend Rafba) · ÉCARTÉ (pourquoi).

| Id | Point | Gravité | En une ligne | Zone de fichiers | Statut |
|---|---|---|---|---|---|
| P1-1 | 1 | bloquant | Deux copies du message (`steps` et `actions`) : Lumi écrit `steps`, des écrans lisent `actions` (« À compléter ») ; 36 parcours divergents en prod | à préciser par A | OUVERT (enquête A) |
| DEP-1 | 3 | majeur | « Automatise mes rappels » : Lumi installe un pack au lieu de poser UNE question (recul depuis #875, test I-022) | description des outils de modèles (a1, commit cdadacf9, branche qa/lumi-preuve-ecriture) | CORRIGÉ par a1, EN PROD depuis 00:59 UTC le 2 oct. (#896, 73aca4c7) — vérifié en local avant fusion (I-022, I-021, I-002 verts, vrai modèle) |
| DEP-2 | — | mineur | Tests I-003 / I-019 : Lumi passe par `create_automation_from_template` — attente à élargir | tests/automations-suite | OUVERT |
| F-01 | P4 | majeur | Le panneau « Construire avec Lumi » ne laisse aucune trace dans `lumi_traces` | routes/automation-rules.ts (/generer), generer-parcours.ts | OUVERT |
| F-02 | P4 | majeur | Créer par le clavardage : la génération imbriquée (jusqu'à 78 % du coût) échappe à la trace et aux plafonds | tools-reglages.ts, generer-parcours.ts | OUVERT |
| F-03 | 1 / 18 | bloquant | Le panneau ne peut pas modifier les deux gros parcours du pack de base (parcours coupé à 6 000 caractères) : 422, et 3,4 à 3,6 ¢ débités | generer-parcours.ts | OUVERT |
| F-04 | P4 | mineur | Une génération refusée par la validation est débitée | generer-parcours.ts | DÉCISION |
| F-05 | P4 | majeur | Ni réflexion ni effort fixés sur la génération : même demande de 1,07 à 2,79 ¢ (effort bas : −21 % de coût, −28 % de latence, qualité égale sur 16 essais) | generer-parcours.ts | OUVERT |
| F-06 | P4 | majeur | La génération n'entre dans aucun plafond journalier de plateforme | generer-parcours.ts, plafond-journalier.ts | OUVERT |
| F-07 | P4 | mineur | Une question fait réécrire tout le parcours (1,32 → 0,52 ¢ si on ne réécrit pas) | generer-parcours.ts | OUVERT |
| F-08 | P4 | mineur | À zéro crédit, l'éditeur dit « budget du mois », sans date, après le clic | ClavardageLumi.tsx, routes | OUVERT |
| F-09 | P4 | mineur | À zéro crédit, chaque message paie encore le routeur (0,156 ¢) | orchestrateur (f1 libre) | OUVERT |
| F-10 | P4 | majeur | Le blocage à zéro du panneau ne tient qu'à `reserve_ai_budget` — non vérifié en prod | à vérifier (lecture seule) | OUVERT |
| F-11 | P4 | mineur | Routeur appelé à chaque message d'automatisation (−0,156 ¢ et −1,1 à −1,7 s si on le saute) | orchestrateur / routeur | OUVERT |
| F-12 | P4 | mineur | Un appel au modèle juste pour retrouver l'automatisation par son nom (−0,45 ¢ par modification) | tools-reglages.ts | OUVERT |
| F-13 | P4 | mineur | Routeur hésitant : le jeu d'outils change, le tour coûte le double | routeur | OUVERT |
| F-14 | 1 / 3 | majeur | Clavardage : « ajoute un délai » ou un filtre crée un DOUBLON sans le filtre, puis l'active pour tous les clients | tools-reglages.ts (outil de modification de structure manquant) | OUVERT |
| F-15 | 3 | majeur | Clavardage : « explique-moi » ne voit pas les étapes et affiche `quote.sent` | tools-etendus.ts (list / lecture d'une automatisation) | OUVERT |
| F-16 | 3 | mineur | Reçu « C'est fait : l'action. » | libellés des cartes (a1) | OUVERT |
| F-17 | 16 | mineur | Textos écrits par le clavardage hors des règles de rédaction (émoji, pas d'ouverture) | consignes | OUVERT |
| F-18 | 6 | mineur | Le panneau refuse le filtre par étiquette que l'éditeur offre | generer-parcours.ts | OUVERT |
| U-* | P7 | 7 majeurs, 19 mineurs, 1 cosm. | 27 défauts de l'éditeur (triage fd « actions ») | zone de l'agent U | EN COURS (agent U) |

| B-01 | 9 | majeur | Le rappel de rendez-vous part pour un job annulé | moteur (revalidation) | OUVERT |
| B-02 | 9 | majeur | Un rendez-vous déplacé garde ses rappels à l'ancienne date ; « c'est demain » peut partir après la visite | moteur | OUVERT |
| B-03 | 13 | majeur | Facture, job ou opportunité à la corbeille : le message part quand même | moteur (revalidation) | OUVERT |
| B-04 | 6 / 9 | majeur | Conditions et étiquettes jugées seulement à l'événement, jamais avant l'envoi différé | moteur | OUVERT |
| B-05 | 5 / 9 | majeur | Arrêt sans raison lisible : motif générique, aucune ligne au journal (16 cas dans de vrais bureaux, 334 sans motif) | moteur, journaux | OUVERT |
| B-06 | 10 | majeur | Activer « Opportunité qui dort » écrit d'un coup aux opportunités déjà dormantes | moteur / pipeline | OUVERT |
| B-07 | 10 | majeur — DÉCISION | Activer « Client inactif » relance tout de suite les clients déjà inactifs | client-inactif.ts | OUVERT |
| B-08 | 11 | majeur | Courriel « en retard » à 1 h du matin pour une règle à plat ; relances de paiement à heure UTC fixe | moteur, reminders-cron.ts | OUVERT |
| B-09 | 11 | mineur | Le report « hors heures d'envoi » n'est pas journalisé | moteur | OUVERT |
| B-10 | 14 | majeur | Étalement réel : 30 textos par tick de 5 min (le 300e part après 45 min) ; la notification annonce « 30 par minute » | moteur, scheduler | OUVERT |
| B-11 | 14 | mineur | Courriels non régulés (pointe de 32 par seconde en local) | moteur | OUVERT |
| B-12 | 15 | majeur | Modifier une automatisation active : mélange des deux versions, délai inchangé, client éjecté si l'étape est remplacée | moteur, séquences | OUVERT |
| B-13 | 2 | majeur | Un redémarrage pendant une action immédiate la perd pour toujours (1 à 2 sur 12) | moteur | OUVERT |
| B-14 | 2 | majeur | « Note ajoutée » et « Tâche terminée » ne partent pas depuis Lumi ni depuis tous les écrans | routes / outils | OUVERT |
| B-15 | 13 | majeur (latent) | Drapeau de désabonnement par canal allumé : texto de rappel envoyé à un client supprimé | actions | OUVERT |
| B-16 | 13 | mineur | Fusion de fiches : la relance est annulée avec « le client a été supprimé » | moteur | OUVERT |
| B-17 | 18 | manque | Un seul déclencheur par automatisation (le champ `triggers` est ignoré par la route) | routes, moteur, éditeur | OUVERT |
| B-18 | 2 | majeur | « Date atteinte » : un balayage manqué n'est jamais rattrapé (pg_cron a raté 49 démarrages en 7 jours) | rappels-dates.ts | OUVERT |
| B-19 | 2 | mineur | Le tick n'est surveillé par rien ; un tick de plus de 8 min observé (bail de 10 min) | scheduler | OUVERT |
| B-20 | P6 | mineur | L'ancien modèle (table `automations`, colonne `is_recurring`) est encore lu à chaque tick, 0 ligne en prod — code à retirer (liste dans B-carte) | scheduler.ts | OUVERT |
| B-21 | — | mineur | Le filet de la suite devient aveugle au-delà de 1 000 envois simulés | harnais | OUVERT |
| B-22..24 | — | non vérifiés | Limite de 500 factures sans ordre dans le cron des relances ; `lead.created` absent du porte-à-porte ; « qui dort » alerte une seule fois par étape | divers | OUVERT |
| E-03 | 6 | majeur | Pas de OU ; une seule étiquette « a » et une seule « n'a pas », reliées par ET | ciblage (conception E) | OUVERT |
| E-04 | 6 | majeur | Impossible de filtrer une automatisation de facture, devis ou rendez-vous sur un champ de la fiche client (règle muette) ; « type de client » n'existe pas comme colonne | ciblage | OUVERT |
| E-05 | 6 / 9 | majeur | Le ciblage n'est jugé qu'au déclenchement : un client exclu pendant l'attente reçoit quand même le message différé | moteur (même endroit que B-04) | OUVERT |
| E-06 | 6 | majeur | « Démarrer une automatisation » ignore les conditions de l'automatisation démarrée | moteur | OUVERT |
| E-07 | 5 / 6 | mineur | Le journal dit « Conditions non remplies : étiquette du client », pas « ignoré : hors ciblage » | moteur, journaux | OUVERT |
| E-08 | 6 | majeur | Aucun compteur « Touche X clients » ni aperçu (sauf « Client inactif ») | éditeur, route d'aperçu | OUVERT |
| E-11 | 6 / 12 | majeur — DÉCISION | Drapeau « désabonnement par canal » allumé : le transactionnel part quand même à un désabonné (le test G-011 l'affirme comme voulu) | actions | DÉCISION |
| E-17 | 6 | majeur | « noreview » respecté par « Demander un avis », mais pas par un texto ou courriel de demande d'avis écrit à la main | actions | OUVERT |
| E-20 | 7 | majeur | Deux automatisations identiques envoient deux fois | garde d'envoi (conception E) | OUVERT |
| E-22 | 7 | majeur | Deux messages reformulés partent tous les deux | garde d'envoi | OUVERT |
| E-27 | 7 | majeur | Deux automatisations identiques différées, deux consommateurs en parallèle : deux envois | garde d'envoi | OUVERT |
| E-28 | 7 | majeur | Publier un doublon n'affiche aucun avertissement (hors « Construire avec Lumi », premier tour) | publication, éditeur | OUVERT |
| E-29 | 7 | mineur | L'avertissement de doublon de Lumi ne lit pas le ciblage (fausses alertes) | deja-publiees.ts | OUVERT |
| E-66 | 7 | mineur | Le plafond de 3 messages par 24 h compte le 4e comme un échec, écrit en anglais | actions, journaux | OUVERT |
| E-30 | 8 | majeur | « Insérer un champ » : les boutons visibles sous « Champs de base » repliée sont les champs PERSONNALISÉS, sans titre ; les 90 vrais champs de base sont cachés dans la ligne repliée | palette (conception E) | OUVERT |
| E-31 | 8 | majeur | La liste est la même pour tous les déclencheurs (« Nouveau prospect » propose 70 variables qui partiront vides) | palette | OUVERT |
| E-32 | 8 | majeur | Il manque le solde dû, les jours de retard, le courriel de l'entreprise, le technicien | variables (moteur + catalogue) | OUVERT |
| E-33 | 8 | majeur | La palette offre les notes internes de la facture, les codes et instructions d'accès, et 12 cases à cocher | palette | OUVERT |
| E-35 | 8 | mineur | La variable s'insère à la fin, pas au curseur ; pas de recherche ; trois palettes différentes dans l'app | palette | OUVERT (en partie dans le lot U) |
| E-36 | 8 | majeur | Une variable inconnue n'est qu'un avertissement incomplet ; le serveur accepte | validation, publication | OUVERT |
| E-37 | 8 | majeur | Sur « Rendez-vous planifié », les 100 champs proposés sont tous vides à l'envoi | variables (moteur) | OUVERT |
| E-44 | 8 | majeur | Aucune valeur de remplacement : « {prénom|là} » part tel quel | resolveTemplate | OUVERT |
| E-47 | 8 | mineur | Une variable sans valeur pour le déclencheur n'est pas signalée | palette, validation | OUVERT |
| E-52 | 16 | DÉCISION | La langue est celle de l'entreprise ; aucune préférence de langue par client n'existe | modèle de données | DÉCISION |
| E-61 | 16 | majeur | Le compteur de SMS compte le gabarit, pas le texto envoyé (mention STOP ajoutée → 2 SMS non annoncés) | MessageEditor, smsSegments | OUVERT |
| E-64 | 16 | mineur | Réglages → Messagerie et Avis clients n'ont pas de compteur de SMS | SettingsMessaging | OUVERT |
| E-70 | 8 | cosmétique | « Client · Petit » : champ créé à la main dans le bureau de Rafba (non vérifié en prod) | — | VÉRIFIÉ : champ texte « Petit » créé par un utilisateur dans Coquin lavage le 2026-09-28 (lecture seule) — rien à corriger, la nouvelle palette le rangera sous « Champs personnalisés » |
| E-71 | 8 | mineur | Lumi écrit « Solde : [invoice_total] » (le solde n'existe pas comme variable) | variables, consignes | OUVERT |
| D-01 | 4 | majeur | Vue d'ensemble : au-delà de 1 000 exécutions, total bloqué à 1000 et semaines récentes à 0 (déjà faux en prod pour un bureau à 2 961 lignes) | stats (agent S) | OUVERT |
| D-02 | 4 | majeur | Au-delà de 200 échecs en 7 j : pastilles fausses, règles absentes de « À vérifier » | stats | OUVERT |
| D-03 | 4 / 7 | majeur | Plafond de fréquence compté et affiché comme un échec, avec le numéro du client dans le motif | moteur (M, code `plafond_frequence`) + écrans | EN COURS (M) — décidé : ignoré, le parcours continue |
| D-04 | 4 / 7 | majeur | Doublon écarté : aucune trace en base | moteur (garde d'envoi) | OUVERT |
| D-05 | 5 / 11 | mineur | Envoi reporté hors heures d'envoi : « En attente » sans raison | moteur (M, code `hors_heures`) + écrans | EN COURS (M) |
| D-06 | 4 | mineur | « Total déclenché » = fiches distinctes, pas des déclenchements | stats | OUVERT |
| D-07 | 5 | majeur — DÉCISION | File planifiée, bac à sable, outbox : ni durée ni purge (237 tâches closes de plus de 90 j en prod) — le correctif SUPPRIME des données de vrais bureaux | migration | DÉCISION |
| D-08 | 5 | majeur | Effacer un client laisse son numéro, son adresse et le texte reçu dans les journaux (Loi 25) | fonction `anonymize_client` (migration) | OUVERT — à faire relire |
| D-09 | 4 | majeur | Deux définitions de « déclenchement » entre Vue d'ensemble et liste (20 contre 24) | stats | OUVERT |
| D-10 | 5 | majeur | Le filtre « Réussis » montre les envois sautés ; pas de filtre « Sautés » | journaux | OUVERT |
| D-11 | 5 | mineur | Détail d'un échec : « exécution antérieure au journal détaillé » (faux), message non montré | journaux | OUVERT |
| D-12 | 5 | majeur | Interface anglaise : raisons de saut, d'annulation et de report en français | écrans (catalogue des motifs) | OUVERT |
| D-13 | 5 | majeur | Ni recherche, ni filtre client ou date ; aucun journal à l'échelle du bureau | journaux | OUVERT |
| D-14 | 5 | mineur | Aucun lien vers le client, la facture ou le job | journaux | OUVERT |
| D-15 | 5 | majeur | Journaux et Historique coupés à 200 lignes sans le dire | journaux | OUVERT |
| D-16 | 5 | majeur | Historique vide pour toute automatisation immédiate : c'est la file d'attente, pas un historique | journaux | OUVERT |
| D-17 | 4 | majeur | Lecture des échecs en panne : « À vérifier (0) » sans avertissement | liste | OUVERT |
| D-18 | 4 | mineur | Aucun chiffre ne bouge sans recharger la page | liste, vue d'ensemble | OUVERT |
| D-19 | 5 | mineur | Heures affichées en fuseau de Montréal en dur | écrans | OUVERT |
| D-20 | 5 | majeur | Aucun historique des modifications (ni table, ni écran) | migration additive + routes + écran | OUVERT |
| D-21 | 4 | mineur | Lumi compte les règles écartées parmi les « sautés » (10 contre 7 à l'écran) | tools-etendus.ts (get_automation_health) | OUVERT |
| D-22 | 5 | mineur | « Étape supprimée du parcours » affichée « l'automatisation a été supprimée » | écrans | OUVERT |
| D-23 | 4 | mineur | « envoi(s) » pour toute action, même une notification interne | stats | OUVERT |
| D-24 | 4 | majeur | Aucun choix de période | stats | OUVERT |
| D-25 | 4 | majeur | Ignorées sans détail par raison | stats | OUVERT |
| D-26 | 5 | mineur | Journaux sans le détail technique attendu (événement, valeurs des conditions, durée) | journaux | OUVERT |
| D-27 | 5 | cosmétique | 60 j affichés contre 90 j gardés | stats | OUVERT — décidé : afficher 90 jours |
| A-01 | 1 | bloquant | LE bug n° 1 : le panneau d'étape resté ouvert garde l'ancien texte après la réponse de Lumi ; son « Enregistrer » remet l'ancien texte par-dessus celui de Lumi (`PanneauEtape.tsx:192, 219-224` : le brouillon n'est rechargé que si l'identifiant de l'étape change) | PanneauEtape.tsx (U) | CORRIGÉ (2b27e032, branche u) — VÉRIFIÉ par le coordinateur : les 3 tests navigateur A-01 de l'enquête (le panneau montre le texte de Lumi ; « Enregistrer » ne l'écrase pas ; fermer ne demande rien) sont verts sur la branche de U, dans un arbre séparé |
| A-02 | 1 / P6 | majeur | Deux copies du message dans la même ligne (`steps`, `actions`) ; l'éditeur n'écrit que `steps` — aucun écran ne montre `actions` quand un parcours existe, mais des lecteurs serveur le font (A-07, A-11) | accès unique aux étapes (P6) | OUVERT |
| A-03 | 1 | bloquant | « Déjà fait » : 194 des 199 outils d'écriture rejouent un succès mémorisé 10 min sans relire l'état (activer, texte, langue, tâche) | tools-etendus.ts (`executerIdempotent`) (L) | OUVERT |
| A-04 | 1 | majeur | Le panneau « Construire avec Lumi » renomme l'automatisation sans qu'on le demande (3 sur 3) | generer-parcours.ts / route generer | OUVERT |
| A-05 | 1 | majeur | Après « Confirmer » : « C'est fait : l'action. » ; l'outil ne rend pas l'état relu ; texte montré ≠ texte enregistré (vu une fois) | tools-reglages.ts (L) + libellés des cartes (a1) | OUVERT |
| A-06 | 1 / 8 | bloquant | Le clavardage écrit des variables inexistantes (`{{lien_paiement}}`, `{{payment_link}}`) ; l'outil les enregistre, le client reçoit un message troué | tools-reglages.ts (L) | OUVERT |
| A-07 | 1 | mineur | `update_automation_message` laisse `actions` périmé dès qu'il y a deux messages | tools-reglages.ts | OUVERT |
| A-08 | 1 | mineur | Lumi réécrit une automatisation à la corbeille | tools-reglages.ts | OUVERT |
| A-09 | 3 | majeur | Éditeur ouvert et Lumi (ou deux onglets) s'écrasent en silence, aucune garde de version | route PATCH + éditeur (U) | OUVERT |
| A-10 | 3 | majeur | Le clavardage ne peut pas LIRE le contenu d'une automatisation | tools-etendus.ts (L) | OUVERT |
| A-11 | 3 | majeur | `execution.ts` ne lit que `actions` : pas de carte avant un texto déclenché par « job terminée » | server/lib/lumi/execution.ts (L) | OUVERT |
| A-12 | 3 | majeur | Réponses de moins de 10 caractères (« oui », « active-la ») non envoyables dans le panneau de l'éditeur | route generer + ClavardageLumi (L) | OUVERT |
| A-13 | 3 | majeur | Activation sans résumé (message exact, ciblage, nombre de clients) | carte de toggle (a1, #896 en prod) | CORRIGÉ par a1 — à vérifier au navigateur ; le nombre de clients touchés viendra avec le ciblage |
| A-14 | 1 / 3 | majeur | Couverture : 14 manques pour le panneau, 14 pour le clavardage ; aucun canal ne mène la chaîne de la mission au bout | outils de Lumi (L) | OUVERT |
| A-15 | 3 | majeur | Aucun contexte de page ; « relance » part vers les relances de paiement ; une automatisation nommée est dite introuvable sans outil appelé | orchestrateur, routes/lumi.ts, front du clavardage (L) | OUVERT |
| A-16 | 3 | mineur | Lumi se contredit dans l'éditeur (filtre par étiquette proposé puis refusé ; « j'ai changé… je n'ai rien changé ») | generer-parcours.ts | OUVERT |
| A-17 | 3 | mineur | Le panneau n'écrit rien dans `agent_actions` ; les actions d'automatisation y sont sans libellé ni nom | route generer / journal | OUVERT |
| A-18 | 16 | mineur | Textos de 166 et 262 caractères écrits par Lumi sans avertissement | consignes, generer-parcours | OUVERT |
| A-19 | — | mineur | Réglages › Messagerie ne liste ni « Facture en retard » ni les règles créées par Lumi | SettingsMessaging.tsx | OUVERT |
| A-20 | 8 | mineur | L'aperçu rend numéro et lien de facture vides | aperçu (éditeur / variables) | OUVERT |
| A-21 | 16 | majeur | Un courriel écrit par Lumi (texte brut) part en un seul bloc | rendu des courriels (moteur) | OUVERT |
| R-01 | P6 / P7 | majeur | Écriture directe (PostgREST) d'un déclencheur hors catalogue sur sa règle (50-soupcons-securite:208) | durcissement des écritures (moi, après U, L, T) | OUVERT |
| R-02 | P6 / P7 | majeur | Écriture directe du contenu : texto de 5 000 caractères accepté ; on peut VIDER le texto d'une règle publiée, qui reste publiée (50:235) | durcissement des écritures | OUVERT |
| R-03 | P6 / P7 | majeur | DELETE direct d'une adresse d'appel (`automation_webhooks`) par propriétaire, admin, éditeur ; les reçus partent en cascade (40-base-roles:153) | migration (garde) | OUVERT |
| R-04 | P6 / P7 | mineur | Insertion directe d'un brouillon sans le forfait Autopilot (55-forfait:129) | durcissement des écritures | OUVERT |
| R-05 | P7 | majeur | Un technicien SANS `clients.update` supprime et insère des `client_tags` en direct (table sans `org_id`) ; « Étiquette retirée » ne part pas (20-points-entree:476) | migration RLS `client_tags` | OUVERT |
| R-06 | P7 | à vérifier | `FEATURE_GUARD` vaut « log » par défaut : valeur de prod non vérifiée (S-03 serveur) | configuration Railway | À VÉRIFIER avec Rafba |
| R-* | P7 | 27 @defaut | Reste du lot « rôles » de fd (`D:/lume-uiaudit/sorties/triage/roles.md`) | routes, écrans | OUVERT |

## Optimisations de coût mesurées par F (à livrer seulement avec preuve de qualité)
1. Sauter le routeur pour le mot « automatisation » — 12/12 même sujet.
2. Effort bas sur la génération — 15/16 contre 14/16.
3. Repérer l'automatisation par le code au lieu de `list_automations` — qualité NON mesurée.
4. Ne pas réécrire le parcours pour une question ou un refus — 4/4.
5. Garder le sujet quand le routeur hésite — qualité NON mesurée.
6. Haiku pour structure et questions du panneau — 8/8, échantillon trop petit, à prouver sur `qa:construire-lumi`.
Écartées avec mesure : recherche d'outils généralisée, préfixe `automation_`, baisse de `max_tokens`.

## Anomalies d'atelier (réglées)
- Pile locale : `proposed/…down-reference.sql` rejoué par erreur → vraies fonctions de crédits réappliquées ; `pile.sh` exclut `/proposed/`.
- `env-local.mjs` : clé de chiffrement au mauvais format (l'API ne démarrait pas) → corrigé, `.env.local` régénérés.
- `serveurs.mjs` : sort tout de suite si l'API ou Vite meurt.
- `tests/automations-finale/**` est ramassé par `npm test` : à exclure de `vitest.config.ts` et à brancher dans `test:automations:all` au moment de l'intégration.

## Prouvé correct par B (à citer dans le rapport)
- Activer « Facture en retard » n'écrit à personne le jour même (point 10).
- Réponses par texto : bon bureau, STOP appliqué tout de suite (point 12).
- Changement d'heure du 1er novembre 2026 : juste (point 11).
- Tâches en attente ou en cours : survivent à un processus tué, sans doublon (point 2).
- Producteurs en marche en prod : tick de 5 min du serveur, boucle de 15 s des événements de base, 4 tâches pg_cron + pg_net ; 0 événement en attente, 0 tâche en retard.
- Impossibles dans le produit : une facture émise ne revient pas en brouillon, son échéance ne se modifie plus.
