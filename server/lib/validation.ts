import { z, ZodSchema, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns Express middleware that validates `req.body` against the given Zod schema.
 * On success the parsed (cleaned) data replaces `req.body` and `next()` is called.
 * On failure a 400 response is returned with the validation error details.
 */
export function validate<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const zodError = result.error as ZodError;
      return res.status(400).json({
        error: zodError.issues.map((i) => i.message).join('; '),
        details: zodError.issues,
      });
    }
    req.body = result.data;
    return next();
  };
}

// ─── Reusable pieces ──────────────────────────────────────────────────────────

const optionalString = z.string().trim().optional().nullable();
const optionalOrgId = z.string().uuid().optional().nullable();

// ─── Leads ────────────────────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  full_name: z.string().trim().min(1, 'full_name is required.'),
  email: optionalString,
  phone: optionalString,
  title: optionalString,
  notes: optionalString,
  address: optionalString,
  value: z.number().optional().default(0),
  orgId: optionalOrgId,
});

export const softDeleteLeadSchema = z.object({
  leadId: z.string().trim().min(1, 'leadId is required.'),
  orgId: optionalOrgId,
});

export const softDeleteDealSchema = z.object({
  dealId: z.string().trim().min(1, 'dealId is required.'),
  alsoDeleteLead: z.boolean().optional().default(false),
});

export const updateLeadStatusSchema = z.object({
  leadId: z.string().trim().min(1, 'leadId is required.'),
  status: z.enum(['new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost', 'new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'closed', 'lost']),
  orgId: optionalOrgId,
});

export const convertLeadToJobSchema = z.object({
  leadId: z.string().trim().min(1, 'leadId is required.'),
  jobTitle: z.string().trim().optional(),
  orgId: optionalOrgId,
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const assignJobToTeamSchema = z.object({
  jobId: z.string().trim().min(1, 'jobId is required.'),
  teamId: z.string().trim().min(1, 'teamId is required.'),
});

// ─── Invoices ─────────────────────────────────────────────────────────────────

export const invoiceFromJobSchema = z.object({
  jobId: z.string().trim().min(1, 'jobId is required.'),
  sendNow: z.boolean().optional().default(false),
  orgId: optionalOrgId,
});

// ─── Geocode ──────────────────────────────────────────────────────────────────

export const geocodeJobSchema = z.object({
  jobId: z.string().trim().min(1, 'jobId is required.'),
});

// geocode-batch has no required body fields (it fetches jobs internally)

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messageSendSchema = z.object({
  phone_number: z.string().trim().min(1, 'phone_number is required.'),
  message_text: z.string().trim().min(1, 'message_text is required.'),
  client_id: optionalString,
  client_name: optionalString,
});

// ─── Payments: keys ───────────────────────────────────────────────────────────

export const paymentKeysSchema = z.object({
  provider: z.enum(['stripe', 'paypal'], {
    error: 'provider must be stripe or paypal.',
  }),
  orgId: optionalOrgId,
  // Allow any additional key fields (stripe_secret_key, etc.) to pass through
}).passthrough();

// ─── Payments: settings ───────────────────────────────────────────────────────

export const paymentSettingsSchema = z.object({
  action: z.string().trim().min(1, 'Missing action.'),
  provider: optionalString,
  orgId: optionalOrgId,
  enabled: z.boolean().optional(),
  defaultProvider: optionalString,
  default_provider: optionalString,
}).passthrough();

// ─── Payments: provider settings (compatibility route) ────────────────────────

export const providerSettingsSchema = z.object({
  orgId: optionalOrgId,
  stripe_enabled: z.boolean().optional(),
  paypal_enabled: z.boolean().optional(),
  default_provider: optionalString,
}).passthrough();

// ─── Payments: Stripe create intent ───────────────────────────────────────────

export const stripeCreateIntentSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Missing invoiceId.'),
});

// ─── Payments: PayPal create order ────────────────────────────────────────────

export const paypalCreateOrderSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Missing invoiceId.'),
});

// ─── Payments: PayPal capture order ───────────────────────────────────────────

export const paypalCaptureOrderSchema = z.object({
  orderId: z.string().trim().min(1, 'Missing orderId.'),
});

// ─── Connect ─────────────────────────────────────────────────────────────────

export const createConnectedAccountSchema = z.object({
  orgId: optionalOrgId,
  country: z.string().length(2).optional().default('CA'),
});

export const createPaymentRequestSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Missing invoiceId.'),
  orgId: optionalOrgId,
});

