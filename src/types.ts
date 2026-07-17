/** DB-aligned lead status slugs — canonical source: pipelineApi.ts */
import type { StageSlug } from './lib/pipelineApi';
export type LeadStatus = StageSlug;

export interface Lead {
  id: string;
  org_id?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string | null;
  company?: string;
  title?: string;
  source?: string;
  value?: number;
  status: LeadStatus | string;
  stage?: string | null;
  tags?: string[];
  user_id?: string;
  assigned_to?: string | null;
  notes?: string | null;
  client_id?: string | null;
  converted_to_client_id?: string | null;
  converted_job_id?: string | null;
  converted_at?: string | null;
  deleted_at?: string | null;
  schedule?: Record<string, any> | null;
  assigned_team?: string | null;
  line_items?: Array<Record<string, any>> | null;
  description?: string | null;
}

export interface Task {
  id: string;
  created_at: string;
  title: string;
  description?: string;
  due_date: string;
  completed: boolean;
  lead_id?: string;
  user_id: string;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
  company_name?: string;
}

/** DB-aligned job status values */
export type JobDbStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/** Display-only status labels (derived from DB status + business rules) */
export type JobStatus =
  | 'Draft'
  | 'Scheduled'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Late'
  | 'Unscheduled'
  | 'Requires Invoicing'
  | 'Action Required'
  | 'Ending within 30 days';

