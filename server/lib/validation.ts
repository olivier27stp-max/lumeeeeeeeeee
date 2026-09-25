import { z, ZodSchema, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';
// Le catalogue des automatisations personnalisables vit sous src/ : c'est le
// sens de partage autorisé (server/ importe src/, jamais l'inverse — voir
// tests/frontiere-serveur-client.test.ts), déjà utilisé pour permissions.ts.
import {
  CLES_DECLENCHEURS,
  CLES_ACTIONS,
  CLES_CHAMPS_ACTION,
  champVisible,
  trouverAction,
  DELAI_MAX_SECONDES,
  DELAI_NEGATIF_MAX_SECONDES,
  ACTIONS_MAX,
  type ChampAction,
} from '../../src/lib/automationCatalogue';
import { problemesDuGraphe, type Etape } from './automationSequences';
import { INDUSTRIES_MODELES } from '../../src/lib/champs/modeles';

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
// Valeur d'attribution lue dans l'URL, jamais saisie par un humain : bornée,
// pour qu'une URL forgée ne se transforme pas en champ de texte libre.
const attributionString = z.string().trim().max(256).optional().nullable();
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

/* POST /agent/transcribe — audio du micro (base64), 60 s max ≈ 4 Mo encodés. */
export const agentTranscribeSchema = z.object({
  audio: z.string().min(100, 'Audio is empty.').max(5_600_000, 'Audio too long (60 s max).'),
  mimeType: z.enum(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac']),
  language: z.enum(['fr', 'en']).optional(),
});

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

// Réglages Lume Payments — booléens seulement, clés inconnues refusées.
export const paymentSettingsPatchSchema = z.object({
  orgId: optionalOrgId,
  quote_payments_enabled: z.boolean().optional(),
  invoice_payments_enabled: z.boolean().optional(),
  tips_enabled: z.boolean().optional(),
  wallets_enabled: z.boolean().optional(),
  require_payment_method_default: z.boolean().optional(),
  notify_owner_email: z.boolean().optional(),
}).strict();

// Pourboire choisi par le payeur sur la page publique (entier en cents ;
// le plafond réel — solde et 1 000 $ — est appliqué côté route).
export const publicTipSchema = z.object({
  tip_cents: z.number().int().min(0).max(100_000),
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

// Conversation de support (assistant IA puis humain via Slack).
export const supportChatSchema = z.object({
  ticketId: z.string().uuid().optional(),
  message: z.string().trim().min(1, 'Write a message.').max(5000),
  /** true = « Parler à un humain » dès le premier message, sans passer par l'assistant. */
  humain: z.boolean().optional(),
  /** 'suggestion' = question classique cliquée (réponse fixe, étage 0). */
  origine: z.enum(['texte', 'suggestion']).optional(),
  /** Route courante de l'app (ex. /jobs/123) — chemin seulement, jamais de query. */
  page: z.string().trim().max(200).regex(/^\/[A-Za-z0-9/_-]*$/).optional(),
  /** Chemins de captures déjà téléversées (POST /support/captures), vérifiés sous l'org côté serveur. */
  captures: z.array(z.object({ chemin: z.string().max(200), nom: z.string().max(120).optional() })).max(3).optional(),
});
export const supportMessageSchema = z.object({
  message: z.string().trim().min(1, 'Write a message.').max(5000),
  captures: z.array(z.object({ chemin: z.string().max(200), nom: z.string().max(120).optional() })).max(3).optional(),
});
export const supportEscalateSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
/** 👍 / 👎 du client sur une réponse de Lumi. */
export const supportAvisSchema = z.object({
  avis: z.enum(['bon', 'mauvais']),
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

/**
 * Les types de courriel personnalisables — MÊME LISTE que le CHECK de
 * `email_templates.type` (migration 20260918100000_modeles_courriel.sql).
 *
 * Elle était figée sur 5 valeurs alors que la base en acceptait déjà 10 : le
 * CRUD refusait donc en 400 des types parfaitement valides en base. Les deux
 * listes doivent bouger ENSEMBLE — sinon, soit l'API refuse ce que la base
 * accepte, soit elle laisse passer ce que la base rejettera en 23514.
 */
export const TYPES_MODELE_COURRIEL = [
  'invoice_sent', 'invoice_reminder', 'invoice_paid', 'invoice_overdue',
  'payment_receipt', 'payment_failed', 'payment_request',
  'deposit_request', 'deposit_received',
  'quote_sent', 'quote_reminder', 'quote_accepted', 'quote_declined', 'quote_expiring',
  'job_confirmation', 'job_reminder', 'job_completed', 'job_rescheduled', 'job_cancelled',
  'appointment_reminder', 'appointment_confirmation',
  'contract_sent', 'contract_signed', 'contract_reminder',
  'lead_ack', 'lead_followup', 'lead_nurture',
  'client_welcome', 'client_anniversary', 'seasonal_reminder', 'cross_sell',
  'review_request', 'referral_request',
  'form_submission', 'generic',
] as const;

export const emailTemplateSchema = z.object({
  name: z.string().trim().min(1, 'name is required.'),
  type: z.enum(TYPES_MODELE_COURRIEL, { error: 'type is not a supported email template type.' }),
  subject: z.string().trim().min(1, 'subject is required.'),
  body: z.string().min(1, 'body is required.'),
  variables: z.any().optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  // 'import' = HTML collé par l'entreprise : assaini puis posé dans `corpsHtml`
  // du gabarit, jamais en remplacement du courriel entier.
  source: z.enum(['editeur', 'import']).optional(),
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
  // La réponse remplit ce champ personnalisé (opportunité ou client) — v2.
  cf_field_id: z.string().uuid().nullable().optional(),
});

export const upsertRequestFormSchema = z.object({
  /** Le formulaire à modifier. Absent = on crée, ou on vise le plus ancien
   *  (l'écran d'aujourd'hui, qui n'envoie pas encore d'id). */
  id: z.string().uuid().optional(),
  /** `true` force une CRÉATION même sans id : c'est « Nouveau formulaire ».
   *  Sans ce drapeau, un formulaire sans id écraserait le plus ancien. */
  creer: z.boolean().optional(),
  /** Le pipeline qui reçoit les leads de ce formulaire. `null` = celui par
   *  défaut de l'organisation. */
  pipeline_id: z.string().uuid().nullable().optional(),
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
  // Attribution marketing. Ce ne sont PAS des champs du formulaire : la page
  // publique les relève dans son URL et les joint à l'envoi. Tous optionnels,
  // pour qu'un formulaire intégré ailleurs (ou un vieux cache) continue de
  // fonctionner sans eux.
  utm_source: attributionString,
  utm_medium: attributionString,
  utm_campaign: attributionString,
  utm_content: attributionString,
  fbclid: attributionString,
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

// Aligné sur ce que la route lit réellement (metric, target_value, period, start_date, end_date) —
// l'ancien schéma exigeait title/metric_type, que la route ignorait : tout POST était refusé (audit 2026-09-16).
export const createGoalSchema = z.object({
  metric: z.enum(['revenue', 'jobs', 'leads']),
  target_value: z.number().min(0).max(999_999_999_999),
  period: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD.'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD.'),
}).strict();

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

// ─── Migration assistée (console interne + portail temporaire) ───────────

const migrationCategoryEnum = z.enum([
  'taxes', 'clients', 'properties', 'billing_addresses', 'services', 'quotes', 'jobs', 'recurring_jobs', 'visits',
  'invoices', 'payments', 'notes', 'attachments', 'team_members', 'custom_fields',
]);
export { migrationCategoryEnum };

const migrationSourceCrmEnum = z.enum([
  'jobber', 'housecall_pro', 'servicetitan', 'gohighlevel', 'quickbooks', 'other', 'custom_files',
]);

export const migrationCreateSchema = z.object({
  org_id: z.string().uuid('org_id must be a valid UUID.'),
  source_crm: migrationSourceCrmEnum.optional(),
  categories: z.array(migrationCategoryEnum).min(1).max(14).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  internal_notes: z.string().max(4000).optional().nullable(),
  invited_email: z.string().trim().email().max(200).optional().nullable(),
  invited_user_id: z.string().uuid().optional().nullable(),
  assigned_admin: z.string().uuid().optional().nullable(),
  assigned_assistant: z.string().uuid().optional().nullable(),
});

export const migrationApproveOnBehalfSchema = z.object({
  comment: z.string().max(500).optional().nullable(),
});

export const migrationPatchSchema = z.object({
  source_crm: migrationSourceCrmEnum.optional(),
  categories: z.array(migrationCategoryEnum).min(1).max(14).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  internal_notes: z.string().max(4000).optional().nullable(),
  invited_email: z.string().trim().email().max(200).optional().nullable(),
  invited_user_id: z.string().uuid().optional().nullable(),
  assigned_admin: z.string().uuid().optional().nullable(),
  assigned_assistant: z.string().uuid().optional().nullable(),
  bot_actif: z.boolean().optional(),
  bot_mode: z.enum(['client', 'autonome']).optional(),
  freeze_start: z.string().optional().nullable(),
  freeze_end: z.string().optional().nullable(),
}).refine((obj) => Object.keys(obj).length > 0, 'Request body cannot be empty.');

export const migrationInvitationSchema = z.object({
  ttl_hours: z.number().int().min(1).max(720).optional(),
});

export const migrationStatusChangeSchema = z.object({
  to: z.enum([
    'draft', 'invitation_sent', 'waiting_for_files', 'files_uploaded', 'parsing', 'mapping',
    'human_review', 'waiting_for_client', 'ready_for_test', 'testing', 'test_review',
    'waiting_for_approval', 'approved', 'ready_for_final_import', 'importing',
    'post_import_validation', 'completed', 'completed_with_warnings', 'failed',
    'rolled_back', 'cancelled',
  ]),
});

const migrationTargetEntityEnum = z.enum([
  'tax_config', 'client', 'property', 'billing_property', 'service', 'quote', 'job', 'visit', 'invoice', 'line_item', 'payment',
]);

export const migrationMappingDecisionSchema = z.object({
  status: z.enum(['confirmed', 'corrected', 'rejected', 'needs_review']),
  target_entity: migrationTargetEntityEnum.optional().nullable(),
  target_field: z.string().trim().max(80).optional().nullable(),
});

export const migrationMappingFlagSchema = z.object({
  flag: z.enum(['red', 'amber', 'green', 'blue', 'purple']).nullable(),
});

export const migrationIssueCreateSchema = z.object({
  type: z.string().trim().min(1).max(60),
  severity: z.enum(['info', 'warning', 'error', 'blocking']).optional(),
  title: z.string().trim().min(1).max(300),
  client_visible: z.boolean().optional(),
  options: z.array(z.string().max(120)).max(10).optional(),
});

export const migrationIssueResolveSchema = z.object({
  resolution: z.string().trim().min(1).max(2000),
});

export const migrationDuplicateDecisionSchema = z.object({
  decision: z.enum(['create_new', 'merge', 'skip', 'review']),
});

export const migrationFinalImportSchema = z.object({
  confirm_org_name: z.string().trim().min(1).max(200),
});

export const migrationMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const migrationPortalApprovalSchema = z.object({
  decision: z.enum(['approved', 'refused', 'changes_requested']),
  confirmed_text: z.string().max(300).optional(),
  comment: z.string().max(4000).optional(),
});

export const migrationPortalMappingSchema = z.object({
  target_entity: migrationTargetEntityEnum.nullable(),
  target_field: z.string().trim().max(80).nullable(),
});

export const migrationPortalAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

/** Formulaire « Importer vos données » : catégories cochées par le client. */
export const migrationPortalCategoriesSchema = z.object({
  categories: z.array(migrationCategoryEnum).min(1).max(16),
});

/** Réaffectation d'un fichier à une catégorie (le client corrige la détection). */
export const migrationPortalFileCategorySchema = z.object({
  category: migrationCategoryEnum,
});

export const migrationStaffMapSchema = z.object({
  mappings: z.array(z.object({
    source: z.string().trim().min(1).max(120),
    user_id: z.string().uuid().nullable(),
  })).min(1).max(200),
});

export const migrationTemplateSaveSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const migrationTemplateApplySchema = z.object({
  template_id: z.string().uuid(),
});

// ─── Domaine d'envoi propre à l'entreprise (POST /api/sending-domain) ────────

export const sendingDomainSchema = z.object({
  // La validation stricte (minuscules, ASCII, domaines réservés) vit dans
  // server/lib/courriels/domaines.ts (validerDomaine) ; ici on borne la taille.
  domain: z.string().trim().min(3, 'Domain is required.').max(253, 'Domain is too long.'),
});

// ─── Automatisations personnalisées (POST/PATCH /api/automations/rules) ─────
//
// Jusqu'ici la table `automation_rules` n'était remplie que par le seeder :
// aucune entrée utilisateur n'y arrivait, donc aucun schéma. Maintenant que
// l'interface permet de créer ses propres automatisations, tout ce qui vient
// du navigateur passe par ici.
//
// Le catalogue (`src/lib/automationCatalogue.ts`) est la source de vérité des
// clés acceptées : un déclencheur ou une action hors catalogue est refusé, et
// on ne peut donc pas enregistrer une règle que le moteur ne saurait pas
// exécuter — ou pire, qu'il exécuterait de travers.

const cleDeclencheur = z.enum(
  CLES_DECLENCHEURS as [string, ...string[]],
  { message: 'Unknown trigger.' },
);

/**
 * Une action, validée CONTRE SON PROPRE type : les champs obligatoires de
 * `send_email` (objet + message) ne sont pas ceux de `create_task`.
 *
 * `config` est volontairement fermé (`strict`) : une clé inconnue est
 * refusée plutôt qu'ignorée. C'est ce qui empêche de réintroduire par la
 * bande un `to` — le destinataire imposé (`DESTINATAIRE_IMPOSE` dans
 * server/lib/actions/index.ts) est une garde de sécurité, pas une
 * préférence.
 */
/**
 * Ce qu'une VALEUR de configuration a le droit d'etre, selon le type du champ.
 *
 * Tout est stocke en TEXTE dans `config` (jsonb) : un nombre arrive en
 * « 250 », une bascule en « true ». C'est ce que le navigateur envoie depuis
 * un `<input>`, et le moteur le relit pareil. Valider ici la FORME de ce
 * texte evite qu'une bascule arrive en « peut-etre » et qu'une action ecrive
 * n'importe quoi en base.
 */
function valeurValide(champ: ChampAction, brut: unknown): string | null {
  if (typeof brut !== 'string') return 'doit etre du texte';
  const v = brut.trim();
  if (v === '') return null; // vide = absent, traite plus haut

  switch (champ.type) {
    case 'bascule':
      return v === 'true' || v === 'false' ? null : 'doit valoir true ou false';

    case 'nombre': {
      const n = Number(v);
      if (!Number.isFinite(n)) return 'doit etre un nombre';
      if (champ.min_valeur !== undefined && n < champ.min_valeur) {
        return `doit etre au moins ${champ.min_valeur}`;
      }
      if (champ.max_valeur !== undefined && n > champ.max_valeur) {
        return `doit etre au plus ${champ.max_valeur}`;
      }
      return null;
    }

    case 'choix': {
      const permis = (champ.options ?? []).map((o) => o.cle);
      return permis.includes(v) ? null : `doit etre l'un de : ${permis.join(', ')}`;
    }

    case 'membre':
      // Un identifiant de membre, pas un nom : la route verifie ensuite qu'il
      // appartient bien a l'organisation.
      return /^[0-9a-fA-F-]{36}$/.test(v) ? null : 'doit etre un membre valide';

    case 'url':
      // https UNIQUEMENT. Un webhook en http laisse passer les donnees du
      // client en clair, et `file://` ou `http://169.254.169.254` visent des
      // ressources internes au serveur (SSRF).
      if (!/^https:\/\//i.test(v)) return 'doit commencer par https://';
      try {
        const u = new URL(v);
        const hote = u.hostname.toLowerCase();
        const interdit =
          hote === 'localhost' ||
          hote === '169.254.169.254' ||
          /^127\./.test(hote) ||
          /^10\./.test(hote) ||
          /^192\.168\./.test(hote) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(hote) ||
          hote.endsWith('.local') ||
          hote.endsWith('.internal');
        return interdit ? 'ne peut pas viser une adresse interne' : null;
      } catch {
        return 'adresse invalide';
      }

    default:
      return null; // texte, zone, etiquette : seule la longueur compte
  }
}

/**
 * Une action, validee CONTRE SON PROPRE type : les champs obligatoires de
 * `send_email` (objet + message) ne sont pas ceux de `create_task`.
 *
 * `config` reste FERME : seules les cles connues du catalogue passent, et
 * une cle inconnue est refusee plutot qu'ignoree. C'est ce qui empeche de
 * reintroduire par la bande un `to` — le destinataire impose
 * (`DESTINATAIRE_IMPOSE` dans server/lib/actions/index.ts) est une garde de
 * securite, pas une preference.
 *
 * La liste des cles vient du catalogue lui-meme (`CLES_CHAMPS_ACTION`) : une
 * action qui gagne un champ n'oblige donc pas a modifier ce schema, et un
 * champ retire cesse d'etre accepte le jour meme. C'est le second raffinement
 * qui verifie ensuite que la cle appartient bien a CETTE action-la.
 */
const configAction = z.object(
  Object.fromEntries(
    CLES_CHAMPS_ACTION.flatMap((cle) => [
      [cle, z.string().trim().max(10000).optional()],
      /* La variante anglaise du meme champ.
         `champLocalise` (server/lib/actions/index.ts) lit `<champ>_en` quand
         la langue de l'organisation est l'anglais, et 312 regles reelles en
         portent deja. Sans ces cles ici, modifier une de ces regles la ferait
         refuser — ou pire, la sauvegarderait amputee de ses traductions. */
      [`${cle}_en`, z.string().trim().max(10000).optional()],
    ]),
  ) as Record<string, z.ZodOptional<z.ZodString>>,
);

const actionAutomatisation = z
  .object({
    type: z.enum(CLES_ACTIONS as [string, ...string[]], { message: 'Unknown action.' }),
    // `strict` : une cle inconnue est refusee, pas ignoree.
    config: configAction.strict(),
  })
  .superRefine((action, ctx) => {
    const modele = trouverAction(action.type);
    if (!modele) return;
    const config = action.config as Record<string, unknown>;

    for (const champ of modele.champs) {
      const valeur = config[champ.cle];
      const rempli = typeof valeur === 'string' && valeur.trim().length > 0;

      // Un champ obligatoire CACHE n'est pas exige : le panneau ne l'affiche
      // pas (« l'etiquette » quand « toutes » est coche), et l'exiger quand
      // meme donnerait une impasse — un refus d'enregistrer pointant un champ
      // absent de l'ecran.
      const visible = champVisible(champ, config);

      if (champ.obligatoire && visible && !rempli) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', champ.cle],
          message: `« ${modele.fr} » : le champ « ${champ.fr} » est obligatoire.`,
        });
        continue;
      }

      if (!rempli) continue;

      const texte = valeur as string;
      const max = champ.max ?? 10000;
      if (texte.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', champ.cle],
          message: `« ${champ.fr} » depasse ${max} caracteres.`,
        });
      }

      const faute = valeurValide(champ, texte);
      if (faute) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', champ.cle],
          message: `« ${champ.fr} » ${faute}.`,
        });
      }

      /* La traduction anglaise subit les memes controles que l'originale :
         sinon un texto anglais de 3000 caracteres passerait la validation et
         partirait en trois segments factures. */
      const anglais = config[`${champ.cle}_en`];
      if (typeof anglais === 'string' && anglais.trim()) {
        if (anglais.length > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['config', `${champ.cle}_en`],
            message: `« ${champ.en} » (anglais) depasse ${max} caracteres.`,
          });
        }
        const fauteEn = valeurValide(champ, anglais);
        if (fauteEn) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['config', `${champ.cle}_en`],
            message: `« ${champ.en} » (anglais) ${fauteEn}.`,
          });
        }
      }
    }

    // Un champ rempli qui n'appartient pas a cette action : refuse plutot
    // qu'ignore, sinon l'utilisateur croit avoir ecrit un objet de courriel
    // sur un texto et ne comprend pas pourquoi il disparait.
    const attendus = new Set(modele.champs.flatMap((c) => [c.cle, `${c.cle}_en`]));
    for (const cle of Object.keys(config)) {
      if (!attendus.has(cle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', cle],
          message: `« ${modele.fr} » n'utilise pas le champ « ${cle} ».`,
        });
      }
    }
  });

