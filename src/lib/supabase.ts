import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_URL — check your .env.local file.');
}

if (!supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY — check your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Automatically refresh tokens before they expire
    autoRefreshToken: true,
    // Persist session to localStorage (default, but explicit for security review)
    persistSession: true,
    // Detect session from URL (for OAuth redirects, password reset)
    detectSessionInUrl: true,
    // Storage key for session data
    storageKey: 'lume-auth-token',
    // Flow type: PKCE is more secure than implicit for SPAs
    flowType: 'pkce',
  },
});
