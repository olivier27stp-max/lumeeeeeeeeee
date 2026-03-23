/* ═══════════════════════════════════════════════════════════════
   Automation Presets — Predefined automation rules.
   Each preset defines a trigger, conditions, actions, and delay.
   Orgs activate presets from the Automations UI.
   ═══════════════════════════════════════════════════════════════ */

export interface AutomationPreset {
  key: string;
  name_en: string;
  name_fr: string;
  description_en: string;
  description_fr: string;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, any> }>;
}

// ── 1. Google Review ────────────────────────────────────────

export const GOOGLE_REVIEW_PRESET: AutomationPreset = {
  key: 'google_review',
  name_en: 'Google Review Request',
  name_fr: 'Demande d\'avis Google',
  description_en: 'Send a satisfaction survey after job completion. Happy clients (4-5 stars) are invited to leave a Google review.',
  description_fr: 'Envoie un sondage de satisfaction après la fin d\'un travail. Les clients satisfaits (4-5 étoiles) sont invités à laisser un avis Google.',
  trigger_event: 'job.completed',
  conditions: {},
  delay_seconds: 2 * 60 * 60, // 2 hours
  actions: [
    {
      type: 'request_review',
      config: {},
    },
  ],
};

// ── 2. Estimate Follow-Up (3 days) ─────────────────────────

export const ESTIMATE_FOLLOWUP_PRESET: AutomationPreset = {
  key: 'estimate_followup',
  name_en: 'Estimate Follow-Up (3 days)',
  name_fr: 'Relance devis (3 jours)',
  description_en: 'Send a follow-up email 3 days after an estimate is sent, if not yet accepted or rejected.',
  description_fr: 'Envoie un courriel de relance 3 jours après l\'envoi d\'un devis, si pas encore accepté ou refusé.',
  trigger_event: 'estimate.sent',
  conditions: {},
  delay_seconds: 3 * 24 * 60 * 60, // 3 days
  actions: [
    {
      type: 'send_email',
      config: {
        subject: '[company_name] - Following up on your estimate',
        body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2>Hi [client_first_name],</h2>
          <p>We sent you an estimate a few days ago and wanted to follow up.</p>
          <p>If you have any questions or would like to discuss the details, please don't hesitate to reach out.</p>
          <p>We'd love to help you with your project!</p>
          <p>Best regards,<br/>[company_name]</p>
        </div>`,
      },
    },
    {
      type: 'send_sms',
      config: {
        body: 'Hi [client_first_name], just following up on the estimate we sent. Let us know if you have any questions! - [company_name]',
      },
    },
    {
      type: 'log_activity',
      config: {
        event_type: 'follow_up_sent',
        metadata: { type: 'estimate_followup', method: 'email+sms' },
      },
    },
  ],
};

// ── 3. Appointment Reminders ────────────────────────────────

export const APPOINTMENT_REMINDER_IMMEDIATE: AutomationPreset = {
  key: 'appointment_confirmation',
  name_en: 'Appointment Confirmation',
  name_fr: 'Confirmation de rendez-vous',
  description_en: 'Send a confirmation email/SMS immediately after an appointment is created.',
  description_fr: 'Envoie un email/SMS de confirmation immédiatement après la création d\'un rendez-vous.',
  trigger_event: 'appointment.created',
  conditions: {},
  delay_seconds: 0,
  actions: [
    {
      type: 'send_email',
      config: {
        subject: '[company_name] - Appointment Confirmed',
        body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2>Hi [client_first_name],</h2>
          <p>Your appointment has been confirmed:</p>
          <ul>
            <li><strong>Date:</strong> [appointment_date]</li>
            <li><strong>Time:</strong> [appointment_time]</li>
            <li><strong>Location:</strong> [appointment_address]</li>
          </ul>
          <p>If you need to reschedule, please contact us.</p>
          <p>See you soon!<br/>[company_name]</p>
        </div>`,
      },
    },
    {
      type: 'send_sms',
      config: {
        body: 'Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!',
      },
    },
  ],
};

