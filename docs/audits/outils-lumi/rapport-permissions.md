## 3. Écarts de permissions

Toutes les permissions de Lumi sont vérifiées **côté serveur**, avant le handler, par `executerOutilGarde` (`server/lib/agent/garde.ts`) : clé de la page Rôles (`PERMISSION_PAR_OUTIL`), puis visibilité des montants (`membre_voit_les_montants`), puis validation des arguments. L'org vient de la session (jamais d'un argument), et chaque requête d'outil passe par le client de l'utilisateur (RLS) ou par une route de l'app qui refait ses propres contrôles.

### Corrigés dans cette branche

| Outil(s) | Écart | Avant | Après |
|---|---|---|---|
| `record_invoice_payment`, `mark_invoice_paid` | Clé de LECTURE pour une écriture d'argent | `financial.view_payments` | `payments.create` (comme l'écran) |
| 7 outils de préréglages/modèles de devis | Un vendeur changeait prix, taxes, modèle par défaut | `quotes.update` | `settings.update` (comme l'écran) |
| `set_member_permissions`, `reset_member_permissions`, `update_role_preset`, `update_member_role`, `invite_member`, `reactivate_member` (et les MÊMES routes à l'écran) | Escalade : un admin se redonnait des droits, touchait un autre admin ou le rôle Admin, nommait un admin, donnait une permission qu'il n'a pas | aucun contrôle (routes en service_role) | `refusEscalade` (`server/lib/garde-droits.ts`) : seul le propriétaire fait tout ; les autres ne touchent ni à eux-mêmes, ni à un admin, et n'accordent que ce qu'ils ont |
| `resend_invitation` (route) | Une invitation révoquée ou acceptée revivait, sans garde d'escalade | remise « en attente » | refus 409 + même garde qu'à l'envoi |
| `set_hourly_rate`, `add_payroll_adjustment`, `mark_payroll_period_paid`, `approve_timesheet` | Un admin agissait sur SA propre paie | permis | refusé (`refuserSurSoi`), sauf propriétaire |
| Toute écriture portant un montant | Un technicien sans accès aux montants réécrivait les prix (`update_job`) | permis | refusé si la personne ne voit pas les montants |
| Modes « argent » / « tout », « toujours confirmer » | Argent, envois, irréversible et droits partaient sans carte | selon le mode | `JAMAIS_D_OFFICE` : toujours une carte, et « toujours confirmer » est refusé pour ces actions (serveur) |
| Écritures après lecture de contenu externe | Un texto ou formulaire client pouvait déclencher une écriture d'office (injection) | d'office | carte obligatoire pour le reste du tour |

### Préréglages de rôle : aucun changement

Conformément à la consigne, **aucun préréglage de rôle n'a été modifié**. Les clés ci-dessus sont celles que l'écran exige déjà ; seule la garde de Lumi a été alignée dessus.

### Ouverts

| Outil / lieu | Écart | Proposition |
|---|---|---|
| `send_email` | Lumi exige `messages.send` (techniciens l'ont) ; la route exige owner/admin → carte proposée puis refusée | Aligner la garde sur owner/admin, ou ouvrir la route à `messages.send` — **décision produit** |
| `send_payment_reminders` | `messages.send` suffit : un technicien peut relancer un impayé (il ne voit pourtant pas les montants) | Exiger aussi `financial.view_invoices` (garde à deux clés) |
| `deactivate_recurrence_rule` | Clé `jobs.update` (techniciens) pour arrêter une récurrence | `jobs.delete` ou `settings.update` — décision produit |
| `update_d2d_pipeline_item` | Écriture directe : un vendeur passe le deal d'un collègue en gagné et se l'attribue | Passer par la route du pipeline terrain |
| Route `/api/payment-requests/*` | Préfixe public qui saute la garde de rôle à l'écran | Hors Lumi : à corriger dans `route-permissions.ts` |
| `team_members` (base) | INSERT permis à tout membre pour n'importe quel user_id | Migration proposée `20261004500000_team_members_insert_admin_ou_soi.sql` (non appliquée) |
| `team_members` (base, Loi 25) | Taux horaire et date de naissance lisibles par tous les membres | Nécessite de passer 3 écrans par une RPC avant de restreindre la colonne |
| Mode par défaut « argent » | 75 actions non sensibles partent sans carte (créer un job, déplacer une carte du pipeline…) | **Décision produit** : la mission demande « les 180 ont une carte » ; c'est le mode « demander ». Changer le défaut = une migration (`memberships.lumi_mode DEFAULT 'argent'`, plus la valeur des membres existants) — non écrite, en attente de ta décision |

### Vérifié par preset

Pour chaque outil, la colonne « Garde (préréglages) » de la matrice donne la clé et les rôles qui l'ont par défaut. Les tests `tests/garde-droits.test.ts`, `tests/lumi-garde-fous.test.ts`, `tests/lumi-garde-droits-montants.test.ts` et `tests/rls-permissions-parite` couvrent la garde ; la preuve contre PostgREST reste `npm run qa:rls-roles` (staging).