/**
 * Les conditions, en objet plat comparé aux métadonnées de l'événement.
 *
 * Seuls les 4 opérateurs que `evaluateConditions` connaît sont acceptés.
 * Un opérateur inconnu ne se contente pas d'être ignoré côté moteur : il
 * fait échouer la règle ENTIÈRE, en silence (automationEngine.ts). Le
 * refuser à l'enregistrement est la seule façon d'éviter une automatisation
 * qui ne part jamais sans que personne sache pourquoi.
 */
/** Une condition sur un champ personnalisé (moteur partagé src/lib/champs/filtres.ts). */
export const conditionChampSchema = z.object({
  field_id: z.string().uuid(),
  op: z.enum(['is', 'is_not', 'contains', 'not_contains', 'eq', 'neq', 'gt', 'lt', 'between', 'any_of', 'none_of',
    'today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'is_empty', 'is_not_empty']),
  value: z.union([z.string().max(500), z.number().finite(), z.array(z.string().max(100)).max(100)]).nullable().optional(),
  value2: z.union([z.string().max(500), z.number().finite()]).nullable().optional(),
  n: z.number().int().min(0).max(3650).optional(),
  unit: z.enum(['days', 'weeks', 'months']).optional(),
}).strict();

const valeurCondition = z.union([z.string().max(200), z.number(), z.boolean()]);
const conditionsAutomatisation = z
  .record(
    z.string().trim().min(1).max(64),
    z.union([
      valeurCondition,
      z
        .object({
          eq: valeurCondition.optional(),
          neq: valeurCondition.optional(),
          in: z.array(valeurCondition).min(1).max(50).optional(),
          not_in: z.array(valeurCondition).min(1).max(50).optional(),
        })
        .strict()
        .refine((o) => Object.keys(o).length > 0, 'Empty condition.'),
      // Clé réservée `champs_perso` : conditions sur les champs personnalisés.
      z.array(conditionChampSchema).min(1).max(10),
    ]),
  )
  .refine((c) => Object.keys(c).length <= 10, 'Too many conditions (10 max).')
  .refine(
    (c) => Object.entries(c).every(([k, v]) => Array.isArray(v) === (k === 'champs_perso')),
    'Une liste de conditions ne va que sous « champs_perso ».',
  );

/**
 * Une ÉTAPE de séquence.
 *
 * Quatre formes, distinguées par `type`. Un `discriminatedUnion` plutôt qu'un
 * `union` : le message d'erreur nomme alors la forme attendue (« une étape
 * “attendre” a besoin d'un délai ») au lieu d'énumérer les quatre.
 */
const ID_ETAPE = z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid step id.');

const etapeSequence = z.discriminatedUnion('type', [
  z.object({
    id: ID_ETAPE,
    type: z.literal('action'),
    action: actionAutomatisation,
    suivant: ID_ETAPE.nullable().optional(),
    /*
     * Le nom que l'utilisateur donne a l'etape (le « Action Name » de
     * GoHighLevel). Purement d'affichage : le moteur ne le lit jamais.
     *
     * Sans cette cle, Zod le RETIRAIT en silence — l'utilisateur nommait sa
     * carte « Courriel de confirmation », l'enregistrement repondait 200, et
     * le nom avait disparu au rechargement. Vu dans un vrai navigateur.
     */
    nom: z.string().trim().max(80).nullable().optional(),
  }),
  z.object({
    id: ID_ETAPE,
    type: z.literal('attendre'),
    delai_secondes: z
      .number()
      .int()
      .min(0, 'A wait cannot be negative.')
      .max(DELAI_MAX_SECONDES, 'Cannot wait more than a year.'),
    suivant: ID_ETAPE.nullable().optional(),
    /*
     * Ce qu'on attend. Absent = `duree`, le comportement d'avant : les
     * parcours déjà enregistrés ne changent pas.
     *
     * `reponse` = on attend la réponse du client, au plus `delai_secondes`.
     * Sans ces deux clés ici, Zod les RETIRERAIT en silence et l'attente se
     * comporterait comme une attente ordinaire — le réglage ne servirait à
     * rien, sans le moindre message d'erreur.
     */
    mode: z.enum(['duree', 'reponse']).optional(),
    si_reponse: ID_ETAPE.nullable().optional(),
  }),
  z.object({
    id: ID_ETAPE,
    type: z.literal('si'),
    conditions: conditionsAutomatisation,
    alors: ID_ETAPE.nullable().optional(),
    sinon: ID_ETAPE.nullable().optional(),
  }),
  z.object({
    id: ID_ETAPE,
    type: z.literal('arreter'),
  }),
]);

/**
 * La séquence entière.
 *
 * `problemesDuGraphe` fait le travail que Zod ne peut pas faire : vérifier
 * que les renvois pointent vers des étapes qui existent et surtout qu'il
 * n'y a PAS DE BOUCLE. Un graphe accepte ce qu'un tableau interdit —
 * `e1 → e2 → e1` enverrait des messages jusqu'à la fin des temps. Le refuser
 * ici est la première des trois protections (les deux autres bornent le
 * parcours à l'exécution).
 */
const ETAPES_MAX = 20;

export const sequenceEtapes = z
  .array(etapeSequence)
  .min(1, 'A sequence needs at least one step.')
  .max(ETAPES_MAX, `A sequence carries at most ${ETAPES_MAX} steps.`)
  .superRefine((steps, ctx) => {
    for (const probleme of problemesDuGraphe(steps as unknown as Etape[])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: probleme });
    }
  });

