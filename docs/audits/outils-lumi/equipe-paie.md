# Audit — équipe, droits, pointage, paie (2026-09-30)

Mécanismes : les routes `/invitations/*` et `/roles/*` écrivent en service_role (le trigger `enforce_membership_role_change` « personne ne modifie ses propres droits » est contourné) ; `hasPermission` et `member_has_permission` lisent la carte `memberships.permissions` AVANT le rôle.

## Critiques
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| set_member_permissions, reset_member_permissions | tools-equipe.ts:1267-1326 ; role-presets.ts:230-332 | Aucun contrôle « soi-même », « cible admin », « pas plus que ses propres droits » : un admin se redonne des droits retirés par le propriétaire, s'accorde `users.delete`, vide les droits d'un autre admin, donne à un vendeur des clés qu'il n'a plus. | Outil ET route : refuser soi-même ; cible admin réservée au propriétaire ; refuser toute clé à true que l'appelant n'a pas ; users.delete réservé au propriétaire. |
| update_role_preset | tools-equipe.ts:1214-1247 ; role-presets.ts:136-170 | Un admin modifie le rôle « admin » (lui compris) : réactive des clés financières retirées, ajoute users.delete, ou retire des droits aux autres admins. | role « admin » réservé au propriétaire ; pas de clé que l'appelant n'a pas. |
| update_member_role | tools-equipe.ts:445,495 ; invitations.ts:812-816 | Rétrograder garde les anciens droits (permissions non réécrites) ; Lumi affirme « ses permissions repartent du modèle ». | Réécrire les permissions au modèle du nouveau rôle ; retirer la phrase fausse. |

## Élevés
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| remove_member, set_member_permissions, update_member_role, set_hourly_rate, add_payroll_adjustment, delete_team (cartes) | fiches.ts:134-146 ; CarteAutorisation.tsx:229-231 | La carte n'identifie pas la personne ; montants en cents bruts ; pas d'avant → après ; pas d'« irréversible ». | Aperçu « membre ». |
| invite_member, update_member_role (promotion) | tools-equipe.ts:42,367,462 ; invitations.ts:229-238,795-810 | Un admin restreint crée un admin (invitation ou promotion) et récupère tout. | Rôle cible admin réservé au propriétaire. |
| reactivate_member | tools-equipe.ts:548-556 ; invitations.ts:915-988 | Un admin réactive un admin suspendu par le propriétaire. | Même règle que le retrait. |
| get_timesheets, get_payroll_summary | tools-etendus.ts:599/610, 945/954 ; payroll.ts:158-159 | Toutes les heures valent 0 : `computeEntryHours` exige punch_in_at/punch_out_at, non sélectionnés. | Sélectionner punch_in_at/out_at ; status completed. |
| set_hourly_rate, add_payroll_adjustment, mark_payroll_period_paid, approve_timesheet | tools-equipe.ts:735,1021,1072,938 | Un admin agit sur lui-même (son taux, sa prime, sa paie, ses heures). | Refuser l'auto-attribution sauf propriétaire. |

## Moyens / bas (résumé)
Clés de LECTURE sur des écritures de paie (financial.view_reports) — les routes exigent owner/admin, pas d'escalade mais carte trompeuse ; set_hourly_rate faux succès (0 ligne sous RLS) ; approve_timesheet (marqueur « [APPROVED] » dans les notes au lieu d'approved_at) ; fuseau des pointages (date UTC, heure du serveur) ; totaux de page (PostgREST 1 000 lignes) ; techniciens voient heures et GPS de tous (décision produit, Loi 25) ; delete_team non atomique (et set_default_availability) ; remove/reactivate_member : clé Lumi ≠ clé de l'écran (users.delete / users.invite) ; punch_out et resend_invitation irréversibles mais non sensibles ; invite_member renvoie le lien d'invitation au modèle ; team_id/job_id non vérifiés dans l'org ; update_payroll_settings (date invalide acceptée).

Hors Lumi (base) : `team_members_select_org` expose hourly_rate_cents, labour_cost_hourly et birth_date à tout membre par PostgREST (Loi 25) — migration à soumettre.

Correct : on ne peut pointer que pour soi ; retrait de soi-même / du propriétaire impossible ; un technicien ne gagne jamais de clé financière ; erreurs lisibles ; isolation entre entreprises.
