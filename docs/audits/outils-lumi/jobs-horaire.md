# Audit — jobs, visites, calendrier, tâches, notes (2026-09-30)

Les 4 constats de l'évaluation expliqués : assign_job écrit `jobs.assigned_user_id` (que l'écran vide et n'affiche pas) ; create_job n'a pas d'équipe (p_team_id null) et le prompt présente « crée puis assigne » comme indépendants ; deactivate_recurrence_rule est non sensible et ne touche pas aux visites ; add_note est non sensible, ne vérifie pas la fiche, sans consigne d'homonymes.

## Critiques
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| tous les outils datés | routes/lumi.ts:249 ; tools-etendus.ts:1292,2499,3363 ; tools-terrain.ts:53 | `todayIso` = date UTC : après 20 h à Québec, « demain » = 2 jours plus tard. Aucune heure locale ni décalage : « 9 h » sans décalage devient 9 h UTC (5 h à Québec). | todayIso dans le fuseau de l'org ; accepter date + heure locale et convertir côté serveur (ou refuser sans décalage). |
| query_schedule, find_dates_in_location | tools.ts:371-382,448-449 | `new Date('2026-10-02')` = minuit UTC ; fin `lte` au même instant : « demain » renvoie 0 visite ou celles de la veille au soir. | Bornes locales (bornesJourOrg). |

## Élevés
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| get_day_route | tools.ts:721-738 | Bornes du jour dans le fuseau du serveur (UTC). | bornesJourOrg. |
| assign_job | tools-etendus.ts:1497-1520 | Écrit assigned_user_id, sans effet visible ; « C'est fait ». | Assigner une ÉQUIPE (jobs.team_id + visites à venir), comme l'écran. |
| create_job | tools-etendus.ts:1314 ; orchestrateur.ts:218 | Pas de team_id ; exemple du prompt « crée le job, assigne-le » en actions indépendantes. | Paramètre team_id ; corriger l'exemple. |
| reçus de toutes les écritures | lumi/recus.ts:53-60 ; execution.ts:46-61 | « C'est fait » dès qu'il n'y a pas d'`error` : warning, incomplet, deja_fait, comptes partiels, incertain ignorés ; note DONE imposée. | Reçu nuancé ; note adaptée. |
| deactivate_recurrence_rule | tools-terrain.ts:391-409,1835,1867 | Sans carte ; visites futures laissées ; un plan de service n'est pas une règle ; clé jobs.update (techniciens). | sensible ; signaler visites restantes. |
| add_note | tools-etendus.ts:2942-2963 | Sans carte, entité non vérifiée, pas de consigne homonymes, descriptions contradictoires. | Vérifier l'entité + nom renvoyé ; consigne ; aperçu. |
| schedule_job | tools-terrain.ts:498-526 | Ne vérifie pas « non planifié » ; la RPC déplace la visite existante ou ne fait rien (≥ 2 visites) ; team ignorée ; `scheduled:true`. | Refuser si déjà une visite ; lire updated/overlaps. |
| reschedule_job, cancel_visit | tools-etendus.ts:2497,2558 | Pas de visit_id : cible = prochaine visite sinon la DERNIÈRE PASSÉE, même complétée. | visit_id ; refuser une visite complétée ; l'exiger s'il y en a plusieurs. |
| get_job | tools.ts:351-362 | Visites lues sans deleted_at ni org : une visite annulée ressort « scheduled ». | Filtrer ; traduire le statut. |
| archive_job | tools-etendus.ts:2972-2997 | archived_at lu par personne : le job reste « en retard », visites au calendrier ; description fausse. | Aligner sur un geste de l'écran ou filtrer partout. |
| update_job (line_items) | garde.ts:33,101-110 ; tools-etendus.ts:3108-3155 | Un technicien (jobs.update, sans droit aux montants) réécrit les prix. | financial.view_pricing quand line_items / no_taxes. |
| cartes delete_job, cancel_visit, unschedule_job, archive_job, reschedule_job, bulk_delete_tasks | CarteAutorisation.tsx:229-242 ; fiches.ts:134-146 | Carte sans le job, ISO UTC brut, UUID de tâches. | Aperçu : n°, titre, client, date locale, titres des tâches. |

## Moyens / bas (résumé)
Limites avant filtre de lieu et comptes de page (query_schedule, find_dates_in_location) ; create_recurrence_rule (heure T05:00Z, day_of_week ignoré) ; pas d'outil « visite complétée » (update_job_status ferme tout le job) ; optimize_route sans ids ; find_free_slot (doublons, créneaux passés) ; delete_task sans carte, list_tasks plafonné à 40 ; overlaps ignoré, add_visit sans jobDeLOrg ; fuseau codé en dur America/Montreal ; alertes écrasées ; lead_id mort ; due_date ; `.single()` → message générique ; clés jobs.read sur update/delete_note.

À vérifier : triggers d'automatisations des visites (migration 20261003100000 en prod ?) ; le modèle envoie-t-il le décalage horaire ?