/**
 * Les réglages d'une automatisation.
 *
 * Absent ou `null` = les défauts du moteur, qui sont bons : fenêtre
 * 8 h-20 h, arrêt quand la facture est payée ou le devis accepté, une seule
 * inscription par entité. On ne demande à personne de les configurer pour
 * que ça marche — c'est justement ce qui distingue Lume de GoHighLevel, où
 * ces réglages dorment dans un onglet que personne n'ouvre.
 */
export const automationSettingsSchema = z
  .object({
    /** Le même client peut-il repasser dans le parcours ? */
    reentree: z.boolean().optional(),
    /** Sortir du parcours dès que le client répond. */
    arret_sur_reponse: z.boolean().optional(),
    /**
     * Heures pendant lesquelles un message peut partir, en heure locale.
     * Bornées à 0-23 et `debut < fin` : une fenêtre inversée ne laisserait
     * jamais rien passer, et le moteur attendrait pour toujours.
     */
    fenetre: z
      .object({
        debut: z.number().int().min(0).max(23),
        fin: z.number().int().min(1).max(24),
      })
      .refine((f) => f.debut < f.fin, 'The window must start before it ends.')
      .optional(),
    /** Lundi au vendredi seulement. */
    jours_ouvrables: z.boolean().optional(),
    /** Les messages automatiques ne remontent pas en non-lus. */
    marquer_lu: z.boolean().optional(),
  })
  .strict();

