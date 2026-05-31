// Test bootstrap — runs before any test module is imported.
//
// server/lib/config.ts validates Supabase env vars at import time and throws
// if VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. Several unit tests
// (e.g. tests/rbac/financial-leak-audit.test.ts) import server modules purely
// for their pure functions and never touch a real backend, so we provide
// harmless dummy values to let those modules load in CI.
//
// Real values from .env.local or CI secrets take precedence when present.
process.env.VITE_SUPABASE_URL ||= 'https://ci-dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ||= 'ci-dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-dummy-service-role-key';
