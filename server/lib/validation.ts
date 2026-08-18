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

// ─── Password policy (server-side enforcement) ───────────────────────────────

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .refine((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p), {
    message: 'Password must contain uppercase, lowercase, and a number.',
  })
  .refine((p) => /[^a-zA-Z0-9]/.test(p), {
    message: 'Password must contain at least one special character.',
  });

// ─── Leads ────────────────────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  full_name: z.string().trim().min(1, 'full_name is required.'),
  email: optionalString,
  phone: optionalString,
  title: optionalString,
  notes: optionalString,
  address: optionalString,
  value: z.number().min(0, 'Value cannot be negative.').max(999_999_999, 'Value too large.').optional().default(0),
  orgId: optionalOrgId,
});

export const softDeleteLeadSchema = z.object({
  leadId: z.string().trim().min(1, 'leadId is required.'),
  orgId: optionalOrgId,
});

export const softDeleteClientSchema = z.object({
  clientId: z.string().trim().min(1, 'clientId is required.'),
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
  milestoneId: z.string().trim().min(1).optional().nullable(),
  visitId: z.string().trim().min(1).optional().nullable(),
  orgId: optionalOrgId,
});

// ─── Geocode ──────────────────────────────────────────────────────────────────

export const geocodeJobSchema = z.object({
  jobId: z.string().trim().min(1, 'jobId is required.'),
});

export const placesAutocompleteSchema = z.object({
  input: z.string().trim().min(3, 'input too short.').max(200),
  countries: z.array(z.string().trim().toLowerCase().length(2)).max(5).optional(),
  language: z.string().trim().max(10).optional(),
  sessionToken: z.string().trim().max(64).optional(),
  // Types de lieux Google (ex.: ['locality'] pour suggérer des villes).
  primaryTypes: z.array(z.string().trim().max(40)).max(5).optional(),
});

export const placesDetailsSchema = z.object({
  placeId: z.string().trim().min(5).max(300),
  language: z.string().trim().max(10).optional(),
  sessionToken: z.string().trim().max(64).optional(),
});

// geocode-batch has no required body fields (it fetches jobs internally)

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messageSendSchema = z.object({
  phone_number: z.string().trim().min(1, 'phone_number is required.'),
  message_text: z.string().trim().min(1, 'message_text is required.'),
  client_id: optionalString,
  client_name: optionalString,
});

// ─── Lume Agent ───────────────────────────────────────────────────────────────

export const agentChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000, 'Message too long.'),
      }),
    )
    .min(1, 'At least one message is required.')
    .max(40, 'Conversation too long.'),
  language: z.enum(['fr', 'en']).optional(),
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

// ─── Support ────────────────────────────────────────────────────────────────

export const supportRequestSchema = z.object({
  subject: z.string().trim().min(3, 'Please describe your issue in a few words.').max(200),
  message: z.string().trim().min(10, 'Please add a bit more detail (at least 10 characters).').max(5000),
  category: z.enum(['question', 'bug', 'billing', 'feature', 'other']).optional(),
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
  suppressImmediate: z.boolean().optional(),
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
  logo_url: z.string().trim().url().nullable().optional(),
  custom_fields: z.array(formFieldSchema).optional().default([]),
  notify_email: z.boolean().optional(),
  notify_in_app: z.boolean().optional(),
});

// PATCH /request-forms/submissions/:id — assessment scheduling + archive.
// Every field optional; only provided keys are written.
export const updateFormSubmissionSchema = z.object({
  assessment_start_at: z.string().datetime({ offset: true }).nullable().optional(),
  assessment_end_at: z.string().datetime({ offset: true }).nullable().optional(),
  assessment_team_id: z.string().uuid().nullable().optional(),
  assessment_user_id: z.string().uuid().nullable().optional(),
  assessment_instructions: z.string().trim().max(5000).nullable().optional(),
  archived: z.boolean().optional(),
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
  photos: z.array(z.string().url()).max(20, 'Too many photos (max 20).').optional().default([]),
  // Honeypot anti-bot : champ caché en CSS, invisible pour un humain. Un bot
  // qui remplit tous les champs le remplira aussi → soumission rejetée
  // silencieusement (voir la route). Toujours vide pour un vrai visiteur.
  website: optionalString,
});