export const APPOINTMENT_REMINDER_7DAYS: AutomationPreset = {
  key: 'appointment_reminder_7d',
  name_en: 'Appointment Reminder (7 days before)',
  name_fr: 'Rappel de rendez-vous (7 jours avant)',
  description_en: 'Send a reminder 7 days before the appointment.',
  description_fr: 'Envoie un rappel 7 jours avant le rendez-vous.',
  trigger_event: 'appointment.created',
  conditions: {},
  delay_seconds: -7, // Special: negative = days before event
  actions: [
    {
      type: 'send_email',
      config: {
        subject: '[company_name] - Appointment Reminder (1 week)',
        body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2>Hi [client_first_name],</h2>
          <p>This is a friendly reminder that your appointment is coming up in one week:</p>
          <ul>
            <li><strong>Date:</strong> [appointment_date]</li>
            <li><strong>Time:</strong> [appointment_time]</li>
            <li><strong>Location:</strong> [appointment_address]</li>
          </ul>
          <p>See you soon!<br/>[company_name]</p>
        </div>`,
      },
    },
    {
      type: 'send_sms',
      config: {
        body: 'Reminder: Your appointment with [company_name] is in 1 week — [appointment_date] at [appointment_time].',
      },
    },
  ],
};

export const APPOINTMENT_REMINDER_1DAY: AutomationPreset = {
  key: 'appointment_reminder_1d',
  name_en: 'Appointment Reminder (1 day before)',
  name_fr: 'Rappel de rendez-vous (1 jour avant)',
  description_en: 'Send a reminder 1 day before the appointment.',
  description_fr: 'Envoie un rappel 1 jour avant le rendez-vous.',
  trigger_event: 'appointment.created',
  conditions: {},
  delay_seconds: -1, // Special: negative = days before event
  actions: [
    {
      type: 'send_email',
      config: {
        subject: '[company_name] - Appointment Tomorrow!',
        body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2>Hi [client_first_name],</h2>
          <p>Just a reminder that your appointment is <strong>tomorrow</strong>:</p>
          <ul>
            <li><strong>Date:</strong> [appointment_date]</li>
            <li><strong>Time:</strong> [appointment_time]</li>
            <li><strong>Location:</strong> [appointment_address]</li>
          </ul>
          <p>See you there!<br/>[company_name]</p>
        </div>`,
      },
    },
    {
      type: 'send_sms',
      config: {
        body: 'Reminder: Your appointment with [company_name] is tomorrow at [appointment_time]. See you there!',
      },
    },
  ],
};

// ── 4. Invoice Reminders ────────────────────────────────────

