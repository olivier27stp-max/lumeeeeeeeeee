/* ═══════════════════════════════════════════════════════════════
   Données — Les 35 presets d'automatisation canoniques.

   Généré depuis l'état prod validé (audit 2026-08-02) : textes FR issus
   de apply_automation_presets_fr, triggers corrigés (quote.sent).
   Utilisé par ensureAutomationPresets() comme filet de sécurité à la
   création d'une org — la fonction DB seed_automation_presets ayant
   déjà divergé une fois en prod (drift de migrations, seed du 20260331
   resté déployé pendant 4 mois).
   ═══════════════════════════════════════════════════════════════ */

export interface AutomationPresetDef {
  preset_key: string;
  name: string;
  description: string;
  trigger_event: string;
  conditions: Record<string, unknown>;
  delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
}

export const AUTOMATION_PRESETS: AutomationPresetDef[] = [
  {
    "preset_key": "agreement_signed",
    "name": "Contract Signed",
    "description": "Confirm to the client that their contract is signed",
    "trigger_event": "agreement.signed",
    "conditions": {},
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Merci [client_first_name]! Votre contrat avec [company_name] est signé. Votre copie : [signed_contract_link]\n[deposit_line]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Merci [client_first_name],</h2><p>Votre contrat avec [company_name] est signé. Vous pouvez le consulter en tout temps ici :</p><p><a href=\"[signed_contract_link]\">[signed_contract_link]</a></p><p>[deposit_line]</p><p>À bientôt!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Contrat signé"
        }
      }
    ]
  },
  {
    "preset_key": "appointment_confirmation",
    "name": "Appointment Confirmation",
    "description": "Confirm appointment immediately",
    "trigger_event": "appointment.created",
    "conditions": {},
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre rendez-vous avec [company_name] est confirmé pour le [appointment_date] à [appointment_time]. À bientôt!\n[contract_line]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est confirmé :</p><ul><li><strong>Date :</strong> [appointment_date]</li><li><strong>Heure :</strong> [appointment_time]</li><li><strong>Adresse :</strong> [appointment_address]</li></ul><p>À bientôt!<br/>[company_name]</p>[contract_html]</div>",
          "subject": "[company_name] — Rendez-vous confirmé"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "appointment_confirmed"
        }
      }
    ]
  },
  {
    "preset_key": "client_anniversary",
    "name": "Client Anniversary — 1 Year",
    "description": "Celebrate 1-year anniversary with client",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 31536000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Ça fait déjà un an qu'on a fait des travaux chez vous — merci encore pour votre confiance!</p><p>Si c'est le temps d'une retouche ou d'un entretien, répondez à ce courriel et on vous prépare une soumission.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Déjà un an!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Déjà un an! Merci pour votre confiance, [client_first_name]. Besoin d'une retouche? [company_name] est là. Répondez STOP pour vous désabonner."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "1_year"
          },
          "event_type": "anniversary_sent"
        }
      }
    ]
  },
  {
    "preset_key": "cross_sell_30d",
    "name": "Cross-Sell — 30 Days After Job",
    "description": "Reconnect with client 30 days after job",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 2592000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Ça fait un mois depuis nos travaux chez vous — on espère que tout est encore impeccable!</p><p>Saviez-vous qu'on offre aussi d'autres services d'entretien? Répondez à ce courriel pour en savoir plus.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Des nouvelles de nous"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days": 30
          },
          "event_type": "cross_sell_sent"
        }
      }
    ]
  },
  {
    "preset_key": "deposit_followup_2d",
    "name": "Deposit Follow-Up — 2 Days",
    "description": "",
    "trigger_event": "quote.approved",
    "conditions": {},
    "delay_seconds": 172800,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Rappel : votre dépôt pour [company_name] est en attente. Répondez à ce message si vous avez besoin d'aide."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "La soumission est acceptée depuis 2 jours, mais le dépôt n'a pas été reçu.",
          "title": "Dépôt en attente — [client_name]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "deposit_followup_sent"
        }
      }
    ]
  },
  {
    "preset_key": "deposit_received",
    "name": "Deposit Received Confirmation",
    "description": "Confirm deposit and project start",
    "trigger_event": "invoice.paid",
    "conditions": {
      "payment_type": "deposit"
    },
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Merci [client_first_name]!</h2><p>Votre dépôt a bien été reçu et votre place est réservée à l'horaire.</p><p>On vous recontacte avec les détails du rendez-vous.</p><p>À bientôt,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dépôt reçu, merci!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Dépôt bien reçu — merci [client_first_name]! Votre place est réservée. — [company_name]"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "Le dépôt de la facture [invoice_number] est confirmé. La job peut être planifiée.",
          "title": "Dépôt reçu — [client_name]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "deposit_received"
          },
          "event_type": "deposit_confirmed"
        }
      }
    ]
  },
  {
    "preset_key": "deposit_reminder",
    "name": "Deposit Reminder — Quote Approved",
    "description": "",
    "trigger_event": "quote.approved",
    "conditions": {},
    "delay_seconds": 3600,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Merci d'avoir accepté notre soumission!</p><p>Pour réserver votre place à l'horaire, un dépôt est requis. Répondez à ce courriel si vous avez des questions sur le paiement.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dépôt requis pour réserver votre place"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Merci d'avoir accepté la soumission de [company_name]! Un dépôt est requis pour réserver votre place à l'horaire."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "deposit_reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "estimate_followup",
    "name": "Estimate Follow-Up",
    "description": "Follow up on sent estimates",
    "trigger_event": "estimate.sent",
    "conditions": {},
    "delay_seconds": 172800,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On vous a envoyé un devis récemment et on voulait faire un suivi.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d'y répondre.</p><p>Cordialement,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Suivi de votre devis"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "estimate_2d"
          },
          "event_type": "estimate_followup"
        }
      }
    ]
  },
  {
    "preset_key": "google_review",
    "name": "Review Request — After Job",
    "description": "Send satisfaction survey after job completion",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 7200,
    "actions": [
      {
        "type": "request_review",
        "config": {}
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "review_requested"
        }
      }
    ]
  },
  {
    "preset_key": "invoice_sent_reminder_14d",
    "name": "Invoice Reminder — 14 Days",
    "description": "",
    "trigger_event": "invoice.sent",
    "conditions": {},
    "delay_seconds": 1209600,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est impayée depuis deux semaines.</p><p>Merci de la régler rapidement. En cas de problème, répondez à ce courriel et on trouvera une solution.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] impayée depuis 2 semaines"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], rappel : votre facture de [company_name] est impayée depuis 2 semaines. Répondez à ce message pour toute question."
        }
      },
      {
        "type": "create_task",
        "config": {
          "title": "Relancer la facture [invoice_number] — 14 jours de retard",
          "description": "[client_name] n'a pas payé depuis 14 jours. Un appel est recommandé."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "Une tâche de relance a été créée.",
          "title": "Facture [invoice_number] — 14 jours de retard"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days_after_sent": 14
          },
          "event_type": "invoice_reminded"
        }
      }
    ]
  },
  {
    "preset_key": "invoice_sent_reminder_1d",
    "name": "Invoice Reminder — 1 Day",
    "description": "Gentle reminder 1 day after invoice is sent",
    "trigger_event": "invoice.sent",
    "conditions": {},
    "delay_seconds": 86400,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Petit rappel amical : la facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en attente de paiement.</p><p>Si vous avez déjà payé, ignorez ce message.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : facture [invoice_number]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days_after_sent": 1
          },
          "event_type": "invoice_reminded"
        }
      }
    ]
  },
  {
    "preset_key": "invoice_sent_reminder_30d",
    "name": "Invoice Final Reminder — 30 Days",
    "description": "Final reminder 30 days after invoice is sent — requests urgent action",
    "trigger_event": "invoice.sent",
    "conditions": {},
    "delay_seconds": 2592000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en souffrance depuis 30 jours.</p><p>Merci de la régler sans tarder, ou contactez-nous pour convenir d'une entente de paiement.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] en souffrance (30 jours)"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre facture de [company_name] est en souffrance depuis 30 jours. Merci de la régler rapidement ou de nous contacter."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "Cette facture demande une intervention rapide.",
          "title": "Facture [invoice_number] — 30 jours de retard"
        }
      },
      {
        "type": "create_task",
        "config": {
          "title": "Facture [invoice_number] — 30 jours de retard, à escalader",
          "description": "Le retard dépasse 30 jours. À transmettre à un responsable ou à mettre en recouvrement."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "final_reminder": true,
            "days_after_sent": 30
          },
          "event_type": "invoice_reminded"
        }
      }
    ]
  },
  {
    "preset_key": "invoice_sent_reminder_3d",
    "name": "Invoice Reminder — 3 Days",
    "description": "Follow-up reminder 3 days after invoice is sent",
    "trigger_event": "invoice.sent",
    "conditions": {},
    "delay_seconds": 259200,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est toujours en attente de paiement.</p><p>Si vous avez déjà payé, ignorez ce message.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : facture [invoice_number]"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], petit rappel : votre facture de [company_name] est en attente de paiement."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days_after_sent": 3
          },
          "event_type": "invoice_reminded"
        }
      }
    ]
  },
  {
    "preset_key": "invoice_sent_reminder_7d",
    "name": "Invoice Reminder — 7 Days",
    "description": "Stronger reminder 7 days after invoice is sent",
    "trigger_event": "invoice.sent",
    "conditions": {},
    "delay_seconds": 604800,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en attente depuis une semaine.</p><p>Merci de la régler dès que possible, ou répondez à ce courriel si quelque chose ne va pas.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] en attente depuis 7 jours"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre facture de [company_name] est toujours en attente. Merci de la régler quand vous pouvez!"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] n'a pas encore payé cette facture.",
          "title": "Facture [invoice_number] — 7 jours impayée"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days_after_sent": 7
          },
          "event_type": "invoice_reminded"
        }
      }
    ]
  },
  {
    "preset_key": "job_reminder_1d",
    "name": "Job Reminder — 1 Day Before",
    "description": "Send SMS + email reminder 1 day before a scheduled job",
    "trigger_event": "appointment.created",
    "conditions": {},
    "delay_seconds": -86400,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Rappel : votre rendez-vous avec [company_name] est demain à [appointment_time]. Répondez à ce message si vous devez le déplacer."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est <strong>demain</strong>, le [appointment_date] à [appointment_time].</p><p>Un empêchement? Répondez à ce courriel et on trouvera un autre moment.</p><p>À demain!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre rendez-vous est demain"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "job_reminder_1d"
          },
          "event_type": "reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "job_reminder_2h",
    "name": "Job Reminder — 2 Hours Before",
    "description": "",
    "trigger_event": "appointment.created",
    "conditions": {},
    "delay_seconds": -7200,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "C'est aujourd'hui! Votre rendez-vous avec [company_name] est à [appointment_time]. On s'en vient!"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "job_reminder_2h"
          },
          "event_type": "reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "job_reminder_7d",
    "name": "Job Reminder — 1 Week Before",
    "description": "Send SMS + email reminder 1 week before a scheduled job",
    "trigger_event": "appointment.created",
    "conditions": {},
    "delay_seconds": -604800,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Rappel : votre rendez-vous avec [company_name] est dans une semaine, le [appointment_date] à [appointment_time]."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Petit rappel : votre rendez-vous est prévu le <strong>[appointment_date]</strong> à <strong>[appointment_time]</strong>.</p><p>Répondez à ce courriel si vous avez des questions ou devez déplacer le rendez-vous.</p><p>À bientôt!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : rendez-vous dans une semaine"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "job_reminder_7d"
          },
          "event_type": "reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "lead_followup_14d",
    "name": "Lead Final Follow-Up — 14 Days",
    "description": "",
    "trigger_event": "lead.created",
    "conditions": {},
    "delay_seconds": 1209600,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Ça fait deux semaines depuis votre demande — êtes-vous toujours à la recherche de nos services?</p><p>Un simple mot et on vous prépare une soumission.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Toujours intéressé?"
        }
      },
      {
        "type": "create_task",
        "config": {
          "title": "Prospect sans réponse — [client_name]",
          "description": "Aucune réponse depuis 14 jours. Faire un dernier appel, ou clore le dossier."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] ne répond plus. Une tâche de suivi a été créée.",
          "title": "Prospect sans réponse — 14 jours"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "lead_followup_14d"
          },
          "event_type": "lead_followup_final"
        }
      }
    ]
  },
  {
    "preset_key": "lead_followup_1d",
    "name": "Lead Follow-Up — 1 Day",
    "description": "",
    "trigger_event": "lead.created",
    "conditions": {},
    "delay_seconds": 86400,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], avez-vous toujours besoin de nos services? Répondez à ce message et on s'occupe de vous. — [company_name]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "lead_followup_1d"
          },
          "event_type": "lead_followup"
        }
      }
    ]
  },
  {
    "preset_key": "lead_followup_3d",
    "name": "Lead Follow-Up — 3 Days",
    "description": "",
    "trigger_event": "lead.created",
    "conditions": {},
    "delay_seconds": 259200,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment et on veut s'assurer de ne pas vous laisser sans réponse.</p><p>Répondez à ce courriel et on s'occupe de vous rapidement.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — On pense à vous"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "lead_followup_3d"
          },
          "event_type": "lead_followup"
        }
      }
    ]
  },
  {
    "preset_key": "lost_lead_reengagement",
    "name": "Lost Lead Re-engagement — 90 Days",
    "description": "Re-engage lost leads after 90 days",
    "trigger_event": "lead.status_changed",
    "conditions": {
      "new_status": "lost"
    },
    "delay_seconds": 7776000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Ça fait un moment! Si vous avez des projets d'entretien ou de nettoyage, on serait heureux de vous aider.</p><p>Répondez à ce courriel pour une soumission sans engagement.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Toujours des projets?"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], ça fait un bout! Si vous avez des projets, [company_name] est là. Répondez STOP pour vous désabonner."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "lost_lead_90d"
          },
          "event_type": "reengagement_sent"
        }
      }
    ]
  },
  {
    "preset_key": "no_show_followup",
    "name": "No-Show / Cancellation Follow-Up",
    "description": "Follow up when client misses appointment",
    "trigger_event": "appointment.cancelled",
    "conditions": {},
    "delay_seconds": 3600,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], on a manqué notre rendez-vous. Répondez à ce message pour reprendre un moment qui vous convient. — [company_name]"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "Le rendez-vous de [client_name] a été annulé.",
          "title": "Rendez-vous annulé"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "no_show_followup"
        }
      }
    ]
  },
  {
    "preset_key": "payment_confirmation",
    "name": "Payment Confirmation",
    "description": "Thank client for payment",
    "trigger_event": "invoice.paid",
    "conditions": {},
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Paiement reçu — merci [client_first_name]! — [company_name]"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] a payé la facture [invoice_number].",
          "title": "Paiement reçu"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "payment_confirmed"
        }
      }
    ]
  },
  {
    "preset_key": "post_appointment_survey",
    "name": "Post-Appointment Satisfaction Check",
    "description": "Quick satisfaction survey after service",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 3600,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], comment s'est passé notre service? Répondez de 1 à 5 (5 = parfait). — [company_name]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "post_appointment"
          },
          "event_type": "satisfaction_check_sent"
        }
      }
    ]
  },
  {
    "preset_key": "quote_followup_14d",
    "name": "Quote Follow-Up — 14 Days",
    "description": "",
    "trigger_event": "quote.sent",
    "conditions": {},
    "delay_seconds": 1209600,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], dernière relance pour votre soumission de [company_name]. On serait contents de travailler avec vous!"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On voulait faire un dernier suivi au sujet de votre soumission.</p><p>Si le moment n'est pas bon, aucun souci — répondez-nous et on se reprendra quand ça vous conviendra.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dernière relance pour votre soumission"
        }
      },
      {
        "type": "create_task",
        "config": {
          "title": "Relancer la soumission — [client_name]",
          "description": "[client_name] n'a pas répondu depuis 14 jours. Un appel direct est recommandé."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "La soumission de [client_name] date de 14 jours. Une tâche de relance a été créée.",
          "title": "Soumission sans réponse — 14 jours"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "quote_followup_14d"
          },
          "event_type": "follow_up_sent"
        }
      }
    ]
  },
  {
    "preset_key": "quote_followup_1d",
    "name": "Quote Follow-Up — 1 Day",
    "description": "Follow up on an estimate 1 day after sending it",
    "trigger_event": "quote.sent",
    "conditions": {},
    "delay_seconds": 86400,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], avez-vous eu le temps de regarder notre soumission? Répondez à ce message si vous avez des questions. — [company_name]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On vous a envoyé une soumission hier et on voulait s'assurer que vous l'avez bien reçue.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d'y répondre.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Suivi de votre soumission"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "quote_followup_1d"
          },
          "event_type": "follow_up_sent"
        }
      }
    ]
  },
  {
    "preset_key": "quote_followup_21d",
    "name": "Quote Follow-Up — 21 Days (Final)",
    "description": "",
    "trigger_event": "quote.sent",
    "conditions": {},
    "delay_seconds": 1814400,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On garde votre dossier ouvert encore quelque temps si jamais vous souhaitez donner suite à votre soumission.</p><p>Répondez à ce courriel à tout moment.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — On garde votre dossier ouvert"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] n'a jamais répondu après 21 jours. Le dossier est clos.",
          "title": "Soumission close — aucune réponse"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "quote_followup_21d"
          },
          "event_type": "follow_up_final"
        }
      }
    ]
  },
  {
    "preset_key": "quote_followup_3d",
    "name": "Quote Follow-Up — 3 Days",
    "description": "",
    "trigger_event": "quote.sent",
    "conditions": {},
    "delay_seconds": 259200,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], petit rappel pour votre soumission de [company_name]. On peut l'ajuster au besoin!"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Petit rappel au sujet de la soumission qu'on vous a envoyée.</p><p>Si un détail ne convient pas, on peut l'ajuster — dites-le-nous simplement.</p><p>Merci,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre soumission vous attend"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "quote_followup_3d"
          },
          "event_type": "follow_up_sent"
        }
      }
    ]
  },
  {
    "preset_key": "quote_followup_7d",
    "name": "Quote Follow-Up — 7 Days",
    "description": "",
    "trigger_event": "quote.sent",
    "conditions": {},
    "delay_seconds": 604800,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre soumission de [company_name] est toujours valide. Des questions? Répondez à ce message."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre soumission est toujours valide et on garde votre place.</p><p>Si vous avez des questions ou souhaitez aller de l'avant, répondez à ce courriel.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre soumission est toujours valide"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] n'a pas répondu à sa soumission depuis 7 jours.",
          "title": "Soumission sans réponse — 7 jours"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "quote_followup_7d"
          },
          "event_type": "follow_up_sent"
        }
      }
    ]
  },
  {
    "preset_key": "reengagement_90d",
    "name": "Re-Engagement — 90 Days",
    "description": "",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 7776000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Ça fait trois mois depuis notre dernier passage — un entretien serait peut-être dû.</p><p>Répondez à ce courriel et on vous trouve une place à l'horaire.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Déjà 3 mois!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], déjà 3 mois! Un entretien serait peut-être dû. — [company_name] Répondez STOP pour vous désabonner."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days": 90
          },
          "event_type": "reengagement_sent"
        }
      }
    ]
  },
  {
    "preset_key": "review_reminder_7d",
    "name": "Review Reminder — 7 Days",
    "description": "",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 604800,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], un avis Google nous aiderait énormément : [google_review_url] Merci encore! — [company_name]"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "review_reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "seasonal_reminder_6m",
    "name": "Seasonal Reminder — 6 Months After Job",
    "description": "Seasonal check-up reminder",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 15552000,
    "actions": [
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>La saison avance — c'est le bon moment pour préparer votre propriété.</p><p>Répondez à ce courriel pour une soumission rapide et sans engagement.</p><p>À bientôt,<br/>[company_name]</p></div>",
          "subject": "[company_name] — La saison s'en vient"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "La saison avance! [company_name] peut préparer votre propriété. Répondez à ce message pour un devis. Répondez STOP pour vous désabonner."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "type": "6_month"
          },
          "event_type": "seasonal_reminder_sent"
        }
      }
    ]
  },
  {
    "preset_key": "stale_lead_7d",
    "name": "Lead Alert — 7 Days Stale",
    "description": "Alert when lead has no activity for 7 days",
    "trigger_event": "lead.created",
    "conditions": {},
    "delay_seconds": 604800,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], on ne vous oublie pas! Toujours intéressé par nos services? — [company_name]"
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "Aucune activité sur le dossier de [client_name] depuis 7 jours.",
          "title": "Prospect inactif — 7 jours"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "metadata": {
            "days": 7
          },
          "event_type": "stale_lead_alert"
        }
      }
    ]
  },
  {
    "preset_key": "thank_you_after_job",
    "name": "Thank You After Job",
    "description": "Send thank-you message after job completion",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 3600,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Merci de faire affaire avec [company_name], [client_first_name]! Si tout n'est pas parfait, répondez à ce message."
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "thank_you_sent"
        }
      }
    ]
  },
  {
    "preset_key": "welcome_new_lead",
    "name": "Lead — Welcome",
    "description": "Instant welcome message to new leads",
    "trigger_event": "lead.created",
    "conditions": {},
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], merci d'avoir contacté [company_name]! On revient vers vous très vite."
        }
      },
      {
        "type": "create_notification",
        "config": {
          "body": "[client_name] — [client_phone]",
          "title": "Nouveau prospect"
        }
      },
      {
        "type": "log_activity",
        "config": {
          "event_type": "welcome_sent"
        }
      }
    ]
  }
];