// ─── Emails ────────────────────────────────────────────────────────────────────

export const sendInvoiceEmailSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Missing invoiceId.'),
  emailTemplateId: optionalString,
  subject: optionalString,
  body: optionalString,
});

export const sendQuoteEmailSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Missing invoiceId.'),
});

export const sendCustomEmailSchema = z.object({
  to: z.string().trim().email('Invalid email address.'),
  subject: z.string().trim().min(1, 'Missing subject.'),
  html: z.string().min(1, 'Missing html body.'),
});

// ─── Invoice Templates ──────────────────────────────────────────────────────

export const invoiceTemplateSchema = z.object({
  name: z.string().trim().min(1, 'name is required.'),
  title: optionalString,
  description: optionalString,
  line_items: z.any().optional(),
  taxes: z.any().optional(),
  payment_terms: optionalString,
  client_note: optionalString,
  branding: z.any().optional(),
  payment_methods: z.any().optional(),
  email_subject: optionalString,
  email_body: optionalString,
  is_default: z.boolean().optional(),
});

// ─── Email Templates ─────────────────────────────────────────────────────────

export const emailTemplateSchema = z.object({
  name: z.string().trim().min(1, 'name is required.'),
  type: z.enum(
    ['invoice_sent', 'invoice_reminder', 'quote_sent', 'review_request', 'generic'],
    { error: 'type must be one of: invoice_sent, invoice_reminder, quote_sent, review_request, generic.' },
  ),
  subject: z.string().trim().min(1, 'subject is required.'),
  body: z.string().min(1, 'body is required.'),
  variables: z.any().optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

// ─── Communications ──────────────────────────────────────────────────────────

export const sendSmsSchema = z.object({
  to: z.string().trim().min(1, 'to is required.'),
  body: z.string().trim().min(1, 'body is required.'),
  client_id: optionalString,
  job_id: optionalString,
});

export const sendEmailSchema = z.object({
  to: z.string().trim().email('Invalid email address.'),
  subject: z.string().trim().min(1, 'subject is required.'),
  body: z.string().min(1, 'body is required.'),
  client_id: optionalString,
  job_id: optionalString,
});

// ─── Automation Events ───────────────────────────────────────────────────────

export const automationEventSchema = z.object({
  eventId: z.string().trim().optional(),
  jobId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  startTime: z.string().trim().optional(),
  title: z.string().trim().optional(),
  address: z.string().trim().optional(),
}).passthrough();

// ─── Notifications ───────────────────────────────────────────────────────────

export const markNotificationReadSchema = z.object({
  notificationId: z.string().trim().min(1, 'notificationId is required.'),
});

// ─── Portal ──────────────────────────────────────────────────────────────────

export const portalLoginSchema = z.object({
  email: z.string().trim().email('Invalid email.'),
  orgId: optionalOrgId,
});

// ─── Quotes ──────────────────────────────────────────────────────────────────

export const recordQuoteViewSchema = z.object({
  invoiceId: z.string().trim().min(1, 'invoiceId is required.'),
  clientId: optionalString,
});

// ─── Surveys ─────────────────────────────────────────────────────────────────

export const submitSurveySchema = z.object({
  surveyId: z.string().trim().optional(),
  token: z.string().trim().optional(),
  rating: z.number().min(1).max(5).optional(),
  comment: z.string().trim().optional(),
}).passthrough();

// ─── Request Forms ──────────────────────────────────────────────────────────

const formFieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(['text', 'dropdown', 'multiselect', 'checkbox', 'number', 'paragraph']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  section: z.enum(['service_details', 'final_notes']),
});

export const upsertRequestFormSchema = z.object({
  title: z.string().trim().min(1, 'title is required.'),
  description: optionalString,
  success_message: z.string().trim().min(1, 'success_message is required.'),
  enabled: z.boolean().optional(),
  custom_fields: z.array(formFieldSchema).optional().default([]),
  notify_email: z.boolean().optional(),
  notify_in_app: z.boolean().optional(),
});

export const publicFormSubmissionSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required.'),
  last_name: z.string().trim().min(1, 'Last name is required.'),
  company: optionalString,
  email: z.string().trim().email('Valid email is required.'),
  phone: z.string().trim().min(1, 'Phone is required.'),
  street_address: optionalString,
  unit: optionalString,
  city: optionalString,
  country: optionalString,
  region: optionalString,
  postal_code: optionalString,
  custom_responses: z.record(z.string(), z.any()).optional().default({}),
  notes: optionalString,
});