// ─── AI / Agent ─────────────────────────────────────────────────
// Note: agentChatSchema (POST /agent/chat) is declared above, near the
// other Lume Agent schemas. The duplicate that lived here was removed —
// it shadowed the real one and broke the esbuild transform.

export const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(50_000, 'Message content too long.'),
  })).min(1, 'At least one message is required.'),
  model: optionalString,
}).passthrough();

// ─── Goals ──────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  title: z.string().trim().min(1, 'title is required.'),
  target_value: z.number().min(0).max(999_999_999),
  metric_type: z.string().trim().min(1, 'metric_type is required.'),
  period: z.string().trim().optional(),
}).passthrough();

// ─── Feature Flags ──────────────────────────────────────────────

export const updateFeatureFlagSchema = z.object({
  enabled: z.boolean(),
}).passthrough();

// ─── Billing ────────────────────────────────────────────────────

export const billingSubscribeSchema = z.object({
  planId: z.string().trim().min(1, 'planId is required.'),
  promoCode: optionalString,
}).passthrough();

// ─── Commissions ────────────────────────────────────────────────

export const commissionActionSchema = z.object({
  id: z.string().trim().optional(),
}).passthrough();

// ─── Elevation (height tool relay) ──────────────────────────────

export const elevationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  surface: z.enum(['ground', 'roof', 'wall-distance']),
  // wall-distance : (lat,lng) = caméra Street View, cible = propriété
  target_lat: z.number().min(-90).max(90).optional(),
  target_lng: z.number().min(-180).max(180).optional(),
});

// ─── Courses (LMS) ──────────────────────────────────────────────

const optionalStorageUrl = z.string().trim().max(2000).optional().nullable();
const uuidArray = z.array(z.string().uuid()).max(500);

export const upsertCourseSchema = z.object({
  title: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(10_000).optional().nullable(),
  cover_image: optionalStorageUrl,
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().trim().max(100).optional().nullable(),
  visibility: z.enum(['all', 'assigned']).optional(),
  target_roles: z.array(z.string().trim().max(50)).max(50).optional(),
  target_user_ids: uuidArray.optional(),
}).passthrough();

export const upsertCourseModuleSchema = z.object({
  title: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
}).passthrough();

export const upsertCourseLessonSchema = z.object({
  title: z.string().trim().max(500).optional().nullable(),
  content_type: z.enum(['video', 'embed', 'text', 'pdf', 'link']).optional(),
  video_url: optionalStorageUrl,
  embed_url: optionalStorageUrl,
  text_content: z.string().max(200_000).optional().nullable(),
  attachments: z.array(z.object({
    name: z.string().trim().max(300),
    url: z.string().trim().max(2000),
    type: z.string().trim().max(50),
  }).passthrough()).max(50).optional(),
  duration_min: z.number().int().min(0).max(10_000).optional().nullable(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
}).passthrough();

export const courseReorderSchema = z.object({
  order: z.array(z.string().uuid()).max(500),
});

export const courseAssignSchema = z.object({
  user_ids: uuidArray.optional(),
  team_ids: uuidArray.optional(),
}).passthrough();

export const courseProgressSchema = z.object({
  course_id: z.string().uuid().optional().nullable(),
  lesson_id: z.string().uuid('lesson_id must be a valid UUID.'),
  completed: z.boolean().optional().default(false),
}).passthrough();

// ─── Generic passthrough schemas for loose validation ───────────

/** Validates that a request body is a non-empty object (catches nulls, arrays, primitives) */
export const nonEmptyBodySchema = z.object({}).passthrough()
  .refine(obj => Object.keys(obj).length > 0, 'Request body cannot be empty.');

/** Validates that an ID field is present */
export const idRequiredSchema = z.object({
  id: z.string().trim().min(1, 'id is required.'),
}).passthrough();