const corpsAutomatisation = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  trigger_event: cleDeclencheur,
  conditions: conditionsAutomatisation.optional().default({}),
  // Borné des deux côtés : un délai négatif signifie « avant la date de
  // référence » et n'a de sens que pour un rendez-vous — la route le vérifie
  // contre le catalogue, qui sait quels déclencheurs portent une date future.
  delay_seconds: z
    .number()
    .int('The delay must be a whole number of seconds.')
    .min(-DELAI_NEGATIF_MAX_SECONDES, 'Cannot send more than 30 days before.')
    .max(DELAI_MAX_SECONDES, 'Cannot wait more than a year.'),
  // Le plafond de 5 vaut pour une règle SIMPLE, où les actions partent
  // ensemble : au-delà, le client reçoit une rafale. Dans une séquence elles
  // sont réparties dans le temps, et `actions` n'y est qu'un reflet des
  // étapes (le moteur lit `steps`). Le vrai plafond y est celui des étapes,
  // vérifié par `sequenceEtapes`. La borne haute reste, pour qu'un corps
  // forgé ne puisse pas envoyer une liste sans fin.
  actions: z
    .array(actionAutomatisation)
    .min(1, 'Add at least one action.')
    .max(20, 'Too many actions.'),
  is_active: z.boolean().optional().default(false),
  /**
   * Séquence. Absente = règle simple, pilotée par `delay_seconds` + `actions`
   * comme avant. Les deux formes coexistent : les 35 préréglages restent
   * simples et ne sont pas convertis.
   */
  /**
   * Séquence. Absente ou `null` = règle simple, pilotée par `delay_seconds`
   * + `actions` comme avant.
   *
   * Un TABLEAU VIDE est accepté et vaut `null` : c'est l'état d'une
   * automatisation qu'on vient de créer et dont le parcours n'est pas encore
   * dessiné. Le refuser faisait échouer l'enregistrement automatique du
   * builder à chaque frappe, et le travail se perdait en silence.
   */
  settings: automationSettingsSchema.nullable().optional(),
  /*
   * Le dossier de rangement. `null` = à la racine.
   *
   * Sans cette clé, Zod la RETIRERAIT en silence : « Déplacer dans un
   * dossier » répondrait 200 et rien ne bougerait — exactement le piège
   * déjà payé avec le nom d'étape.
   */
  folder_id: z.string().uuid('Dossier invalide.').nullable().optional(),
  steps: z
    .union([sequenceEtapes, z.array(z.never()).max(0)])
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) && v.length === 0 ? null : v)),
});