export interface Job {
  id: string;
  org_id: string;
  created_by?: string;
  lead_id?: string | null;
  job_number: string;
  title: string;
  description?: string | null;
  client_id?: string | null;
  property_id?: string | null;
  team_id?: string | null;
  client_name?: string | null;
  /** Secondary display line for the client (company, or person name when displayed as company) */
  client_secondary_name?: string | null;
  address?: string | null;
  property_address?: string | null;
  scheduled_at?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  status: JobStatus | string;
  total_cents: number;
  total_amount?: number;
  currency: string;
  subtotal?: number;
  tax_total?: number;
  total?: number;
  tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
  job_type?: string | null;
  salesperson_id?: string | null;
  sale_date?: string | null;
  show_on_leaderboard?: boolean;
  requires_invoicing?: boolean;
  billing_split?: boolean;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_status?: 'ok' | 'failed' | 'pending' | string | null;
  geocoded_at?: string | null;
  invoice_url?: string | null;
  attachments?: Array<{ name: string; url: string }> | null;
  completed_at?: string | null;
  closed_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentProvider = 'stripe' | 'paypal' | 'manual';

export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded';

export type PaymentMethod = 'card' | 'e-transfer' | 'cash' | 'check';

export interface Payment {
  id: string;
  org_id: string;
  client_id: string | null;
  invoice_id: string | null;
  job_id: string | null;
  provider: PaymentProvider;
  provider_payment_id?: string | null;
  provider_order_id?: string | null;
  provider_event_id?: string | null;
  amount_cents: number;
  currency: string;
  method: PaymentMethod | null;
  status: PaymentStatus;
  payment_date: string;
  payout_date: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null;
  payment_request_id?: string | null;
  stripe_charge_id?: string | null;
  stripe_transfer_id?: string | null;
  stripe_balance_transaction_id?: string | null;
  application_fee_amount?: number | null;
  stripe_fee_amount?: number | null;
  net_amount?: number | null;
  paid_at?: string | null;
  failure_reason?: string | null;
}

// ── Stripe Connect ──

export type ConnectedAccountType = 'express' | 'standard' | 'custom';

export interface ConnectedAccount {
  id: string;
  org_id: string;
  stripe_account_id: string;
  account_type: ConnectedAccountType;
  onboarding_complete: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  country: string | null;
  default_currency: string;
  created_at: string;
  updated_at: string;
}

// ── Payment Requests ──

export type PaymentRequestStatus = 'pending' | 'sent' | 'paid' | 'expired' | 'cancelled';

export interface PaymentRequest {
  id: string;
  org_id: string;
  invoice_id: string;
  public_token: string;
  amount_cents: number;
  currency: string;
  status: PaymentRequestStatus;
  expires_at: string | null;
  stripe_payment_intent_id: string | null;
  payment_url: string | null;
  created_at: string;
  updated_at: string;
}

// ── Webhook Events ──

export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'skipped';

export interface WebhookEvent {
  id: string;
  provider: 'stripe' | 'paypal';
  stripe_event_id: string | null;
  stripe_account_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

// ── Request Forms ──────────────────────────────────────────

export type FormFieldType = 'text' | 'dropdown' | 'multiselect' | 'checkbox' | 'number' | 'paragraph';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  section: 'service_details' | 'final_notes';
}

export interface RequestForm {
  id: string;
  org_id: string;
  api_key: string;
  title: string;
  description: string | null;
  success_message: string;
  enabled: boolean;
  /** Custom form logo; NULL falls back to company_settings.logo_url. */
  logo_url: string | null;
  custom_fields: FormField[];
  notify_email: boolean;
  notify_in_app: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  org_id: string;
  form_id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string;
  phone: string;
  street_address: string | null;
  unit: string | null;
  city: string | null;
  country: string | null;
  region: string | null;
  postal_code: string | null;
  custom_responses: Record<string, any>;
  notes: string | null;
  lead_id: string | null;
  deal_id: string | null;
  client_id: string | null;
  ip_address: string | null;
  created_at: string;
  /** On-site assessment scheduling + archive — migration 20260718000000. */
  assessment_start_at?: string | null;
  assessment_end_at?: string | null;
  assessment_team_id?: string | null;
  assessment_user_id?: string | null;
  assessment_instructions?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
}

// ── Quote Content Presets ──────────────────────────────────
// A preset is a reusable content template for quotes.
// It pre-fills services, descriptions, images, and notes — but NO prices.
// The quote layout is always the same; presets only affect content.

export interface QuotePresetService {
  id: string;
  name: string;
  description: string;
  quantity: number;
  is_optional: boolean;
}

export interface QuotePreset {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  cover_image: string | null;
  images: string[];
  services: QuotePresetService[];
  notes: string | null;
  intro_text: string | null;
  /** Contract / disclaimer text (maps to backend `terms`). */
  terms: string | null;
  deposit_required: boolean;
  /** 'percent' | 'fixed' */
  deposit_type: string | null;
  deposit_value: number;
  /** Section builder config + extra section data (reviews, attachments, ordering). */
  custom_fields: Record<string, any>;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use QuotePreset instead */
export type QuoteTemplate = QuotePreset;
/** @deprecated Use QuotePresetService instead */
export type QuoteTemplateService = QuotePresetService;

// ── Clostra: Gamification & D2D Field Sales ─────────────────────────

export type PeriodType = 'daily' | 'weekly' | 'monthly';
export type ChallengeType = 'daily' | 'weekly';
export type ChallengeStatus = 'active' | 'completed' | 'cancelled';
export type BattleType = 'rep_vs_rep' | 'team_vs_team';
export type BattleStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type FieldSessionStatus = 'active' | 'paused' | 'completed';
export type CheckInType = 'check_in' | 'check_out';
export type CommissionRuleType = 'flat' | 'percentage' | 'tiered';
export type CommissionEntryStatus = 'pending' | 'approved' | 'paid' | 'reversed';

// ── Badges ──

export interface FsBadge {
  id: string;
  org_id: string;
  slug: string;
  name_en: string;
  name_fr: string;
  description_en: string | null;
  description_fr: string | null;
  icon: string | null;
  color: string | null;
  category: string | null;
  criteria: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FsRepBadge {
  id: string;
  org_id: string;
  user_id: string;
  badge_id: string;
  earned_at: string;
  metadata: Record<string, any>;
  created_at: string;
  badge?: FsBadge;
}

// ── Leaderboard ──

export interface RepStatSnapshot {
  id: string;
  org_id: string;
  user_id: string;
  period: PeriodType;
  period_start: string;
  period_end: string;
  doors_knocked: number;
  conversations: number;
  demos_set: number;
  demos_held: number;
  quotes_sent: number;
  closes: number;
  revenue: number;
  follow_ups_completed: number;
  conversion_rate: number;
  average_ticket: number;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  team_name: string | null;
  team_id: string | null;
  /** Nom du bureau (org) du rep — affiché seulement si la compagnie a 2+ offices. */
  office_name: string | null;
  experience_level: 'rookie' | 'experienced' | null;
  closes: number;
  revenue: number;
  doors_knocked: number;
  conversion_rate: number;
  trend: number;
}

export interface RepPerformanceDetail {
  doors_knocked: number;
  conversations: number;
  demos_set: number;
  demos_held: number;
  quotes_sent: number;
  closes: number;
  revenue: number;
  conversion_rate: number;
  average_ticket: number;
  follow_ups_completed: number;
}

// ── Challenges ──

export interface FsChallenge {
  id: string;
  org_id: string;
  created_by: string;
  name_en: string;
  name_fr: string;
  description_en: string | null;
  description_fr: string | null;
  type: ChallengeType;
  metric_slug: string;
  target_value: number | null;
  start_date: string;
  end_date: string;
  status: ChallengeStatus;
  prize_description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  participants?: FsChallengeParticipant[];
}

export interface FsChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;
  current_value: number;
  completed_at: string | null;
  joined_at: string;
  updated_at: string;
  full_name?: string;
  avatar_url?: string | null;
}

// ── Battles ──

export interface FsBattle {
  id: string;
  org_id: string;
  created_by: string;
  name: string;
  type: BattleType;
  metric_slug: string;
  challenger_user_id: string | null;
  challenger_team_id: string | null;
  opponent_user_id: string | null;
  opponent_team_id: string | null;
  challenger_score: number;
  opponent_score: number;
  start_date: string;
  end_date: string;
  status: BattleStatus;
  winner_user_id: string | null;
  winner_team_id: string | null;
  prize_description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  challenger_name?: string;
  opponent_name?: string;
}

// ── Commissions ──

export interface CommissionProductOverride {
  category: string; // matches line_item.category / service tag
  base_kind: 'percent' | 'flat';
  base_percent: number | null;   // 0–100
  base_value_cents: number | null;
}

export interface CommissionPerformanceTier {
  // Threshold compared to rep's cumulative period revenue (cents) OR sale count.
  metric: 'revenue_cents' | 'sale_count';
  threshold: number;
  // Modifier applied above this threshold:
  modifier_percent: number | null; // % added/subtracted to base rate (additive)
  modifier_flat_cents: number | null; // flat bonus per sale above threshold
}

export interface CommissionBonus {
  condition: 'min_sale_amount' | 'max_refund_days_passed' | 'paid_within_days';
  value: number; // amount in cents OR days depending on condition
  modifier_percent: number | null;
  modifier_flat_cents: number | null;
}

export interface CommissionAttribution {
  mode: 'solo' | 'split';
  // For split mode, list of { user_id?, role?, pct }
  splits?: Array<{ user_id?: string | null; role?: string | null; pct: number }>;
}

export interface FsCommissionRule {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  type: CommissionRuleType; // legacy column kept for compatibility
  flat_amount: number | null;
  percentage: number | null;
  tiers: Array<{ min: number; max: number; rate: number }>;
  applies_to_role: string | null;
  applies_to_user_id: string | null;
  is_active: boolean;
  priority: number;
  // New engine columns
  base_kind: 'percent' | 'flat' | null;
  base_percent: number | null;
  base_value_cents: number | null;
  product_overrides: CommissionProductOverride[];
  performance_tiers: CommissionPerformanceTier[];
  bonuses: CommissionBonus[];
  attribution: CommissionAttribution;
  assigned_user_ids: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CommissionSettings {
  org_id: string;
  reversal_policy: 'auto' | 'keep' | 'alert';
  default_rule_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FsCommissionEntry {
  id: string;
  org_id: string;
  user_id: string;
  rule_id: string;
  lead_id: string | null;
  job_id: string | null;
  invoice_id: string | null;
  status: CommissionEntryStatus;
  amount: number;
  base_amount: number;
  description: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  triggered_at: string;
  auto_reversed: boolean;
  reverse_reason: string | null;
  calc_breakdown: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Relations
  rep_name?: string;
  rep_avatar?: string | null;
  rule_name?: string;
}

export interface CommissionPayrollPreview {
  total: number;
  pending: number;
  approved: number;
  paid: number;
  reversed: number;
  count: number;
  entries: FsCommissionEntry[];
}

// ── Field Sessions ──

export interface FsFieldSession {
  id: string;
  org_id: string;
  user_id: string;
  territory_id: string | null;
  status: FieldSessionStatus;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  total_duration_minutes: number | null;
  doors_knocked: number;
  created_at: string;
  updated_at: string;
  // Relations
  rep_name?: string;
  rep_avatar?: string | null;
  territory_name?: string | null;
}

export interface FsGpsPoint {
  id: string;
  session_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  recorded_at: string;
  created_at: string;
}

export interface FsCheckInRecord {
  id: string;
  org_id: string;
  user_id: string;
  session_id: string | null;
  type: CheckInType;
  lat: number;
  lng: number;
  accuracy: number | null;
  photo_url: string | null;
  notes: string | null;
  recorded_at: string;
  created_at: string;
}