function invoiceReminderPreset(
  key: string,
  daysAfterDue: number,
  nameEn: string,
  nameFr: string,
  extraActions: Array<{ type: string; config: Record<string, any> }> = [],
): AutomationPreset {
  const isUrgent = daysAfterDue >= 15;
  return {
    key,
    name_en: nameEn,
    name_fr: nameFr,
    description_en: `Send a payment reminder ${daysAfterDue} day(s) after the invoice due date.`,
    description_fr: `Envoie un rappel de paiement ${daysAfterDue} jour(s) après la date d'échéance.`,
    trigger_event: 'invoice.overdue',
    conditions: { days_overdue: daysAfterDue },
    delay_seconds: 0, // The scheduler detects overdue invoices
    actions: [
      {
        type: 'send_email',
        config: {
          subject: isUrgent
            ? '[company_name] - Urgent: Invoice [invoice_number] Past Due'
            : '[company_name] - Payment Reminder: Invoice [invoice_number]',
          body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2>Hi [client_first_name],</h2>
            <p>${isUrgent ? 'This is an urgent reminder that' : 'Just a friendly reminder that'} invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> ${isUrgent ? 'is now significantly past due' : 'is past due'}.</p>
            <p>Please arrange payment at your earliest convenience.</p>
            <p>If you've already sent payment, please disregard this message.</p>
            <p>Thank you,<br/>[company_name]</p>
          </div>`,
        },
      },
      {
        type: 'send_sms',
        config: {
          body: `${isUrgent ? 'Urgent: ' : ''}Reminder: Invoice [invoice_number] ([invoice_total]) is past due. Please arrange payment. - [company_name]`,
        },
      },
      {
        type: 'log_activity',
        config: {
          event_type: 'invoice_reminded',
          metadata: { days_overdue: daysAfterDue },
        },
      },
      ...extraActions,
    ],
  };
}

export const INVOICE_REMINDER_1 = invoiceReminderPreset(
  'invoice_reminder_1d', 1,
  'Invoice Reminder (J+1)', 'Relance facture (J+1)',
);
export const INVOICE_REMINDER_3 = invoiceReminderPreset(
  'invoice_reminder_3d', 3,
  'Invoice Reminder (J+3)', 'Relance facture (J+3)',
);
export const INVOICE_REMINDER_5 = invoiceReminderPreset(
  'invoice_reminder_5d', 5,
  'Invoice Reminder (J+5)', 'Relance facture (J+5)',
);
export const INVOICE_REMINDER_15 = invoiceReminderPreset(
  'invoice_reminder_15d', 15,
  'Invoice Reminder (J+15)', 'Relance facture (J+15)',
);
export const INVOICE_REMINDER_30 = invoiceReminderPreset(
  'invoice_reminder_30d', 30,
  'Invoice Reminder (J+30)', 'Relance facture (J+30)',
  [
    {
      type: 'create_notification',
      config: {
        title: 'Invoice [invoice_number] — 30 days overdue',
        body: '[client_name] has an invoice overdue for 30 days ([invoice_total]). Please follow up.',
      },
    },
    {
      type: 'create_task',
      config: {
        title: 'Follow up: Invoice [invoice_number] — 30 days overdue',
        description: 'Client [client_name] has not paid invoice [invoice_number] ([invoice_total]) for 30 days.',
      },
    },
  ],
);

// ── 11. Pipeline: New Lead Welcome ──────────────────────────

export const PIPELINE_NEW_LEAD_WELCOME: AutomationPreset = {
  key: 'pipeline_new_lead_welcome',
  name_en: 'New Lead Welcome SMS',
  name_fr: 'SMS de bienvenue nouveau lead',
  description_en: 'Send a welcome SMS when a new lead is created.',
  description_fr: 'Envoie un SMS de bienvenue quand un nouveau lead est cree.',
  trigger_event: 'lead.created',
  conditions: {},
  delay_seconds: 0,
  actions: [
    {
      type: 'send_sms',
      config: {
        message: 'Hi {client_name}! Thank you for reaching out to {company_name}. We will get back to you shortly with a quote.',
      },
    },
    {
      type: 'create_notification',
      config: {
        title: 'New lead: {client_name}',
        body: 'A new lead was created. Follow up to convert.',
      },
    },
  ],
};

// ── 12. Pipeline: Deal moved to Follow-up — create task ─────

export const PIPELINE_FOLLOWUP_TASK: AutomationPreset = {
  key: 'pipeline_followup_task',
  name_en: 'Follow-up Reminder Task',
  name_fr: 'Tache rappel de suivi',
  description_en: 'Create a follow-up task when a deal moves to Follow-up 1 stage.',
  description_fr: 'Cree une tache de rappel quand un deal passe en etape Suivi 1.',
  trigger_event: 'pipeline_deal.stage_changed',
  conditions: { new_stage: 'no_response' },
  delay_seconds: 0,
  actions: [
    {
      type: 'create_task',
      config: {
        title: 'Follow up with {client_name}',
        description: 'Deal moved to Follow-up 1. Contact the lead to discuss next steps.',
        due_days: 2,
      },
    },
  ],
};

// ── 13. Pipeline: Quote sent — move deal to Follow-up 2 ─────

export const PIPELINE_QUOTE_SENT_STAGE: AutomationPreset = {
  key: 'pipeline_quote_sent_stage',
  name_en: 'Move to Follow-up 2 on Quote Sent',
  name_fr: 'Passer en Suivi 2 apres envoi de devis',
  description_en: 'Automatically move the pipeline deal to Follow-up 2 when a quote is sent.',
  description_fr: 'Deplace automatiquement le deal en Suivi 2 quand un devis est envoye.',
  trigger_event: 'quote.sent',
  conditions: {},
  delay_seconds: 0,
  actions: [
    {
      type: 'update_status',
      config: {
        table: 'pipeline_deals',
        field: 'stage',
        value: 'quote_sent',
        match_field: 'lead_id',
        match_source: 'lead_id',
      },
    },
    {
      type: 'create_notification',
      config: {
        title: 'Quote sent',
        body: 'Quote sent to {client_name}. Deal moved to Follow-up 2.',
      },
    },
  ],
};

// ── 14. Pipeline: Quote approved — move to Closed + create job ──

export const PIPELINE_QUOTE_APPROVED: AutomationPreset = {
  key: 'pipeline_quote_approved',
  name_en: 'Auto-close Deal on Quote Approved',
  name_fr: 'Fermer le deal automatiquement quand devis approuve',
  description_en: 'Move the deal to Closed and notify the team when a quote is approved.',
  description_fr: 'Deplace le deal en Ferme et notifie l equipe quand un devis est approuve.',
  trigger_event: 'quote.approved',
  conditions: {},
  delay_seconds: 0,
  actions: [
    {
      type: 'update_status',
      config: {
        table: 'pipeline_deals',
        field: 'stage',
        value: 'closed',
        match_field: 'lead_id',
        match_source: 'lead_id',
      },
    },
    {
      type: 'create_notification',
      config: {
        title: 'Quote approved!',
        body: '{client_name} approved the quote. Deal moved to Closed.',
      },
    },
  ],
};

// ── 15. Pipeline: Stale lead follow-up (3 days no action) ───

export const PIPELINE_STALE_LEAD: AutomationPreset = {
  key: 'pipeline_stale_lead',
  name_en: 'Stale Lead Reminder (3 days)',
  name_fr: 'Rappel lead inactif (3 jours)',
  description_en: 'Send a reminder if a new lead has not been followed up within 3 days.',
  description_fr: 'Envoie un rappel si un nouveau lead n a pas ete suivi dans les 3 jours.',
  trigger_event: 'lead.created',
  conditions: {},
  delay_seconds: 3 * 24 * 60 * 60, // 3 days
  actions: [
    {
      type: 'create_notification',
      config: {
        title: 'Stale lead: {client_name}',
        body: 'This lead was created 3 days ago and has not moved from New. Follow up now!',
      },
    },
    {
      type: 'create_task',
      config: {
        title: 'Follow up with {client_name} — stale lead',
        description: 'Lead has been in New stage for 3 days without action.',
        due_days: 1,
      },
    },
  ],
};

// ── All presets ─────────────────────────────────────────────

export const ALL_PRESETS: AutomationPreset[] = [
  GOOGLE_REVIEW_PRESET,
  ESTIMATE_FOLLOWUP_PRESET,
  APPOINTMENT_REMINDER_IMMEDIATE,
  APPOINTMENT_REMINDER_7DAYS,
  APPOINTMENT_REMINDER_1DAY,
  INVOICE_REMINDER_1,
  INVOICE_REMINDER_3,
  INVOICE_REMINDER_5,
  INVOICE_REMINDER_15,
  INVOICE_REMINDER_30,
  PIPELINE_NEW_LEAD_WELCOME,
  PIPELINE_FOLLOWUP_TASK,
  PIPELINE_QUOTE_SENT_STAGE,
  PIPELINE_QUOTE_APPROVED,
  PIPELINE_STALE_LEAD,
];
