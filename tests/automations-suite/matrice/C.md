# C — Cas négatifs

Tests : `tests/automations-suite/integration/20-cde-negatifs.test.ts` (vrai moteur, staging, bureau A en bac à sable).
Déclencheur de travail : `note.added` sur un client (aucun préréglage ne l'écoute).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| C-001 | note.added | règle brouillon (`is_active=false`) | aucun journal, aucune tâche, aucune note, aucun envoi | PASS |
| C-002 | note.added | règle à la corbeille (`deleted_at`) restée `is_active=true` | aucun effet | PASS |
| C-003 | note.added | règle purgée (`deleted_at` + `purged_at`) | aucun effet | PASS |
| C-004 | note.added | règle supprimée physiquement | aucun journal, aucune note | PASS |
| C-005 | note.added | condition `canal = web`, événement `telephone` | aucune action ; une ligne de journal « Conditions non remplies : canal » (L-004) | attente mise à jour avec L-004 |
| C-006 | note.added | condition `montant >= 100`, métadonnée absente | aucune action (comparaison impossible = refus) ; une ligne « Conditions non remplies : montant » (L-004) | attente mise à jour avec L-004 |
| C-007 | note.added | témoin positif : condition vraie | 1 note, 1 journal réussi | PASS |
| C-008 | note.added | `client_a_etiquette` absente du client | aucune action ; une ligne « Conditions non remplies : étiquette du client » (L-004) | PASS |
| C-010 | tâche différée en file | règle repassée en brouillon avant l'échéance | tâches `cancelled`, motif « Automatisation en brouillon : envoi annulé. », rien exécuté | PASS |
| C-011 | tâche différée en file | règle mise à la corbeille | `cancelled`, « Automatisation supprimée : envoi annulé. » | PASS |
| C-012 | tâche différée en file | règle purgée | `cancelled`, rien exécuté | PASS |
| C-013 | tâche différée en file | règle supprimée physiquement | tâches supprimées (FK en cascade), rien exécuté | PASS — suppression sans trace dans les Journaux (inv-1 §6) |
| C-014 | tâche due | « Tout arrêter » (pause d'entreprise) | tâche laissée `pending`, `attempts=0` ; exécutée à la reprise | PASS |
| C-015 | note.added | pause d'entreprise | événement ignoré : ni journal ni tâche | PASS — l'événement est PERDU (pas rejoué à la reprise), comportement documenté |
| C-016 | événement + tâche due | `AUTOMATIONS_ENABLED=off` | rien traité, rien réclamé, file conservée | PASS |
| C-020 | note.added | client sans téléphone | texto sauté `sans_telephone` ; note et courriel faits | PASS |
| C-021 | note.added | client sans courriel | courriel sauté `sans_courriel` ; texto et note faits | PASS |
| C-022 | note.added | client sans prénom (nom présent) | `{client_first_name}` retombe sur le nom complet | PASS — règle de `setClientVars` |
| C-023 | note.added | entité inexistante | texto et courriel sautés avec motif, pas de plantage | PASS |
| C-024 | tâche différée | client mis à la corbeille entre événement et échéance | tâches `cancelled` « Annulée : le client a été supprimé. », aucune note, aucun envoi | PASS après correctif `cad85cf8` (avant : la note était ajoutée, tâches `completed`) |
| C-025 | tâche différée | client supprimé physiquement | idem C-024 | PASS après correctif `cad85cf8` |
| C-026 | note.added | 1re action en échec (étiquette vide) | échec journalisé, action suivante faite | PASS |
| C-027 | note.added | client sans aucun nom | « Bonjour, » propre, pas de `undefined` | PASS |
| C-028 | tâche différée texto | client à la corbeille + drapeau `auto_desabonnement_canal` | rien ne part, tâche `cancelled` | PASS après correctif `cad85cf8` (avant : texto transactionnel ENVOYÉ au client supprimé) |
| C-030 | parcours en cours | texte d'une étape DÉJÀ planifiée modifié | l'ANCIEN texte part (copie dans `action_config`) | PASS — règle du code documentée |
| C-031 | parcours en cours | texte d'une étape PAS ENCORE planifiée modifié | le NOUVEAU texte part (relu à la planification) | PASS — règle du code |
| C-032 | parcours en cours | étape planifiée supprimée | `cancelled` « Étape supprimée du parcours : envoi annulé. » | PASS |
| C-033 | parcours en cours | règle dépubliée | étape en attente `cancelled`, parcours arrêté | PASS |
| C-034 | tâche différée | délai de la règle modifié | l'échéance de la tâche déjà planifiée ne bouge pas | PASS — règle du code |
| C-035 | parcours en cours | brouillon puis republiée avant l'échéance | la tâche part (l'annulation se décide à l'échéance) | PASS — règle du code (inv-1 §9.20) |
