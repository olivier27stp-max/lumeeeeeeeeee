# Automatisations — rapport de prod après les vagues (2026-10-01)

Lecture seule sur la prod, le 2026-10-01 à 9 h 45 (Montréal), environ 24 h après les dernières mises en ligne des vagues 2, 3 et 4. Aucune écriture.

## En une phrase

Rien n'échoue depuis les mises en ligne, mais la prod a très peu de trafic réel, et **les textos ne partent toujours pas** : le moteur fait son travail, c'est le numéro Twilio qui manque.

## Ce qui marche (mesuré)

| Contrôle | Résultat |
|---|---|
| Exécutions en échec depuis 48 h | **0** (il y en avait 14 sur les 5 jours d'avant) |
| Tâches planifiées en retard (échéance passée de plus de 15 min) | **0** sur 150 en attente |
| Tâches planifiées en échec depuis 48 h | **0** (les 23 en échec datent d'avant le 28 sept.) |
| File des événements de base (visites, jobs, devis, factures) | 5 événements en 48 h, **0 bloqué, 0 erreur** |
| File des événements de pipeline | 68 événements en 48 h, **0 bloqué, 0 erreur** |
| Crons posés par la vague 2 (rappels de dates, factures récurrentes, relances de webhooks) | tous passés, **0 échec** ; réponses `200` |
| Lettres mortes non résolues | **0** |
| Courriels en erreur depuis 48 h | **0** |

Depuis la vague 3, un envoi impossible n'est plus un « échec » au texte anglais : c'est un envoi **sauté**, avec la raison en français (« Aucun numéro texto configuré pour le bureau », « Aucune adresse courriel pour ce client », « Consentement manquant »). C'est ce qui explique le passage de 14 échecs à 0.

## Ce qui ne marche pas pour un vrai client

**1. Les textos.** Sur 8 jours : **1 texto parti, 13 en échec, 5 sautés.** La cause est toujours la même : aucun numéro Twilio pour le bureau (Trust Hub pas approuvé). Dernier cas réel : Coquin lavage, ce matin à 8 h 09, rappel de rendez-vous non envoyé. Tant que le numéro n'est pas approuvé, toute automatisation qui envoie un texto ne livre rien. Ce n'est pas un défaut du moteur.

**2. Les courriels sans adresse.** 4 courriels sautés parce que la fiche du client n'a pas de courriel, 1 pour consentement manquant. Comportement voulu.

**3. Sept règles publiées écoutent `estimate.sent`**, un événement qui n'est jamais émis : elles ne se déclencheront jamais. À trancher (les rebrancher sur `quote.sent` ou les retirer).

## Ce que la prod ne peut pas prouver

Le volume est minuscule : **43 exécutions en 8 jours**, dont la majorité sur des bureaux de test. « Zéro échec » veut dire « rien n'a cassé sur ce qui est passé », pas « tout a été éprouvé en conditions réelles ». Les 24 déclencheurs ont été prouvés sur staging (2026-09-30), pas par le trafic de prod.

## Constats nouveaux (notés, pas corrigés)

| Constat | Preuve | Suite |
|---|---|---|
| Le cron des **relances de paiement** (13 h UTC) dépasse le délai de 5 s de l'appel : sa réponse est perdue, on ne voit donc pas s'il a réussi. Le serveur continue le travail après la coupure (la route attend la fin sous verrou), mais **le journal des relances est vide depuis 10 jours** alors que 22 factures sont en retard et 3 bureaux ont des relances réglées. Peut être normal (relances coupées, factures de test, ou relances prises en charge par une automatisation) : **pas vérifié** | `net._http_response` id 129 ; `reminder_log` | chantier paiements |
| Un appel du cron de relance des webhooks a dépassé 5 s (1 sur 126), le passage suivant a réussi | `net._http_response` id 122 | aucun |
| `pg_net` ne garde ses réponses que 6 h environ : un cron en échec la nuit ne laisse aucune trace le matin | plus vieille réponse à 7 h 50 UTC | surveillance à prévoir |

## D-17 (perte d'événement sous saturation) : conclusion sans test de charge

Le test de charge n'a pas été refait : aucun environnement isolé n'existe, et le poste partagé n'a plus que 6,6 Go libres sur C: (99 % plein), en monter un mettrait les autres sessions en danger.

La lecture du code suffit à conclure. `server/lib/champs/service.ts` écrit la valeur du champ (`cf_ecrire_valeur`), **puis**, dans une deuxième étape séparée, émet `custom_field.changed` sans attendre. Si le serveur est saturé, coupé ou redémarré entre les deux, la valeur est écrite et l'événement n'existe pas. La perte est donc **réelle par construction** ; la charge sur staging n'en mesurait que la fréquence (8 sur 144 sous saturation extrême). Au volume actuel de la prod, le risque est faible, pas nul.

Correctif proposé (non fait, demande une migration) : déposer l'événement **dans la même transaction que l'écriture**, comme le font déjà les visites, jobs, devis et factures depuis la migration `20261003100000` — `cf_ecrire_valeur` consigne lui-même une ligne dans `automation_evenements_base`, et le serveur ne l'émet plus à part.
