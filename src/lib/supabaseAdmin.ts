import { createClient } from '@supabase/supabase-js';

let cachedAdminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdminClient(url?: string, serviceRoleKey?: string) {
  const supabaseUrl = url || process.env.VITE_SUPABASE_URL || '';
  const supabaseServiceRoleKey = serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for server admin client.');
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return cachedAdminClient;
}