/**
 * Le plafond d'actions dépend de la forme.
 *
 * Sans séquence, 5 au plus : elles partent TOUTES en même temps, et davantage
 * ferait une rafale chez le client. Dans une séquence elles sont réparties
 * dans le temps et `actions` n'est qu'un reflet des étapes — le vrai plafond
 * y est celui des étapes.
 *
 * Écrit comme un raffinement SÉPARÉ : `.partial()` (utilisé juste en dessous
 * pour la modification) refuse un objet qui porte déjà un raffinement.
 */
const plafondActions = (corps: { steps?: unknown; actions?: unknown[] }, ctx: z.RefinementCtx) => {
  if (!corps.steps && Array.isArray(corps.actions) && corps.actions.length > ACTIONS_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actions'],
      message: `An automation carries at most ${ACTIONS_MAX} actions.`,
    });
  }
};

export const automationRuleCreateSchema = corpsAutomatisation.superRefine(plafondActions);

/**
 * La modification accepte un sous-ensemble, mais jamais un objet vide.
 *
 * Le refus regarde le corps REÇU, pas le résultat du parsing : `conditions` et
 * `is_active` portent un `.default()`, donc après parsing l'objet contient
 * toujours ces deux clés et ne serait jamais « vide ». Un PATCH sans rien
 * passerait alors, écraserait les conditions existantes par `{}` et
 * remettrait la règle en pause — sans que personne ne l'ait demandé.
 */
