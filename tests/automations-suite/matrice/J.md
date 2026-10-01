# Matrice J — Interface (page Automatisations, Playwright)

Projet vitest `ui` (`tests/automations-suite/ui/`) : vrai Chromium, API locale sans tâche de fond ni fournisseur (port 3071), Vite (5191), bureau A de test. Chaque geste est vérifié à l'écran ET dans `automation_rules` (service_role).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| J-001 | Liste | règle du bureau en base | la ligne affiche nom + « Brouillon » | 70-ui-liste |
| J-002 | Liste — chargement | requête des règles retenue | indicateur de chargement, jamais « Aucune automatisation » | 70-ui-liste |
| J-003 | Liste — vide | aucune règle | « Aucune automatisation » | 70-ui-liste |
| J-004 | Liste — erreur | lecture des règles en 503 | message « Impossible de charger… » + « Réessayer » qui recharge ; jamais l'état vide | BUG corrigé (l'échec affichait « Aucune automatisation ») |
| J-010 | Créer › Partir de zéro | avant tout geste | 0 ligne créée ; renommer crée UNE règle, brouillon, trigger quote.sent, steps vides | 71-ui-editeur |
| J-011 | Éditeur — déclencheur | tiroir « Facture envoyée » | trigger_event = invoice.sent, affiché sur le bouton | 71-ui-editeur |
| J-012 | Éditeur — action | « Notifier l'équipe », nom + titre | step action create_notification {nom, title} = la carte | 71-ui-editeur |
| J-013 | Éditeur — délai + texto | attente 2 jours puis texto | chaîne action→attendre(172800)→send_sms, cartes identiques | 71-ui-editeur |
| J-014 | Éditeur — texte | modifier le corps du texto | seul config.body change en base | 71-ui-editeur |
| J-015 | Éditeur — condition | « + » entre deux cartes, `total_cents > 5000` / `statut = sent` | step si {total_cents:{gt:5000}, statut:'sent'}, suite sous « alors » | BUG corrigé (a11y : les « + » étaient `aria-hidden`, invisibles des lecteurs d'écran) |
| J-016 | Éditeur — rechargement | recharger | cartes identiques, base inchangée (updated_at) | 71-ui-editeur |
| J-017 | Éditeur — Réglages | ré-entrée, fenêtre 9–17, jours ouvrables, 7 j | settings exact, relu après rechargement ; remis par défaut = clé retirée | 71-ui-editeur |
| J-018 | Éditeur — publier | interrupteur + confirmation | is_active=true, « Publiée » | 71-ui-editeur |
| J-019 | Éditeur — dépublier | interrupteur | is_active=false, « Brouillon », relu après rechargement | testé dans le même test que J-018 |
| J-020 | Liste — dupliquer | menu « Dupliquer » | copie brouillon, non préréglage, mêmes steps ; source intacte | 70-ui-liste |
| J-021 | Liste — supprimer | menu « Supprimer » + confirmation | deleted_at posé, is_active=false, visible dans Corbeille « Supprimée » | 70-ui-liste |
| J-022 | Corbeille — restaurer | menu « Restaurer » | deleted_at null, brouillon, de retour dans « Toutes » | testé dans le même test que J-021 |
| J-023 | Créer › Partir d'un modèle | 1er modèle, « Utiliser ce modèle » | copie brouillon ; nb de cartes = nb d'étapes en base ; nom affiché = nom en base | 72-ui-modeles-langue-mobile |
| J-024 | Liste — interrupteur de ligne | publier puis dépublier | is_active suit, statut « Publiée »/« Brouillon » | 72 |
| J-025 | Interface EN | éditeur en anglais, ajout « Notify the team » | même règle affichée ; texte par défaut anglais écrit en base | 72 |
| J-026 | Langue des messages | bouton EN puis FR | company_settings.default_language = en puis fr, relu après rechargement | 72 |
| J-027 | Téléphone (UA iPhone, 390×844) | /automations | porte « application » (mobileGate : /automations n'est pas dans CHEMINS_PUBLICS) — la page n'est pas servie sur téléphone, c'est voulu | 72 |
| J-028 | Fenêtre étroite 390 px (ordinateur) | liste | pas de défilement horizontal de la page ; « Créer » et l'ouverture d'une règle fonctionnent | 72 |
| J-030 | Réglages du déclencheur | « Devis ouvert » : première ouverture + min 500 | conditions {ouverture:'premiere', montant__gte:500}, détail sous la carte, relu | 71 |
| J-040 | Validation — étape incomplète | texto vidé | « Enregistrer » grisé + « « Texte du message » est vide. » ; rien écrit | 71 |
| J-041 | Validation — publication bloquée | « Date atteinte » sans champ | refus avant confirmation, message, is_active reste false | 71 |
| J-050 | Éditeur — chargement | requête retenue | indicateur, jamais « introuvable » | 71 |
| J-051 | Éditeur — erreur | /api/automations/editeur en 503 | « Impossible de charger… » + « Réessayer » qui recharge | 71 |
| J-060 | Écart UI↔moteur §2.4 n°7 (Réglages › Messagerie) | règle à étapes, texto modifié | l'écran montre le texte des étapes (celui qui part) ; l'enregistrement écrit steps ET actions | BUG corrigé (`updateRuleMessage` n'écrivait que `actions`) |
| J-061 | Écart §2.4 n°1 (« si » + étiquettes) | client avec / sans l'étiquette | la branche suit les étiquettes RÉELLES du client (« sinon » quand il ne l'a pas) | CORRIGÉ (moteur : le « si » appelle `conditionsEtiquettesOk`) — `integration/10-b-parcours.test.ts` ([A-074][J-061], 2 tests) |
| J-062 | Écart §2.4 n°2 (« si » sur RDV / deal) | rendez-vous dont le statut change, opportunité déplacée entre le déclenchement et le « si » | la branche est jugée sur l'état ACTUEL (statut du rendez-vous, étape du deal) | CORRIGÉ (moteur : `metadonneesFraiches` relit `schedule_event` et `deal`) — `integration/10-b-parcours.test.ts` ([J-062], 2 tests) |
| J-063 | Écart §2.4 n°3 (plafond client.inactive, jours_avant) | `date.reached`, `jours_avant` = « 3.5 » ou « 400 » | la règle part au décalage que le balayage vise (3, 365) ; l'enregistrement refuse ces valeurs (message clair) | `jours_avant` : CORRIGÉ (même normalisation balayage ↔ moteur, refus à l'enregistrement, événement réservé à sa règle) — `unitaires/A-date-atteinte-jours-avant.test.ts`, `integration/10-b-declencheurs.test.ts` ([J-063]). Plafond `client.inactive` : NON COUVERT ici (balayage serveur, pas de geste d'interface qui le révèle) |
| J-064 | Écart §2.4 n°4 (opérateurs in/not_in) | — | — | NON COUVERT : absence d'UI voulue (6 opérateurs offerts), pas un défaut constaté |
| J-065 | Écart §2.4 n°11 (PATCH publie une règle en corbeille) | PATCH `{ is_active: true }` sur une règle à la corbeille | 422 « … à la corbeille : restaurez-la avant de la publier. », règle inchangée ; restaurée, elle se publie | CORRIGÉ (route PATCH : même refus que `changerPublication`) — test d'API `integration/10-b-parcours.test.ts` ([J-065]) |
