# Audit — outils d'argent (2026-09-30)

Racine : `server/lib/agent/…` sauf mention. 01_schema = supabase/baseline/01_schema.sql.

## Critiques
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| mark_invoice_paid, record_invoice_payment | tools-etendus.ts:2906-2911 ; tools-argent.ts:1231-1232 ; 01_schema:13686-13729 | RPC `apply_invoice_payment` seule, aucune ligne `payments`. `trg_payments_recalculate_invoice` recalcule paid_cents = Σ payments : le prochain vrai paiement efface l'argent saisi par Lumi (solde qui réapparaît, relances). Absent de list_payments, rapports, QuickBooks ; `method` jamais stocké. | Passer par `POST /invoices/:id/mark-paid` (route de l'écran) ; montant optionnel pour le partiel. |
| mark_invoice_paid, record_invoice_payment | garde.ts:72 ; tools-argent.ts:2155 ; routes/invoice-mark-paid.ts:32 | Gardé par `financial.view_payments` (LECTURE) ; l'écran exige `payments.create` ; écriture en service_role → escalade. | Clé `payments.create` + passage par la route. |
| create_invoice | fiches.ts:156-159 ; tools-etendus.ts:1588,1608 ; tools.ts:835 | La carte affiche TPS+TVQ de l'entreprise ; la facture est créée avec `tax_cents` du modèle (0 par défaut) : carte 114,98 $, facture 100 $ ; pas d'`applied_taxes`. | Taxes calculées côté serveur (resolveTaxesForOrg + computeTaxLines), même calcul pour la carte ; applied_taxes. |
| charge_card_on_file | tools-argent.ts:1843-1847 ; stripe-connect.ts:431-434 | Aucune vérification du statut : une facture annulée (solde > 0) ou un brouillon peut être prélevé. | Refuser void / cancelled / draft. |
| charge_card_on_file, refund_payment, mark_invoice_paid, record_invoice_payment, void_invoice, delete_invoice, create_payment_request, remove_card_on_file | fiches.ts:134-146 ; CarteAutorisation.tsx:229-231 | Carte vide ou « amount cents 5000 » : ni facture, ni client, ni montant en dollars. | Aperçu « argent » : document, client, montant lu en base, « irréversible ». |
| update_quote_template, update_quote_preset (+ delete) | tools-argent.ts:731-737,902-908,2142,2147 ; route-permissions.ts:242-243 | Écriture directe gardée par `quotes.update` ; l'écran exige `settings.update` : un vendeur change prix/taxes/modèle par défaut. | Clé `settings.update` ; idéalement passer par la route. |
| refund_payment, charge_card_on_file | routes/lumi.ts:962-969 ; execution.ts:147-151 | « Toujours confirmer » accepte tout outil ; le mode « tout » auto-exécute aussi les sensibles : remboursement / prélèvement sans carte. | Liste « jamais d'office » refusée par /lumi/autorisations et exclue des modes. |

## Élevés
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| create_quote | tools-etendus.ts:1532-1568 | Aucun `tax_rate` : défaut 14,975 % quelles que soient les taxes ; `total_cents` renvoyé hors taxes ; pas d'`applied_taxes`. | Comme createQuote de l'app ; relire les totaux en base. |
| mark_invoice_paid | tools-etendus.ts:2887-2896 | Une facture annulée devient « payée » (la route répond 409). | Refuser void (réglé en passant par la route). |
| void_invoice, delete_invoice, send_invoice | tools-argent.ts:1056-1060,1179-1184 ; routes/public-pay.ts:60-64,245-250 | Les liens de paiement actifs restent payables après annulation / suppression ; send_invoice renvoie une facture annulée. | Annuler les payment_requests ; refuser l'envoi d'une facture void/draft/supprimée ; corriger /pay. |
| create_invoice_from_job | tools-etendus.ts:3052-3065 ; 01_schema:5701-5718 | La RPC crée la facture à tax_cents = 0 (l'écran résout les taxes dans l'éditeur) ; `already_exists` ignoré. À vérifier sur staging. | Appliquer les taxes après la RPC ; relayer already_exists. |
| save_job_billing_milestones | tools-terrain.ts:1118-1127,1236 | Aucune lecture ne donne les ids des jalons : un nouvel échéancier supprime et recrée, y compris un jalon facturé → 2e facture de dépôt possible. | Exposer les jalons ; refuser la suppression d'un jalon facturé. |
| list_payments | tools-argent.ts:2038-2048 | `sum_amount_cents` = page (50 max), ignore les remboursements ; bornes UTC. | Agrégat en base, net, bornes locales. |
| create_payment_request, resend_payment_request | tools-argent.ts:1731-1733,1771 ; routes/payment-requests.ts | 200 « envoyé » même sans courriel ou texto en échec. | Canal demandé non parti = erreur. |
| (route) | route-permissions.ts:79-80 vs 433 | Préfixe public `/api/payment-requests/` : un technicien crée/envoie des liens de paiement depuis l'écran. | Restreindre le préfixe public au GET de statut. |

## Moyens / bas (résumé)
revert_invoice_to_draft échoue toujours (trigger d'immuabilité) avec un faux « ton rôle ne permet pas » ; update_invoice (objet/échéance d'une facture émise, taxes non recalculées quand les lignes changent) ; duplicate_invoice (total renvoyé sans rabais) ; run_recurring_invoice_now (envoie un courriel au client non déclaré, non atomique) ; create/update_recurring_invoice (auto_send envoie un courriel, vers_client:false) ; list_recurring_invoices (montants hors taxes, somme de page) ; carte send_invoice (total vs solde, objet réel) ; carte send_payment_reminders (UUID) ; logique dupliquée (create_invoice, paiements, modèles) ; convert_quote_to_invoice (« converti en job ») ; charge_card_on_file (`processing` traité comme refus) ; create_invoice (description, due_date) ; list_invoices (sommes de page).

Sans constat : update_quote, duplicate_quote, delete_quote, unarchive_quote, send_quote_sms, presets/modèles (lecture/création), templates de facture, delete_recurring_invoice, reminder settings, create_invoice_for_visit ; remove_card_on_file, send_quote, refund_payment (hors carte).