/** Assigner une conversation de la boîte de réception (null = désassigner). */
export const conversationAssignSchema = z.object({
  assigned_to: z.string().uuid().nullable(),
});

/** Copier une automatisation vers d'autres bureaux de l'entreprise. */
export const automationCopieBureauxSchema = z.object({
  org_ids: z.array(z.string().uuid()).min(1).max(50),
  /** La copie suit le modèle (par défaut) ; false = copie autonome. */
  lier: z.boolean().optional(),
});

export const automationRuleUpdateSchema = z
  .record(z.string(), z.unknown())
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update.')
  .pipe(corpsAutomatisation.partial().superRefine(plafondActions));

// ─── Champs personnalisés v2 (server/routes/custom-fields.ts) ───
// `nullable()` partout où le client peut envoyer null (règle du projet).

const objetChamp = z.enum(['client', 'deal', 'job', 'quote', 'invoice'], { message: 'Objet inconnu.' });
const typeChamp = z.enum(
  ['single_line', 'multi_line', 'number', 'monetary', 'phone', 'email', 'date', 'dropdown_single', 'dropdown_multi'],
  { message: 'Type de champ inconnu.' },
);
const optionChamp = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Une option ne peut pas être vide.').max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur #RRGGBB attendue.').nullable().optional(),
}).strict();
const configChamp = z.object({
  decimals: z.number().int().min(0).max(6).nullable().optional(),
  min: z.number().finite().nullable().optional(),
  max: z.number().finite().nullable().optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'Devise ISO à 3 lettres.').optional(),
  include_time: z.boolean().optional(),
  show_on_documents: z.boolean().optional(),
}).strict();
const baseChamp = {
  label: z.string().trim().min(1, 'Le nom du champ est obligatoire.').max(100),
  field_type: typeChamp,
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,49}$/, 'Clé : lettres minuscules, chiffres et _ (commence par une lettre).').optional(),
  placeholder: z.string().trim().max(200).nullable().optional(),
  help_text: z.string().trim().max(200).nullable().optional(),
  is_required: z.boolean().optional(),
  is_searchable: z.boolean().optional(),
  config: configChamp.optional(),
  options: z.array(optionChamp).max(200).optional(),
};

