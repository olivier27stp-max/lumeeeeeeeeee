/**
 * LUME CRM — Environment Variable Validation
 * ============================================
 * Validates all required environment variables at startup.
 * Crashes immediately if critical variables are missing or malformed.
 * Warns (but continues) for optional variables.
 */

import { z } from 'zod';

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const requiredEnvSchema = z.object({
  // Supabase (critical)
  VITE_SUPABASE_URL: z.string()
    .url('VITE_SUPABASE_URL must be a valid URL')
    .refine(v => !v.includes('placeholder'), 'VITE_SUPABASE_URL contains placeholder value'),
  VITE_SUPABASE_ANON_KEY: z.string()
    .min(20, 'VITE_SUPABASE_ANON_KEY is too short')
    .refine(v => !v.includes('placeholder'), 'VITE_SUPABASE_ANON_KEY contains placeholder value'),
  SUPABASE_SERVICE_ROLE_KEY: z.string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY is too short')
    .refine(v => !v.includes('placeholder'), 'SUPABASE_SERVICE_ROLE_KEY contains placeholder value')
    .refine(
      v => !v.startsWith('VITE_') && !process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'FATAL: Service role key must NEVER be in a VITE_ variable (exposed to browser)'
    ),
});

const optionalEnvSchema = z.object({
  // Stripe
  STRIPE_SECRET_KEY: z.string().optional()
    .refine(v => !v || v.startsWith('sk_'), 'STRIPE_SECRET_KEY must start with sk_'),
  STRIPE_PUBLISHABLE_KEY: z.string().optional()
    .refine(v => !v || v.startsWith('pk_'), 'STRIPE_PUBLISHABLE_KEY must start with pk_'),
  STRIPE_WEBHOOK_SECRET: z.string().optional()
    .refine(v => !v || v.startsWith('whsec_'), 'STRIPE_WEBHOOK_SECRET must start with whsec_'),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional()
    .refine(v => !v || v.startsWith('whsec_'), 'STRIPE_CONNECT_WEBHOOK_SECRET must start with whsec_'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional()
    .refine(v => !v || v.startsWith('AC'), 'TWILIO_ACCOUNT_SID must start with AC'),
  TWILIO_AUTH_TOKEN: z.string().optional()
    .refine(v => !v || v.length >= 20, 'TWILIO_AUTH_TOKEN is too short'),
  TWILIO_PHONE_NUMBER: z.string().optional()
    .refine(v => !v || /^\+[1-9]\d{1,14}$/.test(v), 'TWILIO_PHONE_NUMBER must be E.164 format'),

  // SMTP (Gmail)
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),

  // Gemini AI
  GEMINI_API_KEY: z.string().optional()
    .refine(v => !v || v.startsWith('AIza'), 'GEMINI_API_KEY must start with AIza'),

  // Payments encryption
  PAYMENTS_ENCRYPTION_KEY: z.string().optional(),

  // PII encryption
  PII_ENCRYPTION_KEY: z.string().optional(),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().optional()
    .refine(v => !v || v.startsWith('https://'), 'UPSTASH_REDIS_REST_URL must use HTTPS'),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional()
    .refine(v => !v || v.length >= 20, 'UPSTASH_REDIS_REST_TOKEN is too short'),

  // App
  NODE_ENV: z.enum(['production', 'development', 'staging', 'test']).optional(),
  FRONTEND_URL: z.string().optional(),
  API_PORT: z.string().optional()
    .refine(v => !v || /^\d+$/.test(v), 'API_PORT must be a number'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),

  // Platform admin
  PLATFORM_OWNER_ID: z.string().uuid('PLATFORM_OWNER_ID must be a valid UUID').optional(),
});

// ============================================================================
// SECURITY CHECKS
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function runSecurityChecks(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check that service_role key is NOT in any VITE_ variable
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_') && value && key.toLowerCase().includes('service')) {
      errors.push(`CRITICAL: ${key} appears to be a service role key exposed to the browser via VITE_ prefix`);
    }
    if (key.startsWith('VITE_') && value && (key.toLowerCase().includes('secret') || key.toLowerCase().includes('auth_token'))) {
      errors.push(`CRITICAL: ${key} contains a secret exposed to the browser via VITE_ prefix`);
    }
  }

  // 2. Warn if running in production without essential security configs
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      warnings.push('STRIPE_WEBHOOK_SECRET is not set — Stripe webhooks are disabled');
    }
    if (!process.env.TWILIO_AUTH_TOKEN) {
      warnings.push('TWILIO_AUTH_TOKEN is not set — Twilio webhook signature verification is disabled');
    }
    if (!process.env.PAYMENTS_ENCRYPTION_KEY && !process.env.PII_ENCRYPTION_KEY) {
      errors.push('PII_ENCRYPTION_KEY or PAYMENTS_ENCRYPTION_KEY must be set in production — PII data cannot be stored unencrypted');
    }
    if (!process.env.FRONTEND_URL) {
      errors.push('FRONTEND_URL must be set in production for CORS');
    }
  }

  // 3. Validate encryption key lengths if present
  for (const keyName of ['PAYMENTS_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY', 'PAYMENTS_ENCRYPTION_KEY_PREVIOUS']) {
    const keyVal = process.env[keyName];
    if (keyVal) {
      try {
        const keyBuf = Buffer.from(keyVal, 'base64');
        if (keyBuf.length !== 32) {
          errors.push(`${keyName} must be exactly 32 bytes (got ${keyBuf.length})`);
        }
      } catch {
        errors.push(`${keyName} is not valid base64`);
      }
    }
  }

  // 4. Check for common dangerous configurations
  if (process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true' && process.env.NODE_ENV === 'production') {
    errors.push('TWILIO_SKIP_SIGNATURE_VALIDATION=true is FORBIDDEN in production');
  }

  // 5. Check CORS origin
  if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL) {
    const url = process.env.FRONTEND_URL;
    if (url === '*' || url.includes('localhost') || url.includes('127.0.0.1')) {
      warnings.push(`FRONTEND_URL="${url}" — should be a production domain in production`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

/**
 * Validate all environment variables at startup.
 * Exits process on critical errors.
 */
export function validateEnvironment() {
  console.log('[env] Validating environment variables...');

  // 1. Validate required vars
  const requiredResult = requiredEnvSchema.safeParse(process.env);
  if (!requiredResult.success) {
    console.error('\n[FATAL] Missing or invalid required environment variables:');
    for (const issue of requiredResult.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nServer cannot start without required environment variables.\n');
    process.exit(1);
  }

  // 2. Validate optional vars (warnings only)
  const optionalResult = optionalEnvSchema.safeParse(process.env);
  if (!optionalResult.success) {
    for (const issue of optionalResult.error.issues) {
      console.warn(`[env] WARNING: ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  // 3. Run security checks
  const securityResult = runSecurityChecks();
  if (securityResult.warnings.length > 0) {
    for (const warning of securityResult.warnings) {
      console.warn(`[env] WARNING: ${warning}`);
    }
  }
  if (!securityResult.valid) {
    console.error('\n[FATAL] Security validation failed:');
    for (const error of securityResult.errors) {
      console.error(`  - ${error}`);
    }
    if (process.env.NODE_ENV === 'production') {
      console.error('\nServer cannot start with security violations in production.\n');
      process.exit(1);
    } else {
      console.warn('\n[env] Security issues found but continuing in development mode.\n');
    }
  }

  console.log('[env] Environment validation passed');
}
