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
          "body": "Merci [client_first_name]! Votre contrat avec [company_name] est signé. Votre copie : [signed_contract_link]\n[deposit_line]",
          "body_en": "Thank you [client_first_name]! Your contract with [company_name] is signed. Your copy: [signed_contract_link]\n[deposit_line]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Merci [client_first_name],</h2><p>Votre contrat avec [company_name] est signé. Vous pouvez le consulter en tout temps ici :</p><p><a href=\"[signed_contract_link]\">[signed_contract_link]</a></p><p>[deposit_line]</p><p>À bientôt!<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Thank you [client_first_name],</h2><p>Your contract with [company_name] is signed. You can view it anytime here:</p><p><a href=\"[signed_contract_link]\">[signed_contract_link]</a></p><p>[deposit_line]</p><p>Talk soon!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Contrat signé",
          "subject_en": "[company_name] — Contract signed"
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
          "body": "Bonjour [client_first_name], votre rendez-vous avec [company_name] est confirmé pour le [appointment_date] à [appointment_time]. À bientôt!\n[contract_line]",
          "body_en": "Hi [client_first_name], your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you soon!\n[contract_line]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est confirmé :</p><ul><li><strong>Date :</strong> [appointment_date]</li><li><strong>Heure :</strong> [appointment_time]</li><li><strong>Adresse :</strong> [appointment_address]</li></ul><p>À bientôt!<br/>[company_name]</p>[contract_html]</div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed:</p><ul><li><strong>Date:</strong> [appointment_date]</li><li><strong>Time:</strong> [appointment_time]</li><li><strong>Address:</strong> [appointment_address]</li></ul><p>See you soon!<br/>[company_name]</p>[contract_html]</div>",
          "subject": "[company_name] — Rendez-vous confirmé",
          "subject_en": "[company_name] — Appointment confirmed"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It's already been a year since we did work at your place — thank you again for your trust!</p><p>If it's time for a touch-up or some maintenance, just reply to this email and we'll put together a quote for you.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Déjà un an!",
          "subject_en": "[company_name] — Already a year!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Déjà un an! Merci pour votre confiance, [client_first_name]. Besoin d'une retouche? [company_name] est là. Répondez STOP pour vous désabonner.",
          "body_en": "Already a year! Thank you for your trust, [client_first_name]. Need a touch-up? [company_name] is here. Reply STOP to unsubscribe."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It's been a month since we did work at your place — we hope everything still looks great!</p><p>Did you know we also offer other maintenance services? Reply to this email to learn more.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Des nouvelles de nous",
          "subject_en": "[company_name] — Checking in with you"
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
          "body": "Rappel : votre dépôt pour [company_name] est en attente. Répondez à ce message si vous avez besoin d'aide.",
          "body_en": "Reminder: your deposit for [company_name] is still pending. Reply to this message if you need any help."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Thank you [client_first_name]!</h2><p>Your deposit has been received and your spot on the schedule is reserved.</p><p>We'll be in touch with the appointment details.</p><p>Talk soon,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dépôt reçu, merci!",
          "subject_en": "[company_name] — Deposit received, thank you!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Dépôt bien reçu — merci [client_first_name]! Votre place est réservée. — [company_name]",
          "body_en": "Deposit received — thank you [client_first_name]! Your spot is reserved. — [company_name]"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Thank you for accepting our quote!</p><p>To reserve your spot on the schedule, a deposit is required. Reply to this email if you have any questions about payment.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dépôt requis pour réserver votre place",
          "subject_en": "[company_name] — Deposit required to reserve your spot"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Merci d'avoir accepté la soumission de [company_name]! Un dépôt est requis pour réserver votre place à l'horaire.",
          "body_en": "Thanks for accepting [company_name]'s quote! A deposit is required to reserve your spot on the schedule."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you an estimate recently and wanted to follow up.</p><p>Any questions? Just reply to this email — we'd be happy to answer them.</p><p>Best regards,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Suivi de votre devis",
          "subject_en": "[company_name] — Following up on your estimate"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> has been unpaid for two weeks.</p><p>Please settle it soon. If there's an issue, reply to this email and we'll find a solution.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] impayée depuis 2 semaines",
          "subject_en": "[company_name] — Invoice [invoice_number] unpaid for 2 weeks"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], rappel : votre facture de [company_name] est impayée depuis 2 semaines. Répondez à ce message pour toute question.",
          "body_en": "Hi [client_first_name], reminder: your invoice from [company_name] has been unpaid for 2 weeks. Reply to this message with any questions."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a friendly reminder: invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is awaiting payment.</p><p>If you've already paid, please disregard this message.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : facture [invoice_number]",
          "subject_en": "[company_name] — Reminder: invoice [invoice_number]"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> has been overdue for 30 days.</p><p>Please settle it without further delay, or contact us to arrange a payment plan.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] en souffrance (30 jours)",
          "subject_en": "[company_name] — Invoice [invoice_number] overdue (30 days)"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre facture de [company_name] est en souffrance depuis 30 jours. Merci de la régler rapidement ou de nous contacter.",
          "body_en": "Hi [client_first_name], your invoice from [company_name] has been overdue for 30 days. Please settle it soon or get in touch with us."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is still awaiting payment.</p><p>If you've already paid, please disregard this message.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : facture [invoice_number]",
          "subject_en": "[company_name] — Reminder: invoice [invoice_number]"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], petit rappel : votre facture de [company_name] est en attente de paiement.",
          "body_en": "Hi [client_first_name], just a reminder: your invoice from [company_name] is awaiting payment."
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> has been pending for a week.</p><p>Please settle it as soon as possible, or reply to this email if something isn't right.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Facture [invoice_number] en attente depuis 7 jours",
          "subject_en": "[company_name] — Invoice [invoice_number] pending for 7 days"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], votre facture de [company_name] est toujours en attente. Merci de la régler quand vous pouvez!",
          "body_en": "Hi [client_first_name], your invoice from [company_name] is still pending. Please settle it whenever you can!"
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
          "body": "Rappel : votre rendez-vous avec [company_name] est demain à [appointment_time]. Répondez à ce message si vous devez le déplacer.",
          "body_en": "Reminder: your appointment with [company_name] is tomorrow at [appointment_time]. Reply to this message if you need to reschedule."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est <strong>demain</strong>, le [appointment_date] à [appointment_time].</p><p>Un empêchement? Répondez à ce courriel et on trouvera un autre moment.</p><p>À demain!<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is <strong>tomorrow</strong>, [appointment_date] at [appointment_time].</p><p>Something came up? Reply to this email and we'll find another time.</p><p>See you tomorrow!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre rendez-vous est demain",
          "subject_en": "[company_name] — Your appointment is tomorrow"
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
          "body": "C'est aujourd'hui! Votre rendez-vous avec [company_name] est à [appointment_time]. On s'en vient!",
          "body_en": "It's today! Your appointment with [company_name] is at [appointment_time]. We're on our way!"
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
          "body": "Rappel : votre rendez-vous avec [company_name] est dans une semaine, le [appointment_date] à [appointment_time].",
          "body_en": "Reminder: your appointment with [company_name] is in one week, on [appointment_date] at [appointment_time]."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Petit rappel : votre rendez-vous est prévu le <strong>[appointment_date]</strong> à <strong>[appointment_time]</strong>.</p><p>Répondez à ce courriel si vous avez des questions ou devez déplacer le rendez-vous.</p><p>À bientôt!<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a reminder: your appointment is scheduled for <strong>[appointment_date]</strong> at <strong>[appointment_time]</strong>.</p><p>Reply to this email if you have any questions or need to reschedule.</p><p>See you soon!<br/>[company_name]</p></div>",
          "subject": "[company_name] — Rappel : rendez-vous dans une semaine",
          "subject_en": "[company_name] — Reminder: appointment in one week"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It's been two weeks since your request — are you still looking for our services?</p><p>Just say the word and we'll put together a quote for you.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Toujours intéressé?",
          "subject_en": "[company_name] — Still interested?"
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
          "body": "Bonjour [client_first_name], avez-vous toujours besoin de nos services? Répondez à ce message et on s'occupe de vous. — [company_name]",
          "body_en": "Hi [client_first_name], do you still need our services? Reply to this message and we'll take care of you. — [company_name]"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>You reached out to us recently and we want to make sure we don't leave you without an answer.</p><p>Reply to this email and we'll take care of you right away.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — On pense à vous",
          "subject_en": "[company_name] — Thinking of you"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It's been a while! If you have any maintenance or cleaning projects, we'd be happy to help.</p><p>Reply to this email for a no-obligation quote.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Toujours des projets?",
          "subject_en": "[company_name] — Any projects on the go?"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], ça fait un bout! Si vous avez des projets, [company_name] est là. Répondez STOP pour vous désabonner.",
          "body_en": "Hi [client_first_name], it's been a while! If you have any projects, [company_name] is here. Reply STOP to unsubscribe."
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
          "body": "Bonjour [client_first_name], on a manqué notre rendez-vous. Répondez à ce message pour reprendre un moment qui vous convient. — [company_name]",
          "body_en": "Hi [client_first_name], we missed our appointment. Reply to this message to set up a time that works for you. — [company_name]"
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
    "description": "Remercier le client pour son paiement",
    "trigger_event": "invoice.paid",
    "conditions": {
      "payment_type": {
        "neq": "deposit"
      }
    },
    "delay_seconds": 0,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Paiement reçu — merci [client_first_name]! — [company_name]",
          "body_en": "Payment received — thank you [client_first_name]! — [company_name]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "subject": "Paiement reçu — merci [client_first_name]!",
          "subject_en": "Payment received — thank you [client_first_name]!",
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2 style=\"color:#1a1a1a;font-size:18px;\">Merci [client_first_name]!</h2><p style=\"color:#333;line-height:1.6;\">Nous confirmons la réception de votre paiement pour la facture [invoice_number].</p><p style=\"color:#333;line-height:1.6;\">Merci de votre confiance.</p><p style=\"color:#333;line-height:1.6;\">[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2 style=\"color:#1a1a1a;font-size:18px;\">Thank you [client_first_name]!</h2><p style=\"color:#333;line-height:1.6;\">We confirm receipt of your payment for invoice [invoice_number].</p><p style=\"color:#333;line-height:1.6;\">Thank you for your trust.</p><p style=\"color:#333;line-height:1.6;\">[company_name]</p></div>"
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
    "description": "Suivi de satisfaction le lendemain du service",
    "trigger_event": "job.completed",
    "conditions": {},
    "delay_seconds": 86400,
    "actions": [
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], est-ce que tout est à votre goût depuis notre passage? Répondez à ce message si quelque chose ne va pas. — [company_name]",
          "body_en": "Hi [client_first_name], is everything to your liking since our visit? Reply to this message if anything isn't right. — [company_name]"
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
          "body": "Bonjour [client_first_name], dernière relance pour votre soumission de [company_name]. On serait contents de travailler avec vous!",
          "body_en": "Hi [client_first_name], one last follow-up on your quote from [company_name]. We'd love to work with you!"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On voulait faire un dernier suivi au sujet de votre soumission.</p><p>Si le moment n'est pas bon, aucun souci — répondez-nous et on se reprendra quand ça vous conviendra.</p><p>Merci,<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We wanted to do one last follow-up about your quote.</p><p>If now isn't the right time, no problem — just reply and we'll reconnect whenever it suits you.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Dernière relance pour votre soumission",
          "subject_en": "[company_name] — Final follow-up on your quote"
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
          "body": "Bonjour [client_first_name], avez-vous eu le temps de regarder notre soumission? Répondez à ce message si vous avez des questions. — [company_name]",
          "body_en": "Hi [client_first_name], did you get a chance to look over our quote? Reply to this message if you have any questions. — [company_name]"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>On vous a envoyé une soumission hier et on voulait s'assurer que vous l'avez bien reçue.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d'y répondre.</p><p>Merci,<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote yesterday and wanted to make sure it reached you.</p><p>Any questions? Just reply to this email — we'd be happy to answer them.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Suivi de votre soumission",
          "subject_en": "[company_name] — Following up on your quote"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We'll keep your file open a while longer in case you'd like to move ahead with your quote.</p><p>Reply to this email anytime.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — On garde votre dossier ouvert",
          "subject_en": "[company_name] — We're keeping your file open"
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
          "body": "Bonjour [client_first_name], petit rappel pour votre soumission de [company_name]. On peut l'ajuster au besoin!",
          "body_en": "Hi [client_first_name], just a reminder about your quote from [company_name]. We can adjust it if needed!"
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Petit rappel au sujet de la soumission qu'on vous a envoyée.</p><p>Si un détail ne convient pas, on peut l'ajuster — dites-le-nous simplement.</p><p>Merci,<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a reminder about the quote we sent you.</p><p>If any detail doesn't work for you, we can adjust it — just let us know.</p><p>Thank you,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre soumission vous attend",
          "subject_en": "[company_name] — Your quote is waiting for you"
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
          "body": "Bonjour [client_first_name], votre soumission de [company_name] est toujours valide. Des questions? Répondez à ce message.",
          "body_en": "Hi [client_first_name], your quote from [company_name] is still valid. Any questions? Reply to this message."
        }
      },
      {
        "type": "send_email",
        "config": {
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Bonjour [client_first_name],</h2><p>Votre soumission est toujours valide et on garde votre place.</p><p>Si vous avez des questions ou souhaitez aller de l'avant, répondez à ce courriel.</p><p>Au plaisir,<br/>[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your quote is still valid and we're holding your spot.</p><p>If you have any questions or would like to move ahead, reply to this email.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Votre soumission est toujours valide",
          "subject_en": "[company_name] — Your quote is still valid"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It's been three months since our last visit — some maintenance might be due.</p><p>Reply to this email and we'll find you a spot on the schedule.</p><p>Looking forward,<br/>[company_name]</p></div>",
          "subject": "[company_name] — Déjà 3 mois!",
          "subject_en": "[company_name] — Already 3 months!"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "Bonjour [client_first_name], déjà 3 mois! Un entretien serait peut-être dû. — [company_name] Répondez STOP pour vous désabonner.",
          "body_en": "Hi [client_first_name], already 3 months! Some maintenance might be due. — [company_name] Reply STOP to unsubscribe."
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
          "body": "Bonjour [client_first_name], un avis Google nous aiderait énormément : [google_review_url] Merci encore! — [company_name]",
          "body_en": "Hi [client_first_name], a Google review would help us out a lot: [google_review_url] Thanks again! — [company_name]"
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
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>The season is coming up — now's a good time to get your property ready.</p><p>Reply to this email for a quick, no-obligation quote.</p><p>Talk soon,<br/>[company_name]</p></div>",
          "subject": "[company_name] — La saison s'en vient",
          "subject_en": "[company_name] — The season is coming"
        }
      },
      {
        "type": "send_sms",
        "config": {
          "body": "La saison avance! [company_name] peut préparer votre propriété. Répondez à ce message pour un devis. Répondez STOP pour vous désabonner.",
          "body_en": "The season is coming up! [company_name] can get your property ready. Reply to this message for a quote. Reply STOP to unsubscribe."
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
          "body": "Bonjour [client_first_name], on ne vous oublie pas! Toujours intéressé par nos services? — [company_name]",
          "body_en": "Hi [client_first_name], we haven't forgotten you! Still interested in our services? — [company_name]"
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
          "body": "Merci de faire affaire avec [company_name], [client_first_name]! Si tout n'est pas parfait, répondez à ce message.",
          "body_en": "Thank you for doing business with [company_name], [client_first_name]! If anything isn't perfect, reply to this message."
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
          "body": "Bonjour [client_first_name], merci d'avoir contacté [company_name]! On revient vers vous très vite.",
          "body_en": "Hi [client_first_name], thank you for contacting [company_name]! We'll get back to you very soon."
        }
      },
      {
        "type": "send_email",
        "config": {
          "subject": "Merci d'avoir contacté [company_name]",
          "subject_en": "Thank you for contacting [company_name]",
          "body": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2 style=\"color:#1a1a1a;font-size:18px;\">Bonjour [client_first_name],</h2><p style=\"color:#333;line-height:1.6;\">Merci d'avoir communiqué avec nous. Nous avons bien reçu votre demande et nous revenons vers vous très rapidement.</p><p style=\"color:#333;line-height:1.6;\">Si votre demande est urgente, répondez à ce courriel — nous la traiterons en priorité.</p><p style=\"color:#333;line-height:1.6;\">[company_name]</p></div>",
          "body_en": "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2 style=\"color:#1a1a1a;font-size:18px;\">Hi [client_first_name],</h2><p style=\"color:#333;line-height:1.6;\">Thank you for reaching out to us. We've received your request and will get back to you very quickly.</p><p style=\"color:#333;line-height:1.6;\">If your request is urgent, reply to this email — we'll handle it as a priority.</p><p style=\"color:#333;line-height:1.6;\">[company_name]</p></div>"
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