export const champCreerSchema = z.object({
  ...baseChamp,
  object_type: objetChamp,
  folder_id: z.string().uuid().nullable().optional(),
}).strict();

export const modeleInstallerSchema = z.object({
  industry: z.enum(INDUSTRIES_MODELES),
  ids: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,49}$/)).max(50).optional(),
  language: z.enum(['fr', 'en']).optional(),
}).strict();

export const champModifierSchema = z.object({
  label: baseChamp.label.optional(),
  field_type: typeChamp.optional(),
  placeholder: baseChamp.placeholder,
  help_text: baseChamp.help_text,
  is_required: z.boolean().optional(),
  folder_id: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
  config: configChamp.optional(),
  options: baseChamp.options,
}).strict().refine((o) => Object.keys(o).length > 0, 'Rien à modifier.');

export const champPurgerSchema = z.object({
  valeurs_confirmees: z.number().int().min(0),
}).strict();

export const dossierCreerSchema = z.object({
  object_type: objetChamp,
  name: z.string().trim().min(1, 'Le nom du dossier est obligatoire.').max(100),
  fields: z.array(z.object(baseChamp).strict()).max(50).default([]),
}).strict();

export const dossierModifierSchema = z.object({
  name: z.string().trim().min(1).max(100),
  position: z.number().int().min(0).max(100000).optional(),
}).strict();

