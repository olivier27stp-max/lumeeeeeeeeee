/**
 * LUME CRM — Structured Logger with Secret Redaction
 * ====================================================
 * Replaces console.log for production use.
 * - JSON structured output for log aggregation
 * - Automatic redaction of sensitive fields
 * - Log levels: debug, info, warn, error
 * - Request context (requestId, IP) when available
 */

// Fields that should NEVER appear in logs
const REDACTED_FIELDS = new Set([
  'password', 'secret', 'token', 'authorization', 'cookie',
  'api_key', 'apikey', 'api-key', 'x-api-key',
  'stripe_secret_key', 'stripe_publishable_key',
  'paypal_client_secret', 'paypal_client_id',
  'twilio_auth_token', 'resend_api_key',
  'supabase_service_role_key', 'encryption_key',
  'credit_card', 'card_number', 'cvv', 'ssn',
  'pii_encryption_key', 'payments_encryption_key',
]);

// Patterns to redact from string values
const REDACT_PATTERNS = [
  // JWT tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // API keys that look like sk_xxx, pk_xxx, re_xxx
  /\b(sk|pk|re|rk)_(test|live|prod)?_[A-Za-z0-9]{20,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
];

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    let redacted = value;
    for (const pattern of REDACT_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }
  return value;
}

function redactObject(obj: Record<string, any>, depth = 0): Record<string, any> {
  if (depth > 5) return { _truncated: true };

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase().replace(/[-_]/g, '');

    // Check if this field name should be fully redacted
    if (REDACTED_FIELDS.has(key.toLowerCase()) || REDACTED_FIELDS.has(keyLower)) {
      result[key] = '[REDACTED]';
      continue;
    }

    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = redactValue(value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value, depth + 1);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' ? redactObject(item, depth + 1) : redactValue(item)
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function formatLog(level: LogLevel, message: string, data?: Record<string, any>): string {
  const entry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (data) {
    Object.assign(entry, redactObject(data));
  }

  // In production, output JSON for log aggregators
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry);
  }

  // In development, human-readable format
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
  if (data && Object.keys(data).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(redactObject(data), null, 0)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, data?: Record<string, any>) {
    if (shouldLog('debug')) console.debug(formatLog('debug', message, data));
  },
  info(message: string, data?: Record<string, any>) {
    if (shouldLog('info')) console.info(formatLog('info', message, data));
  },
  warn(message: string, data?: Record<string, any>) {
    if (shouldLog('warn')) console.warn(formatLog('warn', message, data));
  },
  error(message: string, data?: Record<string, any>) {
    if (shouldLog('error')) console.error(formatLog('error', message, data));
  },

  /** Create a child logger with preset context (e.g., requestId, orgId) */
  child(context: Record<string, any>) {
    return {
      debug: (msg: string, data?: Record<string, any>) => logger.debug(msg, { ...context, ...data }),
      info: (msg: string, data?: Record<string, any>) => logger.info(msg, { ...context, ...data }),
      warn: (msg: string, data?: Record<string, any>) => logger.warn(msg, { ...context, ...data }),
      error: (msg: string, data?: Record<string, any>) => logger.error(msg, { ...context, ...data }),
    };
  },
};

export default logger;
