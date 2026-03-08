import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_URL — check your .env.local file.');
}

if (!supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY — check your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