export const champsCherchablesSchema = z.object({
  object_type: objetChamp,
  field_ids: z.array(z.string().uuid()).max(500),
}).strict();

export const champUniqueSchema = z.object({
  field_id: z.string().uuid(),
  unique: z.boolean(),
}).strict();

const valeurChamp = z.union([
  z.string().max(5000), z.number().finite(), z.array(z.string().uuid()).max(100), z.null(),
]);
export const valeursEcrireSchema = z.object({
  values: z.array(z.object({
    field_id: z.string().uuid(),
    value: valeurChamp,
    version: z.number().int().min(1).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();



export const champsFiltrerSchema = z.object({
  object_type: objetChamp,
  conditions: z.array(conditionChampSchema).min(1).max(25),
  ids: z.array(z.string().uuid()).max(20000).nullable().optional(),
}).strict();

export const cartesPipelineSchema = z.object({
  field_ids: z.array(z.string().uuid()).max(6, 'Six champs au plus sur une carte.'),
}).strict();

/**
 * Un dossier d'automatisations.
 *
 * Le nom est borné à 60 caractères comme la contrainte CHECK en base
 * (`automation_folders_name_court`) : refuser ici donne un message lisible
 * plutôt qu'une erreur Postgres brute.
 */
const nomDossier = z.string().trim().min(1, 'Donnez un nom au dossier.').max(60, 'Le nom fait plus de 60 caractères.');

export const dossierCreateSchema = z.object({ name: nomDossier });
export const dossierUpdateSchema = z.object({ name: nomDossier });
